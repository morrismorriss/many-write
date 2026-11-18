// project.json and the binder tree. Order lives in project.json; file names
// carry matching number prefixes ("01-scene-1.md") so the folder also reads in
// order in Finder, Explorer or Obsidian. Reordering renames files but never
// rewrites their contents.

import type { EssayStyle, TemplateId } from "../formats/templates";
import type { CitationStyle, Source } from "../formats/citations";

export type Role = "front" | "manuscript" | "back" | "characters" | "research" | "archive";

/** Binder roots in display order, with their folder names on disk. */
export const ROOTS: { role: Role; title: string; file: string }[] = [
  { role: "front", title: "Front matter", file: "front-matter" },
  { role: "manuscript", title: "Manuscript", file: "manuscript" },
  { role: "back", title: "Back matter", file: "back-matter" },
  { role: "characters", title: "Characters", file: "characters" },
  { role: "research", title: "Research", file: "research" },
  { role: "archive", title: "Archive", file: "archive" },
];

/** Roles whose documents are typeset (and whose files carry number prefixes). */
export const TYPESET_ROLES: Role[] = ["front", "manuscript", "back"];

export interface BinderNode {
  id: string;
  kind: "folder" | "doc";
  title: string;
  /** File or folder name (one path segment). */
  file: string;
  /** Path of the linked notes file, relative to the project root. */
  notes?: string;
  role?: Role;
  collapsed?: boolean;
  /** Script formats: a folder holding a whole play of a collection (trilogy…), with its own title page. */
  play?: boolean;
  /** A folder of front matter pages inside a play (cast list, time and place…). */
  matter?: boolean;
  /** Books: a chapter split into sections. Its title prints as the chapter heading and its sections run on. */
  chapter?: boolean;
  /** An icon the writer picked for this item (a key of BINDER_ICONS); absent means the default for its kind. */
  icon?: string;
  children?: BinderNode[];
}

export interface ProjectSettings {
  titlePage: boolean;
  paper: "us-letter" | "a4";
  /** Essays: citation style, and the details MLA's heading and Chicago's title page show. */
  essayStyle?: EssayStyle;
  instructor?: string;
  course?: string;
  /** As it should be printed; empty means today's date. */
  date?: string;
  /** Books: how a scene break is drawn. "image" uses sceneBreakImage (a project-relative path). */
  sceneBreak?: SceneBreakStyle;
  sceneBreakImage?: string;
  /** Scripts: each scene starts on a new page. Default on for stage plays, off for screenplays (see sceneNewPageDefault). */
  sceneNewPage?: boolean;
  /** Scripts: add (CONT'D) to a cue when the same character speaks again after a direction. */
  autoContd?: boolean;
  /** Books, articles and documents: the style "/cite" uses (essays follow essayStyle). */
  citationStyle?: CitationStyle;
}

/** Stage plays start each scene on a new page unless told otherwise; screenplays run scenes on. */
export function sceneNewPageDefault(template: string, setting: boolean | undefined): boolean {
  return setting ?? template !== "screenplay";
}

/** The chapter folder a book section sits in, if any. */
export function chapterOf(data: ProjectFile, id: string): BinderNode | null {
  let found: BinderNode | null = null;
  const rec = (nodes: BinderNode[], chapter: BinderNode | null): boolean => {
    for (const n of nodes) {
      if (n.id === id) {
        found = chapter;
        return true;
      }
      if (n.children && rec(n.children, chapter ?? (n.kind === "folder" && n.chapter ? n : null))) return true;
    }
    return false;
  };
  rec(data.binder, null);
  return found;
}

export type SceneBreakStyle = "asterisks" | "line" | "hearts" | "image";

export interface ProjectFile {
  app: "many-write";
  formatVersion: 1;
  id: string;
  title: string;
  /** Printed under the title on the title page. */
  subtitle?: string;
  author: string;
  contact: string;
  template: TemplateId;
  theme?: string;
  settings: ProjectSettings;
  binder: BinderNode[];
  /** Sources cited with "/cite", remembered so they can be cited again with one click. */
  sources?: Source[];
}

export const PROJECT_FILE = "project.json";

export function newId(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function uuid(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${newId()}-${newId()}`;
}

export function slugify(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return s || "untitled";
}

/** "02-the-kitchen.md" -> "The kitchen" */
export function titleFromFile(name: string): string {
  const base = name.replace(/\.md$/i, "").replace(/^\d+[-_. ]+/, "").replace(/[-_]+/g, " ").trim();
  if (!base) return "Untitled";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function rootOf(data: ProjectFile, role: Role): BinderNode {
  return data.binder.find((n) => n.role === role)!;
}

export function walkNodes(nodes: BinderNode[], fn: (n: BinderNode, parent: BinderNode | null, depth: number) => void, parent: BinderNode | null = null, depth = 0) {
  for (const n of nodes) {
    fn(n, parent, depth);
    if (n.children) walkNodes(n.children, fn, n, depth + 1);
  }
}

export function findNode(data: ProjectFile, id: string): BinderNode | null {
  let found: BinderNode | null = null;
  walkNodes(data.binder, (n) => {
    if (n.id === id) found = n;
  });
  return found;
}

export function parentOf(data: ProjectFile, id: string): BinderNode | null {
  let found: BinderNode | null = null;
  walkNodes(data.binder, (n, p) => {
    if (n.id === id) found = p;
  });
  return found;
}

/** Path of a node relative to the project root, e.g. "manuscript/01-act-one/02-scene-2.md". */
export function nodePath(data: ProjectFile, id: string): string | null {
  const chain: string[] = [];
  const rec = (nodes: BinderNode[]): boolean => {
    for (const n of nodes) {
      chain.push(n.file);
      if (n.id === id) return true;
      if (n.children && rec(n.children)) return true;
      chain.pop();
    }
    return false;
  };
  return rec(data.binder) ? chain.join("/") : null;
}

export function roleOf(data: ProjectFile, id: string): Role | null {
  for (const r of data.binder) {
    if (r.id === id) return r.role ?? null;
    let hit = false;
    walkNodes(r.children ?? [], (n) => {
      if (n.id === id) hit = true;
    });
    if (hit) return r.role ?? null;
  }
  return null;
}

/** Documents and folders under one root, in reading order. */
export function manuscriptOrder(data: ProjectFile, role: Role = "manuscript"): { node: BinderNode; depth: number }[] {
  const out: { node: BinderNode; depth: number }[] = [];
  walkNodes(rootOf(data, role)?.children ?? [], (n, _p, depth) => out.push({ node: n, depth: depth + 1 }));
  return out;
}

/** Is this node a matter folder inside a play, or inside one? */
export function inMatterFolder(data: ProjectFile, id: string): boolean {
  let hit = false;
  const rec = (nodes: BinderNode[], inside: boolean): boolean => {
    for (const n of nodes) {
      const here = inside || (n.kind === "folder" && !!n.matter);
      if (n.id === id) {
        hit = here;
        return true;
      }
      if (n.children && rec(n.children, here)) return true;
    }
    return false;
  };
  rec(data.binder, false);
  return hit;
}

/** The play folder a node belongs to, if any. */
export function playOf(data: ProjectFile, id: string): BinderNode | null {
  let found: BinderNode | null = null;
  const rec = (nodes: BinderNode[], play: BinderNode | null): boolean => {
    for (const n of nodes) {
      const p = n.play ? n : play;
      if (n.id === id) {
        found = p;
        return true;
      }
      if (n.children && rec(n.children, p)) return true;
    }
    return false;
  };
  rec(data.binder, null);
  return found;
}

export function isDescendant(data: ProjectFile, ancestorId: string, id: string): boolean {
  const a = findNode(data, ancestorId);
  if (!a) return false;
  let hit = false;
  walkNodes(a.children ?? [], (n) => {
    if (n.id === id) hit = true;
  });
  return hit;
}

/** The file name a child should have at position `index` in its folder. */
/**
 * True when `name` is one plain file or folder name. project.json is read from
 * disk and may come from someone else, so a binder entry must never be able to
 * point outside its folder ("../", "/etc/…", "C:…").
 */
export function isSafeSegment(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name.length <= 255 && name !== "." && name !== ".." && !/[/\\:\0]/.test(name);
}

/** A notes file lives directly in the project's notes folder. */
export function isSafeNotesPath(p: unknown): p is string {
  return typeof p === "string" && p.startsWith("notes/") && isSafeSegment(p.slice(6)) && p.toLowerCase().endsWith(".md");
}

/**
 * True when `id` is a plain id (as `newId()` makes). project.json is read from
 * disk and may come from someone else; an id is never a path on its own, but it
 * is used to build one (the notes file name), so it must not carry separators.
 */
export function isSafeId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 128 && isSafeSegment(id);
}

export function desiredName(node: BinderNode, index: number, numbered: boolean, taken: Set<string>): string {
  const ext = node.kind === "doc" ? ".md" : "";
  const prefix = numbered ? `${String(index + 1).padStart(2, "0")}-` : "";
  let base = `${prefix}${slugify(node.title)}`;
  let name = base + ext;
  let k = 2;
  while (taken.has(name.toLowerCase())) name = `${base}-${k++}${ext}`;
  taken.add(name.toLowerCase());
  return name;
}

export function cloneData(d: ProjectFile): ProjectFile {
  return JSON.parse(JSON.stringify(d));
}

export function serializeProject(d: ProjectFile): string {
  return JSON.stringify(d, null, 2) + "\n";
}

export function emptyProject(title: string, template: TemplateId, author: string, titlePage: boolean): ProjectFile {
  return {
    app: "many-write",
    formatVersion: 1,
    id: uuid(),
    title,
    author,
    contact: "",
    template,
    settings: { titlePage, paper: "us-letter" },
    binder: ROOTS.map((r) => ({ id: newId(), kind: "folder" as const, title: r.title, file: r.file, role: r.role, children: [] })),
  };
}

/** Recognise copies made by Dropbox, iCloud, OneDrive, Google Drive and Syncthing. */
export function conflictBase(name: string): string | null {
  const m =
    name.match(/^(.*?) \((?:[^)]*conflicted copy[^)]*|[^)]*conflict[^)]*)\)(\.md)?$/i) ??
    name.match(/^(.*?)\.sync-conflict-[^.]*(\.md)?$/i) ??
    name.match(/^(.*?)-[^-]*-conflict(?:-\d+)?(\.md)?$/i) ??
    name.match(/^(.*?) [2-9](\.md)$/) ??
    name.match(/^(.*?) \(\d+\)(\.md)$/);
  return m ? m[1] + (m[2] ?? "") : null;
}
