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
