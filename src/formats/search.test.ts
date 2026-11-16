import { describe, expect, it } from "vitest";
import { findInBlocks, replaceInBlocks, searchRegex } from "./search";
import type { Block } from "./markdown";

const blocks: Block[] = [
  { type: "dialogue", runs: [{ text: "Anna, " }, { text: "Anna", italic: true }, { text: " — Annabel." }] },
  { type: "character", runs: [{ text: "ANNA" }] },
];

describe("find & replace", () => {
  it("finds with case and whole-word options", () => {
    expect(findInBlocks("d", blocks, searchRegex({ query: "anna", matchCase: false, wholeWord: false })!).length).toBe(4);
    expect(findInBlocks("d", blocks, searchRegex({ query: "Anna", matchCase: true, wholeWord: true })!).length).toBe(2);
  });

  it("replaces all, keeping the italic on the italic match", () => {
    const re = searchRegex({ query: "Anna", matchCase: true, wholeWord: true })!;
    const r = replaceInBlocks(blocks, re, "Maria");
    expect(r.count).toBe(2);
    expect(r.blocks[0].runs).toEqual([{ text: "Maria, " }, { text: "Maria", italic: true }, { text: " — Annabel." }]);
  });

  it("replaces a single match", () => {
    const re = searchRegex({ query: "anna", matchCase: false, wholeWord: true })!;
    const r = replaceInBlocks(blocks, re, "BEA", { index: 1, from: 0 });
    expect(r.count).toBe(1);
    expect(r.blocks[1].runs).toEqual([{ text: "BEA" }]);
    expect(r.blocks[0]).toBe(blocks[0]);
  });
});
