import { describe, expect, it } from "vitest";
import { countPages, describeRanges, parsePageRanges } from "./pages";

describe("page ranges", () => {
  it("reads single pages, ranges and open ends", () => {
    expect(parsePageRanges("2, 5-7, 10-")).toEqual({
      ok: true,
      ranges: [
        { from: 2, to: 2 },
        { from: 5, to: 7 },
        { from: 10, to: null },
      ],
    });
    expect(parsePageRanges("-3")).toEqual({ ok: true, ranges: [{ from: 1, to: 3 }] });
    expect(parsePageRanges("4 to 6; 8–9")).toEqual({ ok: true, ranges: [{ from: 4, to: 6 }, { from: 8, to: 9 }] });
  });

  it("explains what's wrong", () => {
    expect(parsePageRanges("").ok).toBe(false);
    expect(parsePageRanges("abc").ok).toBe(false);
    expect(parsePageRanges("0").ok).toBe(false);
    expect(parsePageRanges("5-2")).toMatchObject({ ok: false, error: expect.stringContaining("backwards") });
    expect(parsePageRanges("12", 10)).toMatchObject({ ok: false, error: expect.stringContaining("10 pages") });
  });

  it("clamps to the document and counts each page once", () => {
    const r = parsePageRanges("1-3, 2-4, 9-20", 10);
    expect(r.ok && r.ranges[2]).toEqual({ from: 9, to: 10 });
    expect(r.ok && countPages(r.ranges, 10)).toBe(6);
    expect(describeRanges([{ from: 1, to: 3 }, { from: 5, to: 5 }, { from: 8, to: null }])).toBe("1–3, 5, 8–end");
  });
});
