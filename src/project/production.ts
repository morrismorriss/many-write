// Production mode ("locked pages"). Once a script is locked, every page keeps
// its number. A rewrite that grows a page spills onto A-pages (12A, 12B…); one
// that shrinks leaves white space. Changed lines are marked with an asterisk
// in the right margin, and the header names the current revision colour.

import { blockText, type Block } from "../formats/markdown";

/** The traditional order of revision colours. */
export const REVISION_COLORS = ["White", "Blue", "Pink", "Yellow", "Green", "Goldenrod", "Buff", "Salmon", "Cherry"];

export interface PageAnchor {
  /** The locked page number. */
  page: number;
  docId: string;
  /** Index of the first line on that page when it was locked. */
  index: number;
  /** That line's type and text, to find it again after lines are added above it. */
  key: string;
  /** The page began part-way through this line (a speech split across pages). */
  split: boolean;
}

export interface ProductionState {
  formatVersion: 1;
  active: boolean;
  revision: string;
  revisionDate: string;
  lockedAt: string;
  pageCount: number;
  anchors: PageAnchor[];
  /** Per document, the lines as they were at the start of this revision. */
  snapshot: Record<string, string[]>;
  /**
   * Per document, its markdown at the start of this revision: the "old version"
   * of a page that gets archived when the page is first edited.
   */
  baseline?: Record<string, string>;
  /** Letters given to pages in earlier revisions (3 -> 1 means "3A"). */
  pageLetters?: Record<number, number>;
  /** Letters chosen by the writer for pages revised in this revision (0 = no letter). */
  currentLetters?: Record<number, number>;
  /** Archived old versions: "<revision>:<page>" -> archive document id. */
  archived?: Record<string, string>;
}

/** One item in reading order: an act/matter heading or a line of a document. */
export interface Entry {
  /** Element id: `docId#index` (index -1 for a heading). */
  id: string;
  docId: string;
  key: string;
  block?: Block;
}

/** Every non-empty line (and heading) of the typeset script in order. */
export function flatten(items: { kind: string; id: string; title: string; blocks?: Block[] }[]): Entry[] {
  const out: Entry[] = [];
  for (const it of items) {
    if (it.kind === "folder") out.push({ id: `${it.id}#-1`, docId: it.id, key: `heading|${it.title}` });
    else if (it.kind === "matter") out.push({ id: `${it.id}#-1`, docId: it.id, key: `heading|${it.title}` });
    (it.blocks ?? []).forEach((b, i) => {
      if (blockText(b).trim()) out.push({ id: `${it.id}#${i}`, docId: it.id, key: lineKey(b), block: b });
    });
  }
  return out;
}

/** The lines on each locked page: from that page's lock up to the next one. */
export function pageRegions(entries: Entry[], locks: Map<string, PageAnchor>): Map<number, Entry[]> {
  const out = new Map<number, Entry[]>();
  let page: number | null = null;
  for (const e of entries) {
    const lock = locks.get(e.id);
    if (lock) page = lock.page;
    if (page === null) continue;
    if (!out.has(page)) out.set(page, []);
    out.get(page)!.push(e);
  }
  return out;
}

/** Pages whose lines differ from the start of the revision (edited, added to or cut). */
export function editedPages(before: Map<number, Entry[]>, after: Map<number, Entry[]>): number[] {
  const pages = new Set([...before.keys(), ...after.keys()]);
  const same = (a: Entry[] = [], b: Entry[] = []) => a.length === b.length && a.every((e, i) => e.key === b[i].key);
  return [...pages].filter((p) => !same(before.get(p), after.get(p))).sort((a, b) => a - b);
}

/** The letter a page carries now: its edited letter this revision, or the one it kept from before. */
export function letterFor(p: ProductionState, page: number, edited: boolean): number {
  const kept = p.pageLetters?.[page] ?? 0;
  if (!edited) return kept;
  return p.currentLetters?.[page] ?? kept + 1;
}

export function letterName(n: number): string {
  return n > 0 ? pageLabel(0, n).replace(/^0/, "") : "";
}

export const PRODUCTION_FILE = "production.json";

export function lineKey(b: Block): string {
  return `${b.type}|${blockText(b).trim()}`;
}

/** Short stable hash, so production.json stays small and does not repeat the script. */
export function hashKey(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * What identifies a locked line: its own text plus the next two lines, so a
 * repeated line ("ANNA", "(beat)") is told apart by the speech that follows it.
 */
export function contextKey(blocks: Block[], i: number): string {
  const parts: string[] = [];
  for (let j = i; j < blocks.length && parts.length < 3; j++) if (j === i || blockText(blocks[j]).trim()) parts.push(lineKey(blocks[j]));
  return parts.join("\n");
}

export function snapshotOf(docs: { id: string; blocks: Block[] }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const d of docs) out[d.id] = d.blocks.filter((b) => blockText(b).trim()).map((b) => hashKey(lineKey(b)));
  return out;
}

/**
 * Work out each page's first line from a typeset report.
 * `ids` are element ids (`docId#index`) in order; `first`/`last` their pages.
 * `firstScriptPage` is the physical page that is script page 1 (2 with a title page).
 */
export function computeAnchors(
  ids: string[],
  first: number[],
  last: number[],
  keyAt: (docId: string, index: number) => string | undefined,
  firstScriptPage: number,
  pageCount: number,
): PageAnchor[] {
  const anchors: PageAnchor[] = [];
  for (let phys = firstScriptPage; phys <= pageCount; phys++) {
    const page = phys - firstScriptPage + 1;
    let k = ids.findIndex((_, i) => first[i] === phys);
    let split = false;
    // Did the page begin inside a line that started on an earlier page?
    const carried = ids.findIndex((_, i) => first[i] > 0 && first[i] < phys && last[i] >= phys);
    if (carried >= 0) {
      k = carried;
      split = true;
    }
    if (k < 0) continue;
    // Headings (an act, a front-matter title) always stick to the line after them, so a
    // page that starts with one is locked to the heading, not to the line below it.
    while (!split && k > 0 && ids[k - 1].endsWith("#-1") && !(first[k - 1] > 0 && first[k - 1] < phys)) k--;
    const [docId, idx] = ids[k].split("#");
    const key = keyAt(docId, Number(idx));
    if (key === undefined) continue;
    anchors.push({ page, docId, index: Number(idx), key: hashKey(key), split });
  }
  return anchors;
}

/**
 * Find where each anchor's line is now. Lines are matched by content, nearest
 * to the old position, so adding or cutting lines above a page break keeps the
 * break with the line it was locked to. A deleted line passes its lock on to
 * the line that took its place.
 */
export function resolveAnchors(anchors: PageAnchor[], blocksOf: (docId: string) => Block[] | undefined): Map<string, PageAnchor> {
  const out = new Map<string, PageAnchor>();
  for (const a of anchors) {
    // Headings (index -1: an act, a front-matter title) never move within their document.
    if (a.index < 0) {
      const id = `${a.docId}#${a.index}`;
      if (!out.has(id)) out.set(id, a);
      continue;
    }
    const blocks = blocksOf(a.docId);
    if (!blocks || !blocks.length) continue;
    let best = -1;
    let bestDist = Infinity;
    blocks.forEach((_b, i) => {
      if (hashKey(contextKey(blocks, i)) !== a.key) return;
      const d = Math.abs(i - a.index);
      if (d < bestDist) {
        best = i;
        bestDist = d;
      }
    });
    if (best < 0) {
      best = Math.min(a.index, blocks.length - 1);
      while (best < blocks.length - 1 && !blockText(blocks[best]).trim()) best++;
    }
    const id = `${a.docId}#${best}`;
    // Two locks can never share a line; keep the earlier page.
    if (!out.has(id)) out.set(id, a);
  }
  return out;
}

/** Lines changed or added since the revision began. */
export function revisedLines(snapshot: string[] | undefined, blocks: Block[]): Set<number> {
  const out = new Set<number>();
  if (!snapshot) {
    blocks.forEach((b, i) => blockText(b).trim() && out.add(i));
    return out;
  }
  const pool = new Map<string, number>();
  for (const h of snapshot) pool.set(h, (pool.get(h) ?? 0) + 1);
  blocks.forEach((b, i) => {
    if (!blockText(b).trim()) return;
    const h = hashKey(lineKey(b));
    const n = pool.get(h) ?? 0;
    if (n > 0) pool.set(h, n - 1);
    else out.add(i);
  });
  return out;
}

/** "12" -> "12", extra pages -> "12A", "12B"… (studio convention). */
export function pageLabel(page: number, extra: number): string {
  if (extra <= 0) return String(page);
  let s = "";
  let n = extra;
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return `${page}${s}`;
}
