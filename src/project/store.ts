// The open project: binder, document contents, autosave and outside-edit
// detection. All file operations run through one queue so a save can never
// interleave with a rename or a reload.

import { isTitlePageName, TITLE_PAGE, titlePageStarter } from "../formats/titlepage";
import { BackendError, call, configApi, fsApi, join } from "../lib/backend";
import { blockText, parseDoc, serializeDoc, adaptScriptTypes, type Block, type Note, type Run } from "../formats/markdown";
import {
  getTemplate,
  hasType,
  MATTER_TEMPLATE,
  NOTES_TEMPLATE,
  TEMPLATES,
  presetFor,
  type ElementType,
  type EssayStyle,
  type MatterPreset,
  type NotePlacement,
  type Template,
  type TemplateId,
} from "../formats/templates";
import type { ManuscriptItem, ProjectMeta } from "../formats/typst";
import { cleanSource, referenceEntry, sameSource, sortKey, sourcesPageTitle, type ReferenceStyle, type Source } from "../formats/citations";
import type { ImportNode } from "./importers";
import {
  chapterOf,
  cloneData,
  conflictBase,
  desiredName,
  emptyProject,
  findNode,
  inMatterFolder,
  isDescendant,
  isSafeId,
  isSafeNotesPath,
  isSafeSegment,
  manuscriptOrder,
  newId,
  nodePath,
  parentOf,
  playOf,
  PROJECT_FILE,
  ROOTS,
  TYPESET_ROLES,
  roleOf,
  rootOf,
  sceneNewPageDefault,
  serializeProject,
  slugify,
  titleFromFile,
  walkNodes,
  type BinderNode,
  type ProjectFile,
  type Role,
} from "./model";
import { projectReadme } from "./readme";
import { computeAnchors, contextKey, editedPages, flatten, hashKey, letterFor, letterName, pageRegions, PRODUCTION_FILE, resolveAnchors, revisedLines, snapshotOf, type Entry, type ProductionState } from "./production";
import { emptyGoals, GOALS_FILE, observe, resetToday, type Goals } from "./goals";
import { wordCount } from "../formats/exporters";
import type { GenOptions } from "../formats/typst";

export const AUTOSAVE_MS = 1000;
const POLL_MS = 2000;
const TEXT_EXT = /\.(md|markdown|txt|fountain)$/i;

export interface DocState {
  /** Markdown as last read from or written to disk. */
  text: string;
  hash: string | null;
  blocks: Block[];
  /** Footnote/endnote definitions from the file, kept alongside the blocks. */
  notes?: Note[];
  /** Bumped whenever the content changes for a reason other than typing. */
  externalRev: number;
  rev: number;
  savedRev: number;
}

export interface ConflictState {
  docId: string;
  title: string;
  diskText: string;
  diskHash: string | null;
}

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "warn" | "error";
}

export interface RecentProject {
  root: string;
  title: string;
  template: TemplateId;
  openedAt: number;
  /** A single document rather than a project folder. */
  single?: boolean;
}

export async function readRecent(): Promise<RecentProject[]> {
  try {
    const r = await configApi.read("recent.json");
    return r.exists ? (JSON.parse(r.content) as RecentProject[]) : [];
  } catch {
    return [];
  }
}

async function rememberRecent(p: RecentProject) {
  const list = (await readRecent()).filter((r) => r.root !== p.root);
  list.unshift(p);
  await configApi.write("recent.json", JSON.stringify(list.slice(0, 12), null, 2));
}

export async function forgetRecent(root: string) {
  const list = (await readRecent()).filter((r) => r.root !== root);
  await configApi.write("recent.json", JSON.stringify(list, null, 2));
}

/** Create the folder structure for a new project and return its root. */
export async function createProject(
  location: string,
  title: string,
  templateId: TemplateId,
  author: string,
  opts: { essayStyle?: EssayStyle; notePlacement?: NotePlacement; collection?: boolean } = {},
): Promise<string> {
  const template = TEMPLATES[templateId];
  const root = join(location, title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Untitled");
  if (await fsApi.exists(join(root, PROJECT_FILE))) throw new Error(`There is already a project in ${root}.`);
  const data = emptyProject(title, templateId, author, template.titlePageDefault);
  if (templateId === "essay") {
    // Chicago papers open with a title page; MLA papers never have one.
    const style = opts.essayStyle ?? "mla";
    Object.assign(data.settings, {
      essayStyle: style,
      notePlacement: opts.notePlacement ?? "footnotes",
      instructor: "",
      course: "",
      date: "",
      titlePage: style !== "mla",
    });
  }
  const ms = rootOf(data, "manuscript");
  const docs: { rel: string; content: string }[] = [];
  const dirs: string[] = [];
  if (templateId === "stage-play" && opts.collection) {
    // A collection (a trilogy…): each play is a folder with its own title page, front matter and acts.
    for (const [i, name] of ["One", "Two", "Three"].entries()) {
      const file = `0${i + 1}-play-${name.toLowerCase()}`;
      const play: BinderNode = { id: newId(), kind: "folder", title: `Play ${name}`, file, play: true, children: [] };
      play.children!.push({ id: newId(), kind: "folder", title: "Front matter", file: "01-front-matter", matter: true, children: [] });
      play.children!.push({ id: newId(), kind: "folder", title: "Act One", file: "02-act-one", children: [{ id: newId(), kind: "doc", title: "Scene 1", file: "01-scene-1.md" }] });
      ms.children!.push(play);
      docs.push({ rel: `manuscript/${file}/02-act-one/01-scene-1.md`, content: "" });
      dirs.push(`manuscript/${file}/01-front-matter`);
    }
  } else if (templateId === "stage-play") {
    const act: BinderNode = { id: newId(), kind: "folder", title: "Act One", file: "01-act-one", children: [] };
    act.children!.push({ id: newId(), kind: "doc", title: "Scene 1", file: "01-scene-1.md" });
    ms.children!.push(act);
    docs.push({ rel: "manuscript/01-act-one/01-scene-1.md", content: template.starter(1) });
  } else {
    const noun = template.docNoun;
    ms.children!.push({ id: newId(), kind: "doc", title: `${noun} 1`, file: `01-${slugify(noun)}-1.md` });
    docs.push({ rel: `manuscript/01-${slugify(noun)}-1.md`, content: template.starter(1) });
  }
  if (templateId === "essay") {
    // The sources page the style calls for, ready to fill in.
    const mla = (data.settings.essayStyle ?? "mla") === "mla";
    const title = mla ? "Works Cited" : "Bibliography";
    const file = `01-${slugify(title)}.md`;
    rootOf(data, "back").children!.push({ id: newId(), kind: "doc", title, file });
    docs.push({ rel: `back-matter/${file}`, content: "" });
  }
  for (const dir of [...ROOTS.map((r) => r.file), "notes", ...dirs]) await fsApi.mkdir(join(root, dir));
  for (const d of docs) await fsApi.write(join(root, d.rel), d.content, null);
  await fsApi.write(join(root, "README.md"), projectReadme(title, template), null);
  await fsApi.write(join(root, PROJECT_FILE), serializeProject(data), null);
  return root;
}

type Listener = () => void;

export class ProjectStore {
  version = 0;
  root: string;
  data: ProjectFile;
  projectHash: string | null;
  docs = new Map<string, DocState>();
  notes = new Map<string, { text: string; hash: string | null; dirty: boolean }>();
  missing = new Set<string>();
  /** Conflict copies made by sync services: node id -> title of the original. */
  conflictCopies = new Map<string, string>();
  selectedId: string | null = null;
  saveStatus: "saved" | "saving" | "error" = "saved";
  conflict: ConflictState | null = null;
  toasts: Toast[] = [];
  production: ProductionState | null = null;
  /** A single document opened on its own (File > Open document): no project.json, no binder. */
  single = false;
  goals: Goals = emptyGoals();
  private goalsTimer: number | undefined;

  private listeners = new Set<Listener>();
  private queue: Promise<unknown> = Promise.resolve();
  private saveTimers = new Map<string, number>();
  private noteTimers = new Map<string, number>();
  private pollTimer: number | null = null;
  private toastSeq = 0;
  private closed = false;

  private constructor(root: string, data: ProjectFile, hash: string | null) {
    this.root = root;
    this.data = data;
    this.projectHash = hash;
  }

  // ------------------------------------------------------------ lifecycle

  static async open(root: string): Promise<ProjectStore> {
    const r = await fsApi.read(join(root, PROJECT_FILE));
    let data: ProjectFile;
    let created = false;
    if (r.exists) {
      try {
        data = JSON.parse(r.content);
      } catch (e) {
        throw new Error(`project.json in ${root} is not valid JSON (${(e as Error).message}). Fix it in a text editor and try again.`);
      }
    } else {
      if (!(await fsApi.exists(root))) throw new Error(`${root} does not exist.`);
      const name = root.split("/").pop() || "Untitled";
      data = emptyProject(name, "stage-play", "", true);
      created = true;
    }
    data = normalizeData(data);
    const store = new ProjectStore(root, data, r.exists ? r.hash : null);
    const changed = await store.reconcile();
    if (changed || created) await store.writeProject(true);
    await store.loadManuscript();
    await store.loadExtras();
    const first = manuscriptOrder(store.data).find((x) => x.node.kind === "doc");
    store.selectedId = first?.node.id ?? null;
    if (store.selectedId) await store.ensureDoc(store.selectedId);
    await rememberRecent({ root, title: data.title, template: data.template, openedAt: Date.now() }).catch(() => {});
    store.startPolling();
    if (store.conflictCopies.size) {
      store.toast(`Found ${store.conflictCopies.size} conflict ${store.conflictCopies.size === 1 ? "copy" : "copies"} from a sync service. They are marked in the binder.`, "warn");
    }
    return store;
  }

  /** Open one markdown, text or Fountain file by itself. */
  static async openSingle(path: string): Promise<ProjectStore> {
    const r = await fsApi.read(path);
    if (!r.exists) throw new Error(`${path} does not exist.`);
    const dir = path.replace(/\/[^/]*$/, "") || "/";
    const name = path.split("/").pop()!;
    const template: TemplateId = /\.(fountain|spmd)$/i.test(name) ? "screenplay" : "document";
    const data = emptyProject(name.replace(/\.[^.]+$/, ""), template, "", false);
    const ms = rootOf(data, "manuscript");
    ms.file = "";
    const doc: BinderNode = { id: newId(), kind: "doc", title: data.title, file: name };
    ms.children = [doc];
    const store = new ProjectStore(dir, data, null);
    store.single = true;
    store.setFromDisk(doc.id, r.content, r.hash);
    store.selectedId = doc.id;
    await rememberRecent({ root: path, title: data.title, template, openedAt: Date.now(), single: true }).catch(() => {});
    store.startPolling();
    return store;
  }

  async close() {
    await this.flushAll();
    this.closed = true;
    if (this.pollTimer) window.clearInterval(this.pollTimer);
    this.listeners.clear();
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  toast(text: string, kind: Toast["kind"] = "info") {
    const t = { id: ++this.toastSeq, text, kind };
    this.toasts = [...this.toasts, t];
    this.emit();
    window.setTimeout(() => this.dismissToast(t.id), kind === "info" ? 3500 : 8000);
  }

  dismissToast(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.emit();
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  // ------------------------------------------------- production & goals

  private async loadExtras() {
    for (const [file, set] of [
      [PRODUCTION_FILE, (v: unknown) => (this.production = v as ProductionState)],
      [GOALS_FILE, (v: unknown) => (this.goals = { ...emptyGoals(), ...(v as Goals) })],
    ] as const) {
      try {
        const r = await fsApi.read(this.abs(file));
        if (r.exists) set(JSON.parse(r.content));
      } catch {
        this.toast(`${file} could not be read and was ignored.`, "warn");
      }
    }
    this.trackGoals();
  }

  /** Words in the typeset manuscript (front and back matter excluded). */
  manuscriptWords(): number {
    return manuscriptOrder(this.data).reduce((n, x) => n + (x.node.kind === "doc" ? wordCount(this.docs.get(x.node.id)?.blocks ?? []) : 0), 0);
  }

  private trackGoals() {
    if (this.single) return;
    const next = observe(this.goals, this.manuscriptWords());
    if (next === this.goals) return;
    this.goals = next;
    window.clearTimeout(this.goalsTimer);
    this.goalsTimer = window.setTimeout(() => void this.enqueue(() => fsApi.write(this.abs(GOALS_FILE), JSON.stringify(this.goals, null, 2) + "\n", null, true)), 2000);
  }

  setGoals(patch: Partial<Pick<Goals, "daily" | "project" | "deadline">>) {
    this.goals = { ...this.goals, ...patch };
    this.trackGoals();
    void this.enqueue(() => fsApi.write(this.abs(GOALS_FILE), JSON.stringify(this.goals, null, 2) + "\n", null, true));
    this.emit();
  }

  /** Set today's word count to any number (0 starts the day over). */
  resetGoalToday(value = 0) {
    this.goals = resetToday(this.goals, this.manuscriptWords(), value);
    void this.enqueue(() => fsApi.write(this.abs(GOALS_FILE), JSON.stringify(this.goals, null, 2) + "\n", null, true));
    this.emit();
  }

  /** The "key" of a line (or of a heading, index -1) for locking pages. */
  private keyAt = (docId: string, index: number): string | undefined => {
    if (index < 0) {
      const n = this.node(docId);
      return n ? `heading|${n.title}` : undefined;
    }
    const blocks = this.docs.get(docId)?.blocks;
    return blocks?.[index] ? contextKey(blocks, index) : undefined;
  };

  get inProduction(): boolean {
    return !!this.production?.active && this.template.mode === "script";
  }

  private baselineCache = new Map<string, Block[]>();

  /** A document as it was at the start of this revision (empty if it is new since). */
  private baselineBlocks(docId: string): Block[] {
    const md = this.production?.baseline?.[docId];
    if (md === undefined) return [];
    let b = this.baselineCache.get(docId);
    if (!b) {
      b = this.parse(docId, md);
      this.baselineCache.set(docId, b);
    }
    return b;
  }

  /**
   * Locked pages edited in this revision, and every page's lines as they were
   * at the start of the revision (the "old version" that gets archived).
   */
  productionPages(): { edited: number[]; before: Map<number, Entry[]> } {
    const p = this.production;
    if (!p?.active || !p.baseline || this.template.mode !== "script") return { edited: [], before: new Map() };
    const items = this.manuscriptItems();
    const old = items.map((it) => (it.kind === "folder" ? it : { ...it, blocks: this.baselineBlocks(it.id) }));
    const before = pageRegions(flatten(old), resolveAnchors(p.anchors, (id) => this.baselineBlocks(id)));
    const after = pageRegions(flatten(items), resolveAnchors(p.anchors, (id) => this.docs.get(id)?.blocks));
    return { edited: editedPages(before, after), before };
  }

  /** The label a locked page prints with now: "3", or "3A" once it has been edited. */
  pageLabelFor(page: number, edited: boolean): string {
    return `${page}${this.production ? letterName(letterFor(this.production, page, edited)) : ""}`;
  }

  /** Choose the letter of a revised page (0 = keep the plain number). */
  async setPageLetter(page: number, letter: number) {
    if (!this.production) return;
    this.production = { ...this.production, currentLetters: { ...this.production.currentLetters, [page]: letter } };
    await this.writeProduction();
    this.emit();
  }

  private archiveTimer: number | undefined;
  private scheduleArchive() {
    if (!this.inProduction) return;
    window.clearTimeout(this.archiveTimer);
    this.archiveTimer = window.setTimeout(() => void this.archiveEditedPages(), 1500);
  }

  /** The first time a locked page is edited in a revision, keep its old version in the Archive. */
  async archiveEditedPages() {
    const p = this.production;
    if (!this.inProduction || !p?.baseline) return;
    const { edited, before } = this.productionPages();
    for (const page of edited) {
      const key = `${p.revision}:${page}`;
      if (this.production!.archived?.[key]) continue;
      const blocks = (before.get(page) ?? []).filter((e) => e.block).map((e) => e.block!);
      if (!blocks.length) continue;
      const content = serializeDoc({ blocks, frontMatter: null }, "script");
      // Named after the page as it printed before this revision's edits.
      const title = `Page ${this.pageLabelFor(page, false)} — replaced in ${p.revision} revision (${p.revisionDate})`;
      const id = await this.addDoc(rootOf(this.data, "archive").id, undefined, "archive", { title, content }, { select: false });
      this.production = { ...this.production!, archived: { ...this.production!.archived, [key]: id } };
      await this.writeProduction();
      this.toast(`Page ${page} was revised: it is now ${this.pageLabelFor(page, true)}, and the old page is in the Archive.`);
    }
  }

  /** Lock markers and revision marks for the Typst generator. */
  productionOptions(): GenOptions["production"] | undefined {
    const p = this.production;
    if (!p?.active || this.template.mode !== "script") return undefined;
    const resolved = resolveAnchors(p.anchors, (id) => this.docs.get(id)?.blocks);
    const edited = new Set(this.productionPages().edited);
    const locks = new Map([...resolved].map(([id, a]) => [id, { page: a.page, hard: !a.split, letter: letterFor(p, a.page, edited.has(a.page)) }]));
    const revised = new Map<string, Set<number>>();
    for (const n of this.typesetDocs()) revised.set(n.id, revisedLines(p.snapshot[n.id], this.docs.get(n.id)?.blocks ?? []));
    return { locks, revised, label: `${p.revision} Rev. ${p.revisionDate}` };
  }

  private async writeProduction() {
    await this.enqueue(() => fsApi.write(this.abs(PRODUCTION_FILE), JSON.stringify(this.production, null, 2) + "\n", null, true));
  }

  /** Lock every page as it is typeset now. `ids` are element ids in order. */
  async lockPages(ids: string[], first: number[], last: number[], pageCount: number, revision: string) {
    await this.flushAll();
    // Script page 1 is the page where the manuscript begins (after the title page and front matter).
    const inManuscript = new Set(manuscriptOrder(this.data).map((x) => x.node.id));
    const firstIdx = ids.findIndex((id, i) => inManuscript.has(id.split("#")[0]) && first[i] > 0);
    const firstScriptPage = firstIdx >= 0 ? first[firstIdx] : this.data.settings.titlePage ? 2 : 1;
    // A page is never locked to a heading from another part: an (empty) front matter page or a play's title page.
    const sectionOf = (id: string) => {
      const role = roleOf(this.data, id);
      if (this.node(id)?.play) return `play:${id}`;
      return role === "front" || role === "back" || inMatterFolder(this.data, id) ? `matter:${id}` : "body";
    };
    const anchors = computeAnchors(ids, first, last, this.keyAt, firstScriptPage, pageCount, sectionOf);
    this.production = {
      formatVersion: 1,
      active: true,
      revision,
      revisionDate: new Date().toLocaleDateString(),
      lockedAt: new Date().toISOString(),
      pageCount: pageCount - firstScriptPage + 1,
      anchors,
      snapshot: snapshotOf(this.typesetDocs().map((n) => ({ id: n.id, blocks: this.docs.get(n.id)?.blocks ?? [] }))),
      baseline: this.baselineNow(),
      pageLetters: {},
      currentLetters: {},
      archived: {},
    };
    this.baselineCache.clear();
    await this.writeProduction();
    this.toast(`Locked ${this.production.pageCount} pages. An edited page becomes 3A, 3B… and its old version goes to the Archive.`);
    this.emit();
  }

  /** The typeset documents' markdown now: the baseline a revision is measured against. */
  private baselineNow(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const n of this.typesetDocs()) out[n.id] = this.serialize(n.id, this.docs.get(n.id)?.blocks ?? [], this.docs.get(n.id)?.notes);
    return out;
  }

  /**
   * Start the next revision colour: today's script becomes the baseline, pages
   * revised in this revision keep their letters (3A), and a page edited again
   * moves on to the next letter (3B). Page locks stay.
   */
  async nextRevision(revision: string) {
    if (!this.production) return;
    await this.flushAll();
    const p = this.production;
    const { edited } = this.productionPages();
    const pageLetters = { ...p.pageLetters };
    for (const page of edited) pageLetters[page] = letterFor(p, page, true);
    // Re-key every lock to its line as it is now, so locks keep finding their lines.
    const resolved = resolveAnchors(p.anchors, (id) => this.docs.get(id)?.blocks);
    const anchors = [...resolved].map(([id, a]) => {
      const [docId, idx] = id.split("#");
      const key = this.keyAt(docId, Number(idx));
      return key === undefined ? a : { ...a, index: Number(idx), key: hashKey(key) };
    });
    this.production = {
      ...p,
      active: true,
      revision,
      revisionDate: new Date().toLocaleDateString(),
      anchors,
      snapshot: snapshotOf(this.typesetDocs().map((n) => ({ id: n.id, blocks: this.docs.get(n.id)?.blocks ?? [] }))),
      baseline: this.baselineNow(),
      pageLetters,
      currentLetters: {},
    };
    this.baselineCache.clear();
    await this.writeProduction();
    this.emit();
  }

  async unlockPages() {
    if (!this.production) return;
    this.production = { ...this.production, active: false };
    await this.writeProduction();
    this.toast("Left production mode. Pages flow freely again.");
    this.emit();
  }

  // ----------------------------------------------------- find & replace

  /** Replace a document's lines (find & replace); the editor reloads and it saves as usual. */
  replaceBlocks(id: string, blocks: Block[]) {
    const d = this.docs.get(id);
    if (!d) return;
    d.blocks = blocks;
    d.rev++;
    d.externalRev++;
    this.scheduleSave(id);
    this.trackGoals();
    this.scheduleArchive();
    this.emit();
  }

  /** Make sure every document that can be searched is loaded. */
  async loadAllDocs() {
    const ids: string[] = [];
    walkNodes(this.data.binder, (n) => {
      if (n.kind === "doc" && !this.missing.has(n.id) && !this.docs.has(n.id)) ids.push(n.id);
    });
    for (const id of ids) await this.ensureDoc(id);
  }

  // ------------------------------------------------------------ citations

  /** The style "/cite" writes in: an essay's own style, otherwise the one last chosen (MLA to start). */
  get citationStyle(): ReferenceStyle {
    if (this.data.template === "essay") return this.data.settings.essayStyle ?? "mla";
    return this.data.settings.citationStyle ?? "mla";
  }

  /** Chicago notes: where notes print, or null when this project uses in-text citations. */
  get notePlacement(): NotePlacement | null {
    if (this.data.template !== "essay" || this.data.settings.essayStyle !== "chicago-notes") return null;
    return this.data.settings.notePlacement ?? "footnotes";
  }

  /** Sources cited so far, newest first. */
  get sources(): Source[] {
    return [...(this.data.sources ?? [])].reverse();
  }

  /**
   * Remember a source and put its entry on the Works Cited or Bibliography page
   * (made if there isn't one yet), in alphabetical order. A source already
   * remembered is updated rather than added twice. Returns the stored source.
   */
  async addSource(src: Source, style: ReferenceStyle): Promise<Source> {
    if (this.data.template !== "essay" && (style === "mla" || style === "chicago") && style !== this.data.settings.citationStyle) {
      this.data.settings.citationStyle = style;
    }
    const list = (this.data.sources ??= []);
    const i = list.findIndex((s) => s.id === src.id || sameSource(s, src));
    let stored: Source;
    if (i >= 0) {
      stored = { ...src, id: list[i].id };
      list.splice(i, 1);
    } else stored = src;
    list.push(stored);
    this.emit();
    if (this.single) this.toast("A single document has no Works Cited page; the source is remembered until you close it. Import the document into a project to keep a sources page.");
    else {
      await this.saveProject();
      await this.addToSourcesPage(stored, style).catch((e) => this.toast(`Could not add the source to the sources page: ${(e as Error).message}`, "warn"));
    }
    return stored;
  }

  /** Cite a remembered source again: it moves to the top of the list. */
  touchSource(id: string) {
    const list = this.data.sources ?? [];
    const i = list.findIndex((s) => s.id === id);
    if (i < 0 || i === list.length - 1) return;
    list.push(...list.splice(i, 1));
    if (!this.single) void this.saveProject();
  }

  private async addToSourcesPage(src: Source, style: ReferenceStyle) {
    const back = rootOf(this.data, "back");
    const want = sourcesPageTitle(style).toLowerCase();
    const pages: BinderNode[] = [];
    walkNodes(back.children ?? [], (n) => {
      if (n.kind === "doc" && ["works cited", "bibliography", "references"].includes(n.title.trim().toLowerCase())) pages.push(n);
    });
    let page = pages.find((n) => n.title.trim().toLowerCase() === want) ?? pages[0];
    if (!page) {
      const preset = presetFor(sourcesPageTitle(style));
      const id = await this.addDoc(back.id, undefined, "back", { title: preset?.title ?? sourcesPageTitle(style), content: "" }, { select: false });
      page = this.node(id)!;
      this.toast(`Added a ${page.title} page to the back matter.`);
    }
    await this.ensureDoc(page.id);
    const runs = referenceEntry(src, style);
    const text = runs.map((r) => r.text).join("");
    const blocks = (this.docs.get(page.id)?.blocks ?? []).filter((b) => blockText(b).trim());
    if (blocks.some((b) => blockText(b).trim() === text)) return;
    const entry: Block = { type: "citation", runs };
    // Alphabetical among the entries; anything that isn't an entry (a note, a heading) stays where it is.
    let at = blocks.length;
    for (let k = 0; k < blocks.length; k++) {
      if (blocks[k].type === "citation" && sortKey(blockText(blocks[k])) > sortKey(text)) {
        at = k;
        break;
      }
    }
    blocks.splice(at, 0, entry);
    this.replaceBlocks(page.id, blocks);
  }

  // ---------------------------------------------------------------- notes

  /** The text of a footnote/endnote, if this document has one with that id. */
  noteOf(docId: string, id: string): Note | undefined {
    return this.docs.get(docId)?.notes?.find((n) => n.id === id);
  }

  /** Add or replace a note. The marker itself is inserted by the editor. */
  addNote(docId: string, id: string, runs: Run[]) {
    const d = this.docs.get(docId);
    if (!d) return;
    const notes = (d.notes ??= []);
    const i = notes.findIndex((n) => n.id === id);
    if (i >= 0) notes[i] = { id, runs };
    else notes.push({ id, runs });
    d.rev++;
    this.scheduleSave(docId);
    this.emit();
  }

  /** Delete a note and every marker pointing at it, then reload the editor. */
  removeNote(docId: string, id: string) {
    const d = this.docs.get(docId);
    if (!d) return;
    if (d.notes) d.notes = d.notes.filter((n) => n.id !== id);
    d.blocks = d.blocks.map((b) => (b.runs.some((r) => r.note === id) ? { ...b, runs: b.runs.filter((r) => r.note !== id) } : b));
    d.rev++;
    d.externalRev++;
    this.scheduleSave(docId);
    this.emit();
  }

  // --------------------------------------------------------------- images

  /** Copy an image into the project's assets folder; returns its path relative to the project. */
  async addImage(name: string, source: { path?: string; data?: string }): Promise<string> {
    const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "png").toLowerCase();
    const rel = `assets/${slugify(name.replace(/\.[^.]+$/, ""))}-${newId().slice(0, 6)}.${ext}`;
    if (source.path) await call("fs.copy", { from: source.path, to: this.abs(rel) });
    else await call("fs.writeBase64", { path: this.abs(rel), data: source.data });
    return rel;
  }

  // ------------------------------------------------------------- queries

  get template(): Template {
    return getTemplate(this.data.template);
  }

  abs(rel: string) {
    return join(this.root, rel);
  }

  pathOf(id: string): string | null {
    const rel = nodePath(this.data, id);
    return rel ? this.abs(rel) : null;
  }

  /**
   * The template a document is edited with: the project's format for the
   * manuscript (and archived drafts), typeset prose for front and back matter,
   * Notion-style blocks for characters and research.
   */
  templateFor(id: string): Template {
    const role = roleOf(this.data, id);
    if (inMatterFolder(this.data, id)) return MATTER_TEMPLATE;
    if (role === "manuscript" || role === "archive") return this.template;
    if (role === "front" || role === "back") return MATTER_TEMPLATE;
    return NOTES_TEMPLATE;
  }

  node(id: string) {
    return findNode(this.data, id);
  }

  meta(): ProjectMeta {
    return {
      title: this.data.title,
      subtitle: this.data.subtitle ?? "",
      author: this.data.author,
      contact: this.data.contact,
      titlePage: this.data.settings.titlePage,
      paper: this.data.settings.paper,
      sceneNewPage: this.template.mode === "script" ? sceneNewPageDefault(this.data.template, this.data.settings.sceneNewPage) : undefined,
      autoContd: this.template.mode === "script" ? (this.data.settings.autoContd ?? this.data.template === "screenplay") : undefined,
      sceneBreak:
        this.data.template === "book" ? { style: this.data.settings.sceneBreak ?? "asterisks", image: this.data.settings.sceneBreakImage } : undefined,
      essay:
        this.data.template === "essay"
          ? {
              style: this.data.settings.essayStyle ?? "mla",
              notePlacement: this.data.settings.notePlacement ?? "footnotes",
              instructor: this.data.settings.instructor ?? "",
              course: this.data.settings.course ?? "",
              date: this.data.settings.date ?? "",
            }
          : undefined,
    };
  }

  /** Everything that is typeset, in order: front matter, the manuscript, back matter. */
  manuscriptItems(): ManuscriptItem[] {
    const items: ManuscriptItem[] = [];
    const usable = (id: string) => !this.conflictCopies.has(id) && !this.missing.has(id);
    const text = (id: string) => ({ blocks: this.docs.get(id)?.blocks ?? [], notes: this.docs.get(id)?.notes });
    for (const where of ["front", "back"] as const) {
      if (where === "back") {
        const walk = (nodes: BinderNode[], depth: number, chapter: boolean) => {
          for (const node of nodes) {
            if (chapter) {
              // Inside a book chapter everything is a section that runs on from the one before.
              if (node.kind === "folder") walk(node.children ?? [], depth + 1, true);
              else if (usable(node.id)) items.push({ kind: "doc", id: node.id, title: node.title, ...text(node.id), section: true });
            } else if (node.kind === "folder" && node.chapter && this.data.template === "book") {
              items.push({ kind: "folder", id: node.id, title: node.title, depth, chapter: true });
              walk(node.children ?? [], depth + 1, true);
            } else if (node.kind === "folder" && node.matter) {
              // A play's own front matter: typeset like the project's, after the play's title page.
              walkNodes(node.children ?? [], (n) => {
                if (n.kind === "doc" && usable(n.id)) items.push({ kind: "matter", id: n.id, title: n.title, ...text(n.id), where: "front" });
              });
            } else if (node.kind === "folder") {
              items.push(node.play ? { kind: "play", id: node.id, title: node.title } : { kind: "folder", id: node.id, title: node.title, depth });
              walk(node.children ?? [], depth + 1, false);
            } else if (usable(node.id)) items.push({ kind: "doc", id: node.id, title: node.title, ...text(node.id) });
          }
        };
        walk(rootOf(this.data, "manuscript")?.children ?? [], 1, false);
      }
      for (const { node } of manuscriptOrder(this.data, where)) {
        if (node.kind === "doc" && usable(node.id)) items.push({ kind: "matter", id: node.id, title: node.title, ...text(node.id), where });
      }
    }
    return items;
  }

  /** Typeset documents (front matter, manuscript, back matter) in reading order. */
  typesetDocs(): BinderNode[] {
    return (["front", "manuscript", "back"] as const).flatMap((r) => manuscriptOrder(this.data, r).map((x) => x.node).filter((n) => n.kind === "doc"));
  }

  /**
   * Grey text for an empty document, replaced by whatever the writer types,
   * and the type its first line starts as. New documents are created empty.
   */
  hintFor(id: string): { text: string; type?: ElementType } | null {
    const node = this.node(id);
    if (!node) return null;
    const role = roleOf(this.data, id);
    if (role === "front" || role === "back" || inMatterFolder(this.data, id)) {
      const p = presetFor(node.title);
      return p?.hint ? { text: p.hint, type: p.firstType } : null;
    }
    if (role === "characters") return { text: "Character name", type: "title" };
    if (role === "research") return { text: node.title, type: "title" };
    if (role === "manuscript" || role === "archive") {
      const t = this.template;
      if (t.mode === "script") return { text: t.id === "screenplay" ? "INT. LOCATION - DAY" : node.title };
      if (t.mode === "poem") return { text: node.title, type: "title" };
    }
    return null;
  }

  /** Character names used anywhere in the manuscript, most frequent first. */
  characterNames(exceptDocId?: string): string[] {
    const counts = new Map<string, number>();
    for (const [id, d] of this.docs.entries()) {
      if (id === exceptDocId) continue;
      for (const b of d.blocks)
        if (b.type === "character") {
          const name = blockText(b).trim().toUpperCase().replace(/\s*\(.*\)$/, "");
          if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
        }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  }

  isDirty(): boolean {
    for (const d of this.docs.values()) if (d.rev !== d.savedRev) return true;
    for (const n of this.notes.values()) if (n.dirty) return true;
    return false;
  }

  // --------------------------------------------------------------- loading

  private parse(id: string, text: string): Block[] {
    const t = this.templateFor(id);
    const doc = parseDoc(text, t.mode, hasType(t, "title"), hasType(t, "citation"));
    if (t.mode === "script") return adaptScriptTypes(doc, t.elements.some((e) => e.type === "action") ? "action" : "direction").blocks;
    return doc.blocks;
  }

  private frontMatter = new Map<string, string | null>();

  private serialize(id: string, blocks: Block[], notes?: Note[]): string {
    const t = this.templateFor(id);
    return serializeDoc({ blocks, frontMatter: this.frontMatter.get(id) ?? null, notes }, t.mode);
  }

  private setFromDisk(id: string, text: string, hash: string | null) {
    const t = this.templateFor(id);
    const parsed = parseDoc(text, t.mode, hasType(t, "title"), hasType(t, "citation"));
    this.frontMatter.set(id, parsed.frontMatter);
    const prev = this.docs.get(id);
    const rev = (prev?.rev ?? 0) + 1;
    this.docs.set(id, {
      text,
      hash,
      blocks: this.parse(id, text),
      notes: parsed.notes,
      externalRev: (prev?.externalRev ?? 0) + 1,
      rev,
      savedRev: rev,
    });
  }

  private async loadManuscript() {
    const ids = this.typesetDocs()
      .filter((n) => !this.missing.has(n.id))
      .map((n) => n.id);
    await Promise.all(ids.map((id) => this.readDoc(id)));
  }

  private async readDoc(id: string) {
    const p = this.pathOf(id);
    if (!p) return;
    const r = await fsApi.read(p);
    if (!r.exists) {
      this.missing.add(id);
      return;
    }
    this.missing.delete(id);
    this.setFromDisk(id, r.content, r.hash);
  }

  async ensureDoc(id: string) {
    if (!this.docs.has(id)) {
      await this.enqueue(() => this.readDoc(id));
      this.emit();
    }
  }

  async select(id: string | null) {
    if (id === this.selectedId) return;
    if (this.selectedId) await this.flushDoc(this.selectedId);
    this.selectedId = id;
    const n = id ? this.node(id) : null;
    if (id && n?.kind === "doc") await this.ensureDoc(id);
    if (id && n?.notes) await this.loadNotes(id);
    this.emit();
  }

  /** Make project.json agree with the folder: add files created outside the app, flag missing ones. */
  private async reconcile(): Promise<boolean> {
    let changed = false;
    const entries = await fsApi.walk(this.root);
    const onDisk = new Map(entries.map((e) => [e.path.toLowerCase(), e]));
    this.missing.clear();
    this.conflictCopies.clear();
    for (const rootNode of this.data.binder) {
      const known = new Map<string, BinderNode>();
      const rec = (n: BinderNode, rel: string) => {
        known.set(rel.toLowerCase(), n);
        for (const c of n.children ?? []) rec(c, `${rel}/${c.file}`);
      };
      rec(rootNode, rootNode.file);
      for (const [rel, n] of known) if (!onDisk.has(rel) && n !== rootNode) this.missing.add(n.id);
      if (!onDisk.has(rootNode.file.toLowerCase())) await fsApi.mkdir(this.abs(rootNode.file));
      // New files and folders, in name order (so number prefixes give the order).
      for (const e of entries) {
        if (!e.path.toLowerCase().startsWith(rootNode.file.toLowerCase() + "/")) continue;
        if (known.has(e.path.toLowerCase())) continue;
        if (!e.isDir && !TEXT_EXT.test(e.path)) continue;
        const segs = e.path.split("/");
        const name = segs.pop()!;
        const parent = known.get(segs.join("/").toLowerCase());
        if (!parent) continue;
        const node: BinderNode = {
          id: newId(),
          kind: e.isDir ? "folder" : "doc",
          title: titleFromFile(name),
          file: name,
          ...(e.isDir ? { children: [] } : {}),
        };
        (parent.children ??= []).push(node);
        known.set(e.path.toLowerCase(), node);
        changed = true;
      }
    }
    // Conflict copies: "Scene 2 (conflicted copy).md" next to "Scene 2.md".
    walkNodes(this.data.binder, (n, parent) => {
      if (n.kind !== "doc" || !parent) return;
      const base = conflictBase(n.file);
      if (!base) return;
      const original = parent.children?.find((c) => c !== n && c.file.toLowerCase() === base.toLowerCase());
      if (original) this.conflictCopies.set(n.id, original.title);
    });
    return changed;
  }

  // --------------------------------------------------------------- editing

  /** Called by the editor on every change. Saves about a second after typing stops. */
  updateDoc(id: string, blocks: Block[]) {
    const d = this.docs.get(id);
    if (!d) return;
    d.blocks = blocks;
    d.rev++;
    this.scheduleSave(id);
    this.trackGoals();
    this.scheduleArchive();
    this.emit();
  }

  private scheduleSave(id: string) {
    window.clearTimeout(this.saveTimers.get(id));
    this.saveTimers.set(
      id,
      window.setTimeout(() => {
        this.saveTimers.delete(id);
        void this.saveDoc(id);
      }, AUTOSAVE_MS),
    );
  }

  async flushDoc(id: string) {
    if (this.saveTimers.has(id)) {
      window.clearTimeout(this.saveTimers.get(id));
      this.saveTimers.delete(id);
    }
    await this.saveDoc(id);
  }

  async flushAll() {
    const ids = [...this.docs.keys()];
    await Promise.all(ids.map((id) => this.flushDoc(id)));
    await Promise.all([...this.notes.keys()].map((id) => this.flushNotes(id)));
    await this.queue;
  }

  private saveDoc(id: string): Promise<void> {
    return this.enqueue(async () => {
      const d = this.docs.get(id);
      if (!d || d.rev === d.savedRev || this.closed) return;
      if (this.conflict?.docId === id) return; // wait for the writer to decide
      const path = this.pathOf(id);
      if (!path) return;
      const rev = d.rev;
      const text = this.serialize(id, d.blocks, d.notes);
      if (text === d.text) {
        d.savedRev = rev;
        this.emit();
        return;
      }
      this.saveStatus = "saving";
      this.emit();
      try {
        const { hash } = await fsApi.write(path, text, d.hash);
        d.text = text;
        d.hash = hash;
        d.savedRev = rev;
        this.missing.delete(id);
        this.saveStatus = "saved";
      } catch (e) {
        if (e instanceof BackendError && e.isConflict) {
          const disk = await fsApi.read(path);
          this.conflict = { docId: id, title: this.node(id)?.title ?? "", diskText: disk.content, diskHash: disk.hash };
          this.saveStatus = "saved";
        } else {
          this.saveStatus = "error";
          this.toast(`Could not save: ${(e as Error).message}`, "error");
        }
      }
      this.emit();
    });
  }

  /** The writer chose how to settle an outside edit that clashed with unsaved typing. */
  async resolveConflict(choice: "disk" | "mine") {
    const c = this.conflict;
    if (!c) return;
    await this.enqueue(async () => {
      const path = this.pathOf(c.docId);
      const d = this.docs.get(c.docId);
      if (!path || !d) return;
      if (choice === "disk") {
        // Keep the unsaved version in .trash so nothing typed is lost.
        await this.stash(path, this.serialize(c.docId, d.blocks, d.notes), "unsaved");
        this.setFromDisk(c.docId, c.diskText, c.diskHash);
      } else {
        await this.stash(path, c.diskText, "outside-edit");
        const text = this.serialize(c.docId, d.blocks, d.notes);
        const { hash } = await fsApi.write(path, text, null, true);
        d.text = text;
        d.hash = hash;
        d.savedRev = d.rev;
      }
      this.conflict = null;
    });
    this.toast(choice === "disk" ? "Loaded the version on disk. Your unsaved text was kept in .trash." : "Kept your version. The outside edit was kept in .trash.");
    this.emit();
  }

  private async stash(path: string, content: string, label: string) {
    const name = path.split("/").pop()!.replace(/\.md$/, "");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    await fsApi.write(join(this.root, ".trash", `${name} (${label} ${stamp}).md`), content, null, true);
  }

  // ----------------------------------------------------------------- notes

  notesPath(id: string): string | null {
    const n = this.node(id);
    return n?.notes ? this.abs(n.notes) : null;
  }

  async loadNotes(id: string) {
    const p = this.notesPath(id);
    if (!p || this.notes.has(id)) return;
    const r = await fsApi.read(p);
    this.notes.set(id, { text: r.content, hash: r.hash, dirty: false });
    this.emit();
  }

  updateNotes(id: string, text: string) {
    const n = this.node(id);
    if (!n) return;
    if (!n.notes) {
      // A hostile project.json could carry an id with path separators; keep the
      // generated notes path a plain segment inside notes/ whatever the id is.
      const suffix = isSafeId(n.id) ? n.id.slice(0, 6) : newId().slice(0, 6);
      const candidate = `notes/${slugify(n.title)}-${suffix}.md`;
      n.notes = isSafeNotesPath(candidate) ? candidate : `notes/note-${newId()}.md`;
      void this.writeProject();
    }
    const cur = this.notes.get(id) ?? { text: "", hash: null, dirty: false };
    this.notes.set(id, { ...cur, text, dirty: true });
    window.clearTimeout(this.noteTimers.get(id));
    this.noteTimers.set(id, window.setTimeout(() => void this.flushNotes(id), AUTOSAVE_MS));
    this.emit();
  }

  async flushNotes(id: string) {
    window.clearTimeout(this.noteTimers.get(id));
    this.noteTimers.delete(id);
    await this.enqueue(async () => {
      const n = this.notes.get(id);
      const p = this.notesPath(id);
      if (!n?.dirty || !p) return;
      try {
        const { hash } = await fsApi.write(p, n.text, n.hash);
        this.notes.set(id, { text: n.text, hash, dirty: false });
      } catch (e) {
        if (e instanceof BackendError && e.isConflict) {
          // Both versions are kept: the outside edit goes to .trash, ours is written.
          const disk = await fsApi.read(p);
          await this.stash(p, disk.content, "outside-edit");
          const { hash } = await fsApi.write(p, n.text, null, true);
          this.notes.set(id, { text: n.text, hash, dirty: false });
          this.toast("Notes were also changed outside the app; that version was kept in .trash.", "warn");
        } else throw e;
      }
      this.emit();
    });
  }

  // ---------------------------------------------------------- project.json

  private async writeProject(force = false) {
    if (this.single) return;
    const text = serializeProject(stripRuntime(this.data));
    try {
      const { hash } = await fsApi.write(this.abs(PROJECT_FILE), text, this.projectHash, force);
      this.projectHash = hash;
    } catch (e) {
      if (e instanceof BackendError && e.isConflict) {
        this.toast("project.json was changed outside the app, so the binder was reloaded from disk.", "warn");
        await this.reloadProject();
      } else {
        this.toast(`Could not save project.json: ${(e as Error).message}`, "error");
      }
    }
  }

  private saveProject() {
    return this.enqueue(() => this.writeProject());
  }

  private async reloadProject() {
    const r = await fsApi.read(this.abs(PROJECT_FILE));
    if (!r.exists) return;
    try {
      this.data = normalizeData(JSON.parse(r.content));
    } catch {
      this.toast("project.json changed on disk but is not valid JSON; keeping the binder as it was.", "error");
      return;
    }
    this.projectHash = r.hash;
    if (await this.reconcile()) await this.writeProject(true);
    await this.loadManuscript();
    if (this.selectedId && !this.node(this.selectedId)) this.selectedId = null;
    this.emit();
  }

  async updateMeta(patch: Partial<Pick<ProjectFile, "title" | "subtitle" | "author" | "contact" | "theme">> & { settings?: Partial<ProjectFile["settings"]> }) {
    const { settings, ...rest } = patch;
    Object.assign(this.data, rest);
    if (settings) Object.assign(this.data.settings, settings);
    this.emit();
    await this.saveProject();
  }

  // ---------------------------------------------------------- binder ops

  /** Give the children of `folder` the file names their order and titles call for. */
  private async syncNames(folder: BinderNode) {
    const role = roleOf(this.data, folder.id);
    const numbered = !!role && TYPESET_ROLES.includes(role);
    const dir = this.pathOf(folder.id)!;
    const taken = new Set<string>();
    const plan = (folder.children ?? []).map((c, i) => ({ c, want: desiredName(c, i, numbered, taken) }));
    const moving = plan.filter((p) => p.c.file !== p.want);
    let failed = false;
    // Two phases so swapping 01-a and 02-b never collides. The file name kept in
    // the binder must always be one that exists on disk: if a rename fails (a file
    // locked elsewhere, a case-only rename on a case-insensitive volume), the name
    // is left where it is rather than pointing at a path that is not there.
    const toTemp: typeof moving = [];
    for (const p of moving) {
      const tmp = `~mw-${p.c.id}-${p.c.file}`;
      try {
        await fsApi.rename(join(dir, p.c.file), join(dir, tmp));
        p.c.file = tmp;
        toTemp.push(p);
      } catch {
        failed = true;
      }
    }
    for (const p of toTemp) {
      try {
        await fsApi.rename(join(dir, p.c.file), join(dir, p.want));
        p.c.file = p.want;
      } catch {
        // The file is still under its temporary name, which does exist.
        failed = true;
      }
    }
    if (failed) this.toast("Some files could not be renamed; the binder was left pointing at the files as they are.", "warn");
  }

  /**
   * Where the "+" on a binder section should put a new document: next to the
   * selected item when it is in that section (inside it if it is a folder),
   * otherwise at the end of the section.
   */
  insertionPoint(role: Role): { parentId: string; afterId?: string } {
    const root = rootOf(this.data, role);
    const sel = this.selectedId ? this.node(this.selectedId) : null;
    if (!sel || sel.role || roleOf(this.data, sel.id) !== role) {
      // Put it after the last document, inside the last folder if the section ends with one (Act One…).
      const last = root.children?.[root.children.length - 1];
      if (last?.kind === "folder") return { parentId: last.id };
      return { parentId: root.id };
    }
    // Books: a new chapter goes after the chapter you're in, never among its sections.
    const chapter = role === "manuscript" ? (sel.kind === "folder" && sel.chapter ? sel : chapterOf(this.data, sel.id)) : null;
    if (chapter) return { parentId: parentOf(this.data, chapter.id)!.id, afterId: chapter.id };
    if (sel.kind === "folder") return { parentId: sel.id };
    return { parentId: parentOf(this.data, sel.id)!.id, afterId: sel.id };
  }

  async addDoc(parentId?: string, afterId?: string, role: Role = "manuscript", preset?: { title: string; content: string }, opts: { select?: boolean; atStart?: boolean } = {}) {
    return this.enqueue(async () => {
      const parent = (parentId && this.node(parentId)) || rootOf(this.data, role);
      const r = roleOf(this.data, parent.id) ?? role;
      const matter = inMatterFolder(this.data, parent.id);
      // A book chapter's sections are numbered within the chapter.
      const chapter = parent.kind === "folder" && parent.chapter ? parent : chapterOf(this.data, parent.id);
      let count = 0;
      // Scenes are numbered within their play.
      const play = playOf(this.data, parent.id);
      walkNodes((chapter ?? play ?? rootOf(this.data, r)).children ?? [], (n) => {
        // A chapter split into sections counts once, as a chapter.
        if (chapter ? n.kind === "doc" : (n.kind === "doc" && !inMatterFolder(this.data, n.id) && !chapterOf(this.data, n.id)) || (n.kind === "folder" && n.chapter)) count++;
      });
      const noun = matter
        ? "Page"
        : chapter
          ? "Section"
          : r === "manuscript" || r === "archive"
            ? this.template.docNoun
            : r === "characters"
              ? "Character"
              : r === "research"
                ? "Note"
                : "Page";
      const node: BinderNode = { id: newId(), kind: "doc", title: preset?.title ?? `${noun} ${count + 1}`, file: `~new-${newId()}.md` };
      const kids = (parent.children ??= []);
      const at = afterId ? kids.findIndex((k) => k.id === afterId) + 1 : opts.atStart ? 0 : kids.length;
      kids.splice(at >= 0 ? at : kids.length, 0, node);
      // New pages start empty; the editor shows grey hint text until the writer types (hintFor).
      const content = preset?.content ?? (r === "manuscript" || r === "archive" ? this.template.starter(count + 1) : "");
      await fsApi.write(join(this.pathOf(parent.id)!, node.file), content, null);
      await this.syncNames(parent);
      await this.writeProject();
      this.setFromDisk(node.id, content, (await fsApi.read(this.pathOf(node.id)!)).hash);
      if (opts.select !== false) this.selectedId = node.id;
      this.emit();
      return node.id;
    });
  }

  /**
   * A title page to type in, first in the project's front matter or (in a
   * collection) a play's. It starts as the automatic title page written out, and replaces it.
   * If there is one already, it is opened instead.
   */
  async addTitlePage(parentId: string, role: Role) {
    const parent = this.node(parentId) ?? rootOf(this.data, role);
    const existing = (parent.children ?? []).find((n) => n.kind === "doc" && isTitlePageName(n.title));
    if (existing) return this.select(existing.id);
    const play = parent.matter ? playOf(this.data, parent.id) : undefined;
    const content = titlePageStarter(this.meta(), this.template.id as TemplateId, play?.title);
    if (!play && !this.data.settings.titlePage) await this.updateMeta({ settings: { titlePage: true } });
    return this.addDoc(parent.id, undefined, role, { title: TITLE_PAGE, content }, { atStart: true });
  }

  /**
   * Books: add a section to a chapter. A chapter that is still a single
   * document first becomes a chapter folder, with its text as Section 1, so
   * nothing is lost; its notes stay with that first section.
   */
  async addSection(chapterId: string) {
    const node = this.node(chapterId);
    if (!node || node.role || this.data.template !== "book") return;
    if (node.kind === "folder") return node.chapter ? this.addDoc(node.id) : undefined;
    if (chapterOf(this.data, node.id)) return this.addDoc(parentOf(this.data, node.id)!.id, node.id);
    await this.flushAll();
    const folderId = await this.enqueue(async () => {
      const parent = parentOf(this.data, node.id)!;
      const oldPath = this.pathOf(node.id)!;
      const folder: BinderNode = { id: newId(), kind: "folder", title: node.title, file: `~new-${newId()}`, chapter: true, children: [] };
      if (node.icon) {
        folder.icon = node.icon;
        delete node.icon;
      }
      const kids = parent.children!;
      kids.splice(kids.indexOf(node), 1, folder);
      await fsApi.mkdir(join(this.pathOf(parent.id)!, folder.file));
      const tmp = `~mw-${node.id}-${node.file}`;
      await fsApi.rename(oldPath, join(this.pathOf(folder.id)!, tmp));
      node.file = tmp;
      node.title = "Section 1";
      folder.children!.push(node);
      await this.syncNames(folder);
      await this.syncNames(parent);
      await this.writeProject();
      return folder.id;
    });
    this.emit();
    return this.addDoc(folderId, node.id);
  }

  async addFolder(parentId?: string, role: Role = "manuscript") {
    return this.enqueue(async () => {
      const parent = (parentId && this.node(parentId)) || rootOf(this.data, role);
      const r = roleOf(this.data, parent.id) ?? role;
      const noun = r === "manuscript" ? this.template.folderNoun : "Folder";
      const n = (parent.children ?? []).filter((c) => c.kind === "folder" && !c.matter && !c.play).length + 1;
      const title = noun === "Act" ? `Act ${["One", "Two", "Three", "Four", "Five", "Six"][n - 1] ?? n}` : `${noun} ${n}`;
      const node: BinderNode = { id: newId(), kind: "folder", title, file: `~new-${newId()}`, children: [] };
      (parent.children ??= []).push(node);
      await fsApi.mkdir(join(this.pathOf(parent.id)!, node.file));
      await this.syncNames(parent);
      await this.writeProject();
      this.emit();
      return node.id;
    });
  }

  /**
   * A whole play inside the project (a trilogy, a collection of one-acts): a
   * folder with its own title page, a front matter folder and Act One.
   */
  async addPlay() {
    return this.enqueue(async () => {
      const ms = rootOf(this.data, "manuscript");
      const n = (ms.children ?? []).filter((c) => c.play).length + 1;
      const words = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
      const play: BinderNode = { id: newId(), kind: "folder", title: `Play ${words[n - 1] ?? n}`, file: `~new-${newId()}`, play: true, children: [] };
      const front: BinderNode = { id: newId(), kind: "folder", title: "Front matter", file: `~new-${newId()}`, matter: true, children: [] };
      const scene: BinderNode = { id: newId(), kind: "doc", title: "Scene 1", file: `~new-${newId()}.md` };
      const act: BinderNode = { id: newId(), kind: "folder", title: this.template.folderNoun === "Act" ? "Act One" : `${this.template.folderNoun} 1`, file: `~new-${newId()}`, children: [scene] };
      play.children = [front, act];
      (ms.children ??= []).push(play);
      const dir = join(this.pathOf(ms.id)!, play.file);
      await fsApi.mkdir(dir);
      await fsApi.mkdir(join(dir, front.file));
      await fsApi.mkdir(join(dir, act.file));
      await fsApi.write(join(dir, act.file, scene.file), "", null);
      // Inner folders first, so each rename happens under its parent's current name.
      await this.syncNames(act);
      await this.syncNames(play);
      await this.syncNames(ms);
      await this.writeProject();
      this.setFromDisk(scene.id, "", (await fsApi.read(this.pathOf(scene.id)!)).hash);
      this.selectedId = play.id;
      this.emit();
      return play.id;
    });
  }

  /**
   * Put imported scenes (Final Draft, Fountain…) into a folder, e.g. one play
   * of a collection. A folder that only holds empty scenes is filled instead.
   */
  async importInto(folderId: string, scenes: ImportNode[], title?: string) {
    await this.flushAll();
    return this.enqueue(async () => {
      const folder = this.node(folderId);
      if (!folder || folder.kind !== "folder") return;
      const t = this.template;
      const action: ElementType = t.elements.some((e) => e.type === "action") ? "action" : "direction";
      // An untouched new play: put the scenes in its first act, replacing the empty Scene 1.
      let target = folder;
      const acts = (folder.children ?? []).filter((c) => c.kind === "folder" && !c.matter);
      const docsIn: BinderNode[] = [];
      walkNodes(folder.children ?? [], (n) => {
        if (n.kind === "doc" && !inMatterFolder(this.data, n.id)) docsIn.push(n);
      });
      const empty = docsIn.every((d) => !(this.docs.get(d.id)?.blocks ?? []).some((b) => blockText(b).trim()));
      if (empty && acts.length) {
        target = acts[0];
        for (const d of docsIn) {
          const parent = parentOf(this.data, d.id)!;
          if (!this.missing.has(d.id)) await fsApi.trash(this.pathOf(d.id)!, this.root);
          parent.children = parent.children!.filter((c) => c.id !== d.id);
          this.docs.delete(d.id);
          await this.syncNames(parent);
        }
      }
      const created: BinderNode[] = [];
      const add = async (parent: BinderNode, nodes: ImportNode[]) => {
        for (const n of nodes) {
          const node: BinderNode = { id: newId(), kind: n.kind, title: n.title || "Untitled", file: `~new-${newId()}${n.kind === "doc" ? ".md" : ""}` };
          (parent.children ??= []).push(node);
          if (n.kind === "folder") {
            node.children = [];
            await fsApi.mkdir(this.pathOf(node.id)!);
            await add(node, n.children ?? []);
            await this.syncNames(node);
          } else {
            const blocks = (n.blocks ?? []).map((b) => (b.type === "direction" || b.type === "action" || b.type === "paragraph" ? { ...b, type: action } : b));
            const content = serializeDoc({ blocks, frontMatter: null }, t.mode);
            await fsApi.write(this.pathOf(node.id)!, content, null, true);
            created.push(node);
          }
        }
      };
      await add(target, scenes);
      await this.syncNames(target);
      if (title && folder.play && /^Play \w+$/.test(folder.title)) {
        folder.title = title;
        const parent = parentOf(this.data, folder.id);
        if (parent) await this.syncNames(parent);
      }
      folder.collapsed = false;
      target.collapsed = false;
      await this.writeProject();
      for (const n of created) await this.readDoc(n.id);
      this.selectedId = created[0]?.id ?? this.selectedId;
      this.emit();
      return created.length;
    });
  }

  async rename(id: string, title: string) {
    title = title.trim();
    const node = this.node(id);
    if (!node || !title || node.title === title || node.role) return;
    await this.enqueue(async () => {
      node.title = title;
      const parent = parentOf(this.data, id);
      if (parent) await this.syncNames(parent);
      await this.writeProject();
    });
    this.emit();
  }

  /** Drag and drop: put `id` before/after `targetId`, or inside it when it is a folder. */
  async move(id: string, targetId: string, where: "before" | "after" | "inside") {
    if (id === targetId || isDescendant(this.data, id, targetId)) return;
    const node = this.node(id);
    const target = this.node(targetId);
    if (!node || !target || node.role) return;
    if (where !== "inside" && target.role) return;
    await this.flushAll();
    await this.enqueue(async () => {
      const oldParent = parentOf(this.data, id)!;
      const oldPath = this.pathOf(id)!;
      const newParent = where === "inside" ? target : parentOf(this.data, targetId)!;
      oldParent.children = oldParent.children!.filter((c) => c.id !== id);
      const kids = (newParent.children ??= []);
      let at = where === "inside" ? kids.length : kids.findIndex((k) => k.id === targetId) + (where === "after" ? 1 : 0);
      kids.splice(at, 0, node);
      if (oldParent !== newParent) {
        // Move the file into its new folder under a temporary name, then renumber both folders.
        const tmp = `~mw-${node.id}-${node.file}`;
        await fsApi.rename(oldPath, join(this.pathOf(newParent.id)!, tmp));
        node.file = tmp;
        await this.syncNames(oldParent);
      }
      await this.syncNames(newParent);
      if (where === "inside") newParent.collapsed = false;
      await this.writeProject();
    });
    this.emit();
  }

  /**
   * Drag and drop of several items at once. They keep their binder order and land
   * together: the first goes before/after/inside the target, the rest follow it.
   * An item inside a folder that is also moving travels with its folder.
   */
  async moveMany(ids: string[], targetId: string, where: "before" | "after" | "inside") {
    const picked = new Set(ids);
    const order: string[] = [];
    walkNodes(this.data.binder, (n) => {
      if (picked.has(n.id) && !n.role) order.push(n.id);
    });
    const list = order.filter(
      (id) => id !== targetId && !isDescendant(this.data, id, targetId) && !order.some((o) => o !== id && isDescendant(this.data, o, id)),
    );
    let anchor = targetId;
    let pos = where;
    for (const id of list) {
      await this.move(id, anchor, pos);
      if (where !== "inside") {
        anchor = id;
        pos = "after";
      }
    }
  }

  /** Give binder items an icon of the writer's choosing; undefined restores the default for their kind. */
  setIcon(ids: string[], icon: string | undefined) {
    for (const id of ids) {
      const n = this.node(id);
      if (!n || n.role) continue;
      if (icon) n.icon = icon;
      else delete n.icon;
    }
    this.emit();
    void this.saveProject();
  }

  /** Move a document or folder to the end of the Archive section. */
  async archive(id: string) {
    const archive = rootOf(this.data, "archive");
    if (!archive || roleOf(this.data, id) === "archive") return;
    await this.move(id, archive.id, "inside");
  }

  async remove(id: string) {
    const node = this.node(id);
    if (!node || node.role) return;
    await this.flushAll();
    await this.enqueue(async () => {
      const parent = parentOf(this.data, id)!;
      const path = this.pathOf(id)!;
      if (!this.missing.has(id)) await fsApi.trash(path, this.root);
      const ids: string[] = [id];
      walkNodes(node.children ?? [], (n) => ids.push(n.id));
      for (const nid of ids) {
        const nn = this.node(nid);
        if (nn?.notes && (await fsApi.exists(this.abs(nn.notes)))) await fsApi.trash(this.abs(nn.notes), this.root);
        this.docs.delete(nid);
        this.notes.delete(nid);
      }
      parent.children = parent.children!.filter((c) => c.id !== id);
      await this.syncNames(parent);
      await this.writeProject();
      if (this.selectedId && ids.includes(this.selectedId)) this.selectedId = null;
    });
    this.toast(`Moved “${node.title}” to the project's .trash folder.`);
    this.emit();
  }

  /** Forget a binder entry whose file is gone (does not touch the disk). */
  async forget(id: string) {
    await this.enqueue(async () => {
      const parent = parentOf(this.data, id);
      if (!parent) return;
      parent.children = parent.children!.filter((c) => c.id !== id);
      this.missing.delete(id);
      await this.writeProject();
    });
    this.emit();
  }

  toggleCollapsed(id: string) {
    const n = this.node(id);
    if (!n) return;
    n.collapsed = !n.collapsed;
    this.emit();
    void this.saveProject();
  }

  // -------------------------------------------------------------- polling

  private startPolling() {
    this.pollTimer = window.setInterval(() => {
      if (!this.closed) void this.enqueue(() => this.poll()).catch(() => {});
    }, POLL_MS);
  }

  /** Detect edits made outside the app and reload them. Never overwrites. */
  async poll() {
    const ids = [...this.docs.keys()].filter((id) => this.node(id));
    const paths = [this.abs(PROJECT_FILE), ...ids.map((id) => this.pathOf(id)!)];
    const noteIds = [...this.notes.keys()].filter((id) => this.notesPath(id));
    paths.push(...noteIds.map((id) => this.notesPath(id)!));
    const hashes = await fsApi.hashes(paths);
    let changed = false;
    if (!this.single && hashes[0] !== this.projectHash && hashes[0] !== null) {
      await this.reloadProject();
      this.toast("The binder was updated from changes on disk.");
      return;
    }
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const d = this.docs.get(id)!;
      const h = hashes[i + 1];
      if (h === d.hash) continue;
      if (h === null) {
        if (!this.missing.has(id)) {
          this.missing.add(id);
          changed = true;
        }
        continue;
      }
      const r = await fsApi.read(this.pathOf(id)!);
      const dirty = d.rev !== d.savedRev || this.saveTimers.has(id);
      const title = this.node(id)?.title ?? "A document";
      if (!dirty) {
        this.missing.delete(id);
        this.setFromDisk(id, r.content, r.hash);
        this.toast(`“${title}” was changed outside Many Write and has been reloaded.`);
      } else if (this.conflict?.docId !== id) {
        this.conflict = { docId: id, title, diskText: r.content, diskHash: r.hash };
      }
      changed = true;
    }
    for (let k = 0; k < noteIds.length; k++) {
      const id = noteIds[k];
      const n = this.notes.get(id)!;
      const h = hashes[1 + ids.length + k];
      if (h !== n.hash && !n.dirty) {
        const r = await fsApi.read(this.notesPath(id)!);
        this.notes.set(id, { text: r.content, hash: r.hash, dirty: false });
        changed = true;
      }
    }
    if (changed) {
      this.scheduleArchive();
      this.emit();
    }
  }

  docState(id: string) {
    return this.docs.get(id);
  }

  /** Re-parse every document (used after the template changes). */
  snapshot(): ProjectFile {
    return cloneData(this.data);
  }
}

export function normalizeData(d: ProjectFile): ProjectFile {
  d.app = "many-write";
  d.formatVersion = 1;
  d.title ??= "Untitled";
  d.author ??= "";
  if (typeof d.subtitle !== "string") delete d.subtitle;
  d.contact ??= "";
  d.template = (Object.hasOwn(TEMPLATES, d.template as string) ? d.template : "stage-play") as TemplateId;
  d.settings = Object.assign({ titlePage: true, paper: "us-letter" }, d.settings ?? {});
  d.binder ??= [];
  d.id ??= newId();
  // Every root exists, in the standard order (older projects gain the new sections).
  d.binder = ROOTS.map((r) => d.binder.find((n) => n.role === r.role) ?? { id: newId(), kind: "folder" as const, title: r.title, file: r.file, role: r.role, children: [] }).concat(
    d.binder.filter((n) => !n.role),
  );
  // Paths come from a file that may have been shared or hand-edited: keep every one inside the project.
  for (const n of d.binder) {
    const std = ROOTS.find((r) => r.role === n.role);
    if (!isSafeSegment(n.file)) n.file = std?.file ?? slugify(String(n.title ?? "untitled"));
  }
  walkNodes(d.binder, (n) => {
    // An id is an opaque key, but it is used to build a file name (notes), so it
    // must be a plain segment: a hostile project.json must not steer that path.
    if (!isSafeId(n.id)) n.id = newId();
    if (n.kind !== "folder" && n.kind !== "doc") n.kind = n.children ? "folder" : "doc";
    if (n.kind === "folder") n.children ??= [];
    if (!isSafeSegment(n.file)) n.file = slugify(String(n.title ?? "untitled")) + (n.kind === "doc" ? ".md" : "");
    if (n.notes !== undefined && !isSafeNotesPath(n.notes)) delete n.notes;
    if (n.icon !== undefined && !isSafeId(n.icon)) delete n.icon;
    if (n.chapter !== undefined && (n.chapter !== true || n.kind !== "folder")) delete n.chapter;
  });
  if (d.sources !== undefined) {
    const list = Array.isArray(d.sources) ? d.sources.slice(0, 2000).map(cleanSource).filter((x): x is Source => !!x) : [];
    if (list.length) d.sources = list;
    else delete d.sources;
  }
  const cs = d.settings.citationStyle;
  if (cs !== undefined && cs !== "mla" && cs !== "chicago") delete d.settings.citationStyle;
  const es = d.settings.essayStyle;
  if (es !== undefined && es !== "mla" && es !== "chicago-notes" && es !== "chicago") delete d.settings.essayStyle;
  const np = d.settings.notePlacement;
  if (np !== undefined && np !== "footnotes" && np !== "endnotes") delete d.settings.notePlacement;
  return d;
}

function stripRuntime(d: ProjectFile): ProjectFile {
  return d;
}

export type { MatterPreset };
