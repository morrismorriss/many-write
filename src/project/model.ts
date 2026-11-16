// project.json and the binder tree. Order lives in project.json; file names
// carry matching number prefixes ("01-scene-1.md") so the folder also reads in
// order in Finder, Explorer or Obsidian. Reordering renames files but never
// rewrites their contents.

import type { EssayStyle, TemplateId } from "../formats/templates";

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
}

export type SceneBreakStyle = "asterisks" | "line" | "hearts" | "image";

export interface ProjectFile {
  app: "many-write";
  formatVersion: 1;
  id: string;
  title: string;
  author: string;
  contact: string;
  template: TemplateId;
  theme?: string;
  settings: ProjectSettings;
  binder: BinderNode[];
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
