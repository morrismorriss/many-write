// The open project: binder, document contents, autosave and outside-edit
// detection. All file operations run through one queue so a save can never
// interleave with a rename or a reload.

import { BackendError, call, configApi, fsApi, join } from "../lib/backend";
import { blockText, parseDoc, serializeDoc, adaptScriptTypes, type Block } from "../formats/markdown";
import { getTemplate, MATTER_TEMPLATE, NOTES_TEMPLATE, TEMPLATES, type MatterPreset, type Template, type TemplateId } from "../formats/templates";
import type { ManuscriptItem, ProjectMeta } from "../formats/typst";
import {
  cloneData,
  conflictBase,
  desiredName,
  emptyProject,
  findNode,
  isDescendant,
  manuscriptOrder,
  newId,
  nodePath,
  parentOf,
  PROJECT_FILE,
  ROOTS,
  TYPESET_ROLES,
  roleOf,
  rootOf,
  serializeProject,
  slugify,
  titleFromFile,
  walkNodes,
  type BinderNode,
  type ProjectFile,
  type Role,
} from "./model";
import { projectReadme } from "./readme";
import { computeAnchors, contextKey, PRODUCTION_FILE, resolveAnchors, revisedLines, snapshotOf, type ProductionState } from "./production";
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
export async function createProject(location: string, title: string, templateId: TemplateId, author: string): Promise<string> {
  const template = TEMPLATES[templateId];
  const root = join(location, title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Untitled");
  if (await fsApi.exists(join(root, PROJECT_FILE))) throw new Error(`There is already a project in ${root}.`);
  const data = emptyProject(title, templateId, author, template.titlePageDefault);
  const ms = rootOf(data, "manuscript");
  const docs: { rel: string; content: string }[] = [];
  if (templateId === "stage-play") {
    const act: BinderNode = { id: newId(), kind: "folder", title: "Act One", file: "01-act-one", children: [] };
    act.children!.push({ id: newId(), kind: "doc", title: "Scene 1", file: "01-scene-1.md" });
    ms.children!.push(act);
    docs.push({ rel: "manuscript/01-act-one/01-scene-1.md", content: template.starter(1) });
  } else {
    const noun = template.docNoun;
    ms.children!.push({ id: newId(), kind: "doc", title: `${noun} 1`, file: `01-${slugify(noun)}-1.md` });
    docs.push({ rel: `manuscript/01-${slugify(noun)}-1.md`, content: template.starter(1) });
  }
  for (const dir of [...ROOTS.map((r) => r.file), "notes"]) await fsApi.mkdir(join(root, dir));
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

  /** Lock markers and revision marks for the Typst generator. */
  productionOptions(): GenOptions["production"] | undefined {
    const p = this.production;
    if (!p?.active || this.template.mode !== "script") return undefined;
    const resolved = resolveAnchors(p.anchors, (id) => this.docs.get(id)?.blocks);
    const locks = new Map([...resolved].map(([id, a]) => [id, { page: a.page, hard: !a.split }]));
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
    const anchors = computeAnchors(ids, first, last, this.keyAt, firstScriptPage, pageCount);
    this.production = {
      formatVersion: 1,
      active: true,
      revision,
      revisionDate: new Date().toLocaleDateString(),
      lockedAt: new Date().toISOString(),
      pageCount: pageCount - firstScriptPage + 1,
      anchors,
      snapshot: snapshotOf(this.typesetDocs().map((n) => ({ id: n.id, blocks: this.docs.get(n.id)?.blocks ?? [] }))),
    };
    await this.writeProduction();
    this.toast(`Locked ${this.production.pageCount} pages. Changes now go on A-pages and are marked with *.`);
    this.emit();
  }

  /** Start the next revision colour: today's changes become the new baseline. Page locks stay. */
  async nextRevision(revision: string) {
    if (!this.production) return;
    await this.flushAll();
    this.production = {
      ...this.production,
      active: true,
      revision,
      revisionDate: new Date().toLocaleDateString(),
      snapshot: snapshotOf(this.typesetDocs().map((n) => ({ id: n.id, blocks: this.docs.get(n.id)?.blocks ?? [] }))),
    };
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
      author: this.data.author,
      contact: this.data.contact,
      titlePage: this.data.settings.titlePage,
      paper: this.data.settings.paper,
    };
  }

  /** Everything that is typeset, in order: front matter, the manuscript, back matter. */
  manuscriptItems(): ManuscriptItem[] {
    const items: ManuscriptItem[] = [];
    const usable = (id: string) => !this.conflictCopies.has(id) && !this.missing.has(id);
    for (const where of ["front", "back"] as const) {
      if (where === "back") {
        for (const { node, depth } of manuscriptOrder(this.data)) {
          if (node.kind === "folder") items.push({ kind: "folder", id: node.id, title: node.title, depth });
          else if (usable(node.id)) items.push({ kind: "doc", id: node.id, title: node.title, blocks: this.docs.get(node.id)?.blocks ?? [] });
        }
      }
      for (const { node } of manuscriptOrder(this.data, where)) {
        if (node.kind === "doc" && usable(node.id)) items.push({ kind: "matter", id: node.id, title: node.title, blocks: this.docs.get(node.id)?.blocks ?? [], where });
      }
    }
    return items;
  }

  /** Typeset documents (front matter, manuscript, back matter) in reading order. */
  typesetDocs(): BinderNode[] {
    return (["front", "manuscript", "back"] as const).flatMap((r) => manuscriptOrder(this.data, r).map((x) => x.node).filter((n) => n.kind === "doc"));
  }

  /** Character names used anywhere in the manuscript, most frequent first. */
  characterNames(): string[] {
    const counts = new Map<string, number>();
    for (const d of this.docs.values())
      for (const b of d.blocks)
        if (b.type === "character") {
          const name = blockText(b).trim().toUpperCase().replace(/\s*\(.*\)$/, "");
          if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
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
    const doc = parseDoc(text, t.mode, t.elements.some((e) => e.type === "title"));
    if (t.mode === "script") return adaptScriptTypes(doc, t.elements.some((e) => e.type === "action") ? "action" : "direction").blocks;
    return doc.blocks;
  }

  private frontMatter = new Map<string, string | null>();

  private serialize(id: string, blocks: Block[]): string {
    const t = this.templateFor(id);
    return serializeDoc({ blocks, frontMatter: this.frontMatter.get(id) ?? null }, t.mode);
  }

  private setFromDisk(id: string, text: string, hash: string | null) {
    const t = this.templateFor(id);
    const parsed = parseDoc(text, t.mode, t.elements.some((e) => e.type === "title"));
    this.frontMatter.set(id, parsed.frontMatter);
    const prev = this.docs.get(id);
    const rev = (prev?.rev ?? 0) + 1;
    this.docs.set(id, {
      text,
      hash,
      blocks: this.parse(id, text),
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
      const text = this.serialize(id, d.blocks);
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
        await this.stash(path, this.serialize(c.docId, d.blocks), "unsaved");
        this.setFromDisk(c.docId, c.diskText, c.diskHash);
      } else {
        await this.stash(path, c.diskText, "outside-edit");
        const text = this.serialize(c.docId, d.blocks);
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
      n.notes = `notes/${slugify(n.title)}-${n.id.slice(0, 6)}.md`;
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

  async updateMeta(patch: Partial<Pick<ProjectFile, "title" | "author" | "contact" | "theme">> & { settings?: Partial<ProjectFile["settings"]> }) {
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
    // Two phases so swapping 01-a and 02-b never collides.
    for (const p of moving) {
      const tmp = `~mw-${p.c.id}-${p.c.file}`;
      await fsApi.rename(join(dir, p.c.file), join(dir, tmp)).catch(() => {});
      p.c.file = tmp;
    }
    for (const p of moving) {
      await fsApi.rename(join(dir, p.c.file), join(dir, p.want)).catch(() => {});
      p.c.file = p.want;
    }
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
    if (sel.kind === "folder") return { parentId: sel.id };
    return { parentId: parentOf(this.data, sel.id)!.id, afterId: sel.id };
  }

  async addDoc(parentId?: string, afterId?: string, role: Role = "manuscript", preset?: { title: string; content: string }) {
    return this.enqueue(async () => {
      const parent = (parentId && this.node(parentId)) || rootOf(this.data, role);
      const r = roleOf(this.data, parent.id) ?? role;
      const tmpl = r === "manuscript" || r === "archive" ? this.template : r === "front" || r === "back" ? MATTER_TEMPLATE : NOTES_TEMPLATE;
      let count = 0;
      walkNodes(rootOf(this.data, r).children ?? [], (n) => {
        if (n.kind === "doc") count++;
      });
      const noun = r === "manuscript" || r === "archive" ? tmpl.docNoun : r === "characters" ? "Character" : r === "research" ? "Note" : "Page";
      const node: BinderNode = { id: newId(), kind: "doc", title: preset?.title ?? `${noun} ${count + 1}`, file: `~new-${newId()}.md` };
      const kids = (parent.children ??= []);
      const at = afterId ? kids.findIndex((k) => k.id === afterId) + 1 : kids.length;
      kids.splice(at > 0 ? at : kids.length, 0, node);
      const content =
        preset?.content ??
        (r === "manuscript" || r === "archive" ? tmpl.starter(count + 1) : r === "characters" ? CHARACTER_STARTER : r === "research" ? `# ${node.title}\n` : "");
      await fsApi.write(join(this.pathOf(parent.id)!, node.file), content, null);
      await this.syncNames(parent);
      await this.writeProject();
      this.setFromDisk(node.id, content, (await fsApi.read(this.pathOf(node.id)!)).hash);
      this.selectedId = node.id;
      this.emit();
      return node.id;
    });
  }

  async addFolder(parentId?: string, role: Role = "manuscript") {
    return this.enqueue(async () => {
      const parent = (parentId && this.node(parentId)) || rootOf(this.data, role);
      const r = roleOf(this.data, parent.id) ?? role;
      const noun = r === "manuscript" ? this.template.folderNoun : "Folder";
      const n = (parent.children ?? []).filter((c) => c.kind === "folder").length + 1;
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
    if (hashes[0] !== this.projectHash && hashes[0] !== null) {
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
    if (changed) this.emit();
  }

  docState(id: string) {
    return this.docs.get(id);
  }

  /** Re-parse every document (used after the template changes). */
  snapshot(): ProjectFile {
    return cloneData(this.data);
  }
}

function normalizeData(d: ProjectFile): ProjectFile {
  d.app = "many-write";
  d.formatVersion = 1;
  d.title ??= "Untitled";
  d.author ??= "";
  d.contact ??= "";
  d.template = (TEMPLATES[d.template] ? d.template : "stage-play") as TemplateId;
  d.settings = Object.assign({ titlePage: true, paper: "us-letter" }, d.settings ?? {});
  d.binder ??= [];
  d.id ??= newId();
  // Every root exists, in the standard order (older projects gain the new sections).
  d.binder = ROOTS.map((r) => d.binder.find((n) => n.role === r.role) ?? { id: newId(), kind: "folder" as const, title: r.title, file: r.file, role: r.role, children: [] }).concat(
    d.binder.filter((n) => !n.role),
  );
  walkNodes(d.binder, (n) => {
    n.id ??= newId();
    if (n.kind === "folder") n.children ??= [];
  });
  return d;
}

function stripRuntime(d: ProjectFile): ProjectFile {
  return d;
}

/** A new character page: Notion-style headings to fill in. */
export const CHARACTER_STARTER = `# Name

> [!note] One line: who they are and what they want.

## Want

## Need

## Voice


## Backstory
`;

export type { MatterPreset };
