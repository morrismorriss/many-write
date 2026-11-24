import { describe, expect, it } from "vitest";
import { MAX_TOGETHER, gridCells, gridStyle, joinColumn, normalizeSim, simRowAt, speakerGroupAt, type SimLine } from "./simultaneous";

const lines = (...spec: [string, number?][]): SimLine[] => spec.map(([type, sim]) => (sim === undefined ? { type } : { type, sim }));

const cue = (_name: string, sim?: number): SimLine[] => lines(["character", sim], ["dialogue", sim]);

describe("speaker groups", () => {
  it("holds a cue and the lines printed under it", () => {
    const doc = [...cue("ANNA"), ["direction"], ...cue("BEN")] as SimLine[];
    expect(speakerGroupAt(doc, 1)).toEqual({ start: 0, end: 2 });
    expect(speakerGroupAt(doc, 2)).toBeNull();
    expect(speakerGroupAt(doc, 3)).toEqual({ start: 3, end: 5 });
  });
});

describe("simultaneous rows", () => {
  it("stops at a direction or a normal cue", () => {
    const doc = [...cue("ANNA", 0), ...cue("BEN", 1), ["direction"], ...cue("CY")] as SimLine[];
    expect(simRowAt(doc, 0)).toEqual({ start: 0, end: 4, columns: 2 });
    expect(simRowAt(doc, 4)).toBeNull();
  });

  it("keeps two rows that follow one another apart", () => {
    const doc = [...cue("ANNA", 0), ...cue("BEN", 1), ...cue("CY", 0), ...cue("DEE", 1), ...cue("EVE", 2)];
    expect(simRowAt(doc, 0)).toEqual({ start: 0, end: 4, columns: 2 });
    expect(simRowAt(doc, 5)).toEqual({ start: 4, end: 10, columns: 3 });
    expect(gridCells(doc).map((c) => [c.row, c.col, c.cols])).toEqual([
      [1, 0, 2],
      [2, 0, 2],
      [1, 1, 2],
      [2, 1, 2],
      [3, 0, 3],
      [4, 0, 3],
      [3, 1, 3],
      [4, 1, 3],
      [3, 2, 3],
      [4, 2, 3],
    ]);
  });

  it("does not treat a lone column as simultaneous", () => {
    const doc = lines(["character", 0], ["dialogue", 0]);
    expect(gridCells(doc)).toEqual([
      { row: 1, col: -1, cols: 1 },
      { row: 2, col: -1, cols: 1 },
    ]);
  });

  it("gives each speaker an even share of the grid", () => {
    const doc = [...cue("ANNA", 0), ...cue("BEN", 1), ...cue("CY", 2)];
    expect(gridCells(doc).map((c) => [c.row, c.col, c.cols])).toEqual([
      [1, 0, 3],
      [2, 0, 3],
      [1, 1, 3],
      [2, 1, 3],
      [1, 2, 3],
      [2, 2, 3],
    ]);
    // Three speakers: two grid columns of thirty, side by side.
    expect(gridStyle({ row: 1, col: 1, cols: 3 })).toBe("grid-column: 21 / span 20; grid-row: 1;");
    expect(gridStyle({ row: 2, col: -1, cols: 1 })).toBe("grid-column: 1 / -1; grid-row: 2;");
  });
});

describe("joining a row", () => {
  it("pairs a cue with the speaker above", () => {
    const doc = [...cue("ANNA")];
    expect(joinColumn(doc, 2)).toEqual({ column: 1, first: { start: 0, end: 2 } });
  });

  it("adds the next column to an existing row", () => {
    expect(joinColumn([...cue("ANNA", 0), ...cue("BEN", 1)], 4)).toEqual({ column: 2, first: null });
  });

  it("refuses a seventh speaker, or a cue with no speaker above", () => {
    const six = [...cue("ANNA", 0), ...cue("BEN", 1), ...cue("CY", 2), ...cue("DEE", 3), ...cue("EVE", 4), ...cue("FLO", 5)];
    expect(MAX_TOGETHER).toBe(6);
    expect(joinColumn(six, 12)).toBeNull();
    expect(joinColumn([...cue("ANNA"), { type: "direction" }], 3)).toBeNull();
  });
});

describe("normalising rows", () => {
  it("closes a gap left where a speaker was deleted", () => {
    const doc = [...cue("ANNA", 0), ...cue("CY", 2)];
    expect(normalizeSim(doc)).toEqual([0, 0, 1, 1]);
  });

  it("returns the last speaker to a normal cue when the row shrinks to one", () => {
    expect(normalizeSim([...cue("ANNA", 0)])).toEqual([-1, -1]);
  });

  it("leaves a well-formed row and normal lines alone", () => {
    const doc = [...cue("ANNA", 0), ...cue("BEN", 1), { type: "direction" }, ...cue("CY")];
    expect(normalizeSim(doc)).toEqual([0, 0, 1, 1, -1, -1, -1]);
  });
});
