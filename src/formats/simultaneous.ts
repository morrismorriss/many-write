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
  /** The line's text, when the caller knows it: a name with nothing in it is not a speaker. */
  text?: string;
}

export const simOf = (line: SimLine) => Math.max(-1, line.sim ?? -1);

/** A cue with no name in it yet — a line left behind by a deletion, say. */
export const isBlankCue = (line: SimLine) => line.type === "character" && line.text !== undefined && line.text.trim() === "";

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
export const opensRow = (line: SimLine) => line.type === "character" && simOf(line) === 0 && !isBlankCue(line);

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
 * The column numbers a document should have. Columns are counted from the left in the order
 * the cues stand, so a speaker taken out of a row closes up: three speakers become two, and a
 * pair left with one speaker goes back to plain, full-width lines.
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
    // A named cue opens a column. Anything else — its speech, or a blank line left by a
    // deletion — belongs to the column above, so taking a name out closes the row up.
    const columns: Group[] = [];
    for (let k = row.start; k < row.end; ) {
      if (rows[k].type !== "character" || isBlankCue(lines[k])) {
        k++;
        continue;
      }
      let end = k + 1;
      while (end < row.end && (isSpeechType(rows[end].type) || isBlankCue(lines[end]))) end++;
      columns.push({ start: k, end });
      k = end;
    }
    for (let k = row.start; k < row.end; k++) out[k] = -1;
    if (columns.length >= 2) columns.forEach((column, index) => {
      for (let k = column.start; k < column.end; k++) out[k] = index;
    });
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
    // tall as its longest column.
    const placed = new Map<number, number>();
    let height = 1;
    for (let k = r.start; k < r.end; k++) {
      const col = simOf(lines[k]);
      const down = placed.get(col) ?? 0;
      cells[k] = { row: row + down, col, cols: r.columns };
      placed.set(col, down + 1);
      height = Math.max(height, down + 1);
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
