// Find & replace over documents, keeping bold/italic/underline intact.

import type { Block, Run } from "./markdown";
import { blockText } from "./markdown";

export interface SearchOptions {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
}

export interface Match {
  docId: string;
  /** Line index in the document. */
  index: number;
  from: number;
  to: number;
  /** The line's text around the match, for the results list. */
  before: string;
  text: string;
  after: string;
}

export function searchRegex(o: SearchOptions): RegExp | null {
  if (!o.query) return null;
  const esc = o.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const src = o.wholeWord ? `(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])` : esc;
  return new RegExp(src, o.matchCase ? "gu" : "giu");
}

export function findInBlocks(docId: string, blocks: Block[], re: RegExp): Match[] {
  const out: Match[] = [];
  blocks.forEach((b, index) => {
    if (b.type === "image") return;
    const text = blockText(b);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) && m[0].length) {
      out.push({
        docId,
        index,
        from: m.index,
        to: m.index + m[0].length,
        before: text.slice(Math.max(0, m.index - 30), m.index),
        text: m[0],
        after: text.slice(m.index + m[0].length, m.index + m[0].length + 30),
      });
    }
  });
  return out;
}

/** Replace text[from, to) in a run list; the replacement takes the marks of the first replaced character. */
export function replaceRange(runs: Run[], from: number, to: number, replacement: string): Run[] {
  const out: Run[] = [];
  let pos = 0;
  let inserted = false;
  for (const r of runs) {
    const start = pos;
    const end = pos + r.text.length;
    pos = end;
    if (end <= from || start >= to) {
      if (start >= to && !inserted) {
        out.push({ ...r, text: replacement });
        inserted = true;
      }
      out.push(r);
      continue;
    }
    const keepBefore = r.text.slice(0, Math.max(0, from - start));
    const keepAfter = r.text.slice(Math.max(0, to - start));
    if (keepBefore) out.push({ ...r, text: keepBefore });
    if (!inserted) {
      out.push({ ...r, text: replacement });
      inserted = true;
    }
    if (keepAfter) out.push({ ...r, text: keepAfter });
  }
  if (!inserted) out.push({ text: replacement });
  // Merge neighbours with the same formatting.
  const merged: Run[] = [];
  for (const r of out) {
    if (!r.text) continue;
    const last = merged[merged.length - 1];
    if (last && !!last.bold === !!r.bold && !!last.italic === !!r.italic && !!last.underline === !!r.underline) last.text += r.text;
    else merged.push({ ...r });
  }
  return merged;
}

/** Replace every match (or only `only`) in a document. Returns the new blocks and how many changed. */
export function replaceInBlocks(blocks: Block[], re: RegExp, replacement: string, only?: { index: number; from: number }): { blocks: Block[]; count: number } {
  let count = 0;
  const next = blocks.map((b, index) => {
    if (b.type === "image") return b;
    if (only && only.index !== index) return b;
    const text = blockText(b);
    const ranges: [number, number][] = [];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) && m[0].length) {
      if (!only || m.index === only.from) ranges.push([m.index, m.index + m[0].length]);
    }
    if (!ranges.length) return b;
    let runs = b.runs;
    // Back to front so earlier offsets stay valid.
    for (const [from, to] of ranges.reverse()) runs = replaceRange(runs, from, to, replacement);
    count += ranges.length;
    return { ...b, runs };
  });
  return { blocks: next, count };
}
