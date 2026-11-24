// Simultaneous dialogue: two to six characters speaking at once, side by side.
//
// A row is a run of lines that share a column number (`sim`, 0 = leftmost).
// The cue that opens a column carries the number; its parentheticals, dialogue
// and lyrics carry the same number. Files write the extra columns with a
// trailing "^" on the cue, the way Fountain marks dual dialogue:
//
//   ANNA
//   I told you.
//
//   BEN ^
//   And I warned you.
//
//   CY ^
//   You never listen.
//
// Anything that is not a cue or a speaker's line (a direction, a heading, a
// transition) ends the row.

/** How many characters can speak at once. */
export const MAX_TOGETHER = 6;

/** The editor lays every line on this many grid columns, so 2–6 speakers split evenly. */
export const GRID_COLUMNS = 60;

export interface SimLine {
  type: string;
  sim?: number;
}

export const simOf = (line: SimLine) => Math.max(-1, line.sim ?? -1);

/** A cue's own lines: parentheticals, dialogue and lyrics. */
export function isSpeechType(type: string): boolean {
  return type === "parenthetical" || type === "dialogue" || type === "lyric";
}

export interface Group {
  start: number;
  end: number;
}

/** The speaker group around line `i`: its cue and the lines printed under it. */
export function speakerGroupAt(lines: SimLine[], i: number): Group | null {
  if (i < 0 || i >= lines.length) return null;
  let start = i;
  if (isSpeechType(lines[i].type)) {
    while (start > 0 && isSpeechType(lines[start].type)) start--;
  }
  if (lines[start]?.type !== "character") return null;
  let end = start + 1;
  while (end < lines.length && isSpeechType(lines[end].type)) end++;
  return { start, end };
}

export interface Row extends Group {
  /** Number of speakers in the row. */
  columns: number;
}

/**
 * The line that opens a row: a cue in the leftmost column. Two rows can sit one under the
 * other, so a row ends where the next first cue begins.
 */
export const opensRow = (line: SimLine) => line.type === "character" && simOf(line) === 0;

/** The simultaneous row holding line `i`, if it is in one. */
export function simRowAt(lines: SimLine[], i: number): Row | null {
  if (i < 0 || i >= lines.length || simOf(lines[i]) < 0) return null;
  let start = i;
  while (start > 0 && simOf(lines[start - 1]) >= 0 && !opensRow(lines[start])) start--;
  let end = i + 1;
  while (end < lines.length && simOf(lines[end]) >= 0 && !opensRow(lines[end])) end++;
  let columns = 0;
  for (let k = start; k < end; k++) columns = Math.max(columns, simOf(lines[k]) + 1);
  return { start, end, columns };
}

/**
 * The column a new speaker takes when it joins the row the group at `cueIndex`
 * is in; null when the row already has six. `first` is the group that becomes
 * column 0 when the row is being made for the first time.
 */
export function appendColumn(lines: SimLine[], cueIndex: number): { column: number; first: Group | null } | null {
  const group = speakerGroupAt(lines, cueIndex);
  if (!group) return null;
  const row = simRowAt(lines, group.start);
  const column = row ? row.columns : 1;
  if (column >= MAX_TOGETHER) return null;
  return { column, first: row ? null : group };
}

/**
 * Where a cue at `cueIndex` lands when it joins the speaker above: the new
 * column, and (for the first pairing) the group that becomes column 0.
 * null when there is no speaker directly above, or the row already has six.
 */
export function joinColumn(lines: SimLine[], cueIndex: number): { column: number; first: Group | null } | null {
  const above = speakerGroupAt(lines, cueIndex - 1);
  if (!above || above.end !== cueIndex) return null;
  return appendColumn(lines, above.start);
}

/**
 * The column numbers a document should have: rows with one speaker, or with a
 * gap in the numbering (after a line is deleted), are put right.
 */
export function normalizeSim(lines: SimLine[]): number[] {
  // Only a cue or a speaker's own lines can stand in a row; anything else ends it.
  const rows = lines.map((l) => ({ type: l.type, sim: l.type === "character" || isSpeechType(l.type) ? simOf(l) : -1 }));
  const out = rows.map((l) => l.sim);
  let i = 0;
  while (i < rows.length) {
    if (out[i] < 0) {
      i++;
      continue;
    }
    const row = simRowAt(rows, i)!;
    const used = [...new Set(out.slice(row.start, row.end))].sort((a, b) => a - b);
    const even = used.length >= 2 && used.every((v, k) => v === k);
    if (!even) {
      const remap = new Map(used.map((v, k) => [v, k]));
      for (let k = row.start; k < row.end; k++) out[k] = used.length >= 2 ? remap.get(out[k])! : -1;
    }
    i = row.end;
  }
  return out;
}

export interface Cell {
  /** Grid row, from 1: every line gets its own, so a speaker's lines stack down its column. */
  row: number;
  /** Speaker column, or -1 for a line that spans the whole width. */
  col: number;
  /** Speakers in the row (1 for a full-width line). */
  cols: number;
}

/** Where each line sits in the editor's grid. */
export function gridCells(lines: SimLine[]): Cell[] {
  const cells: Cell[] = lines.map(() => ({ row: 0, col: -1, cols: 1 }));
  let row = 1;
  let i = 0;
  while (i < lines.length) {
    const r = simRowAt(lines, i);
    if (!r || r.columns < 2) {
      cells[i] = { row: row++, col: -1, cols: 1 };
      i++;
      continue;
    }
    // Each speaker starts at the top of the row and runs down its own column, so the row is as
    // tall as its longest speaker.
    let height = 1;
    for (let k = r.start; k < r.end; ) {
      const end = Math.min(speakerGroupAt(lines, k)?.end ?? k + 1, r.end);
      for (let j = k; j < end; j++) cells[j] = { row: row + (j - k), col: simOf(lines[j]), cols: r.columns };
      height = Math.max(height, end - k);
      k = end;
    }
    row += height;
    i = r.end;
  }
  return cells;
}

/** The CSS grid placement of a line, in the editor and in its decorations. */
export function gridStyle(cell: Cell): string {
  if (cell.col < 0) return `grid-column: 1 / -1; grid-row: ${cell.row};`;
  const span = GRID_COLUMNS / cell.cols;
  const start = Math.round(cell.col * span) + 1;
  return `grid-column: ${start} / span ${Math.round(span)}; grid-row: ${cell.row};`;
}
