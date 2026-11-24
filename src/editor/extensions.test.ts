import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Underline from "@tiptap/extension-underline";
import HardBreak from "@tiptap/extension-hard-break";
import { ElementNode, ImageNode, NoteRefNode, ScriptDocument, blocksToContent, docToBlocks } from "./extensions";
import { TEMPLATES } from "../formats/templates";

const schema = getSchema([ScriptDocument, Text, ElementNode, ImageNode, NoteRefNode, Bold, Italic, Underline, HardBreak]);
const essay = TEMPLATES.essay;

describe("simultaneous dialogue", () => {
  const play = TEMPLATES["stage-play"];

  it("keeps each speaker's column through a round trip", () => {
    const blocks = [
      { type: "character" as const, runs: [{ text: "ANNA" }], sim: 0 },
      { type: "dialogue" as const, runs: [{ text: "Left." }], sim: 0 },
      { type: "character" as const, runs: [{ text: "BEN" }], sim: 1 },
      { type: "dialogue" as const, runs: [{ text: "Right." }], sim: 1 },
      { type: "character" as const, runs: [{ text: "MARA" }] },
      { type: "dialogue" as const, runs: [{ text: "Alone." }] },
    ];
    const doc = schema.nodeFromJSON(blocksToContent(blocks, play));
    expect(docToBlocks(doc)).toEqual(blocks);
  });

  it("writes the column into the line's HTML, and leaves an ordinary line unmarked", () => {
    const content = blocksToContent(
      [
        { type: "character", runs: [{ text: "ANNA" }], sim: 2 },
        { type: "character", runs: [{ text: "BEN" }] },
      ],
      play,
    );
    expect(content.content?.[0].attrs).toMatchObject({ type: "character", sim: 2 });
    expect(content.content?.[1].attrs).toMatchObject({ type: "character", sim: -1 });
  });
});

describe("notes in the editor", () => {
  it("keeps note markers and their ids through a round trip", () => {
    const blocks = [{ type: "paragraph" as const, runs: [{ text: "One" }, { text: "", note: "n1" }, { text: " two", bold: true }] }];
    const doc = schema.nodeFromJSON(blocksToContent(blocks, essay));
    expect(docToBlocks(doc)).toEqual(blocks);
  });

  it("numbers markers by first reference", () => {
    const content = blocksToContent([{ type: "paragraph", runs: [{ text: "One", note: "b" }, { text: " two", note: "a" }] }], essay);
    const refs = (content.content?.[0].content ?? []).filter((n) => n.type === "noteRef").map((n) => n.attrs);
    expect(refs).toEqual([
      { id: "b", number: 1 },
      { id: "a", number: 2 },
    ]);
  });
});
