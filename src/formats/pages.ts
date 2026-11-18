// Page ranges for exporting part of a PDF, typed the way print dialogs take
// them: "3", "1-4", "2, 5-7, 10-" (an open end runs to the last page).

/** A run of pages, counted from 1 as in the preview; `to: null` runs to the last page. */
export interface PageRange {
  from: number;
  to: number | null;
}

export type ParsedPages = { ok: true; ranges: PageRange[] } | { ok: false; error: string };

export function parsePageRanges(text: string, pageCount?: number): ParsedPages {
  const parts = text
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return { ok: false, error: "Type the pages to export, like 1-3, 5." };
  const ranges: PageRange[] = [];
  for (const part of parts) {
    const m = part.match(/^(\d+)?\s*(?:([-–—]|to)\s*(\d+)?)?$/i);
    if (!m || (!m[1] && !m[3])) return { ok: false, error: `“${part}” isn't a page or a range of pages.` };
    const dash = !!m[2];
    const from = m[1] ? parseInt(m[1], 10) : 1;
    const to = m[3] ? parseInt(m[3], 10) : dash ? null : from;
    if (from < 1 || (to !== null && to < 1)) return { ok: false, error: "Pages are counted from 1." };
    if (to !== null && to < from) return { ok: false, error: `“${part}” runs backwards. Put the first page first.` };
    if (pageCount !== undefined && from > pageCount) {
      return { ok: false, error: `This document has ${pageCount} page${pageCount === 1 ? "" : "s"}, so there is no page ${from}.` };
    }
    ranges.push({ from, to: to !== null && pageCount !== undefined ? Math.min(to, pageCount) : to });
  }
  return { ok: true, ranges };
}

/** How many pages the ranges pick out of a document of `pageCount` pages (overlaps counted once). */
export function countPages(ranges: PageRange[], pageCount: number): number {
  const picked = new Set<number>();
  for (const r of ranges) for (let p = r.from; p <= Math.min(r.to ?? pageCount, pageCount); p++) picked.add(p);
  return picked.size;
}

/** "1–3, 5" — the ranges as a person would write them. */
export function describeRanges(ranges: PageRange[]): string {
  return ranges.map((r) => (r.to === r.from ? `${r.from}` : r.to === null ? `${r.from}–end` : `${r.from}–${r.to}`)).join(", ");
}
