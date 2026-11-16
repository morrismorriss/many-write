import { describe, expect, it } from "vitest";
import {
  blockText,
  parseInline,
  parsePoem,
  parseProse,
  parseScript,
  serializePoem,
  serializeProse,
  serializeRuns,
  serializeScript,
  type Block,
} from "./markdown";

const types = (bs: Block[]) => bs.map((b) => `${b.type}:${blockText(b)}`);

describe("script convention", () => {
  const sample = `## Scene 1

A kitchen. Morning.

ANNA
(quietly)
I told you already.
Twice.

BEN
Did you?

She crosses to the window.

> BLACKOUT.
`;

  it("derives element types from markers", () => {
    expect(types(parseScript(sample).blocks)).toEqual([
      "scene_heading:Scene 1",
      "direction:A kitchen. Morning.",
      "character:ANNA",
      "parenthetical:(quietly)",
      "dialogue:I told you already.",
      "dialogue:Twice.",
      "character:BEN",
      "dialogue:Did you?",
      "direction:She crosses to the window.",
      "transition:BLACKOUT.",
    ]);
  });

  it("round-trips byte for byte", () => {
    expect(serializeScript(parseScript(sample))).toBe(sample);
  });

  it("an all-caps line followed by a blank line is a direction, not a cue", () => {
    expect(types(parseScript("BLACKOUT.\n\nANNA\nHi.\n").blocks)).toEqual([
      "direction:BLACKOUT.",
      "character:ANNA",
      "dialogue:Hi.",
    ]);
  });

  it("forces ambiguous directions with ! and mixed-case cues with @", () => {
    const blocks: Block[] = [
      { type: "direction", runs: [{ text: "NOBODY MOVES.\nThen everyone does." }] },
      { type: "character", runs: [{ text: "McCoy" }] },
      { type: "dialogue", runs: [{ text: "Hello." }] },
      { type: "character", runs: [{ text: "ANNA" }] }, // a cue with no dialogue
      { type: "direction", runs: [{ text: "> not a transition" }] },
    ];
    const md = serializeScript({ blocks, frontMatter: null });
    expect(md).toBe("!NOBODY MOVES.\nThen everyone does.\n\nMCCOY\nHello.\n\n@ANNA\n\n!> not a transition\n");
    expect(types(parseScript(md).blocks)).toEqual([
      "direction:NOBODY MOVES.\nThen everyone does.",
      "character:MCCOY",
      "dialogue:Hello.",
      "character:ANNA",
      "direction:> not a transition",
    ]);
  });

  it("reads Fountain scene headings and transitions", () => {
    expect(types(parseScript("INT. HOUSE - DAY\n\nCUT TO:\n\n.THE ROOF\n").blocks)).toEqual([
      "scene_heading:INT. HOUSE - DAY",
      "transition:CUT TO:",
      "scene_heading:THE ROOF",
    ]);
  });

  it("wraps parentheticals and keeps dialogue that looks like one", () => {
    const md = serializeScript({
      blocks: [
        { type: "character", runs: [{ text: "anna" }] },
        { type: "parenthetical", runs: [{ text: "beat" }] },
        { type: "dialogue", runs: [{ text: "(this is spoken)" }] },
      ],
      frontMatter: null,
    });
    expect(md).toBe("ANNA\n(beat)\n\\(this is spoken)\n");
    expect(types(parseScript(md).blocks)).toEqual(["character:ANNA", "parenthetical:(beat)", "dialogue:(this is spoken)"]);
  });

  it("keeps YAML front matter untouched", () => {
    const md = "---\ntags: [draft]\n---\n## Scene 1\n";
    const doc = parseScript(md);
    expect(doc.frontMatter).toBe("---\ntags: [draft]\n---\n");
    expect(serializeScript(doc)).toBe(md);
  });
});

describe("inline marks", () => {
  it("parses and writes emphasis", () => {
    const runs = parseInline("I *really* mean **it**, _now_.");
    expect(runs).toEqual([
      { text: "I " },
      { text: "really", italic: true },
      { text: " mean " },
      { text: "it", bold: true },
      { text: ", " },
      { text: "now", underline: true },
      { text: "." },
    ]);
    expect(serializeRuns(runs)).toBe("I *really* mean **it**, _now_.");
  });

  it("leaves lone markers and snake_case literal", () => {
    expect(parseInline("2 * 3 and snake_case")).toEqual([{ text: "2 * 3 and snake_case" }]);
  });

  it("escapes literal markers when writing", () => {
    const md = serializeRuns([{ text: "a*b_c" }]);
    expect(md).toBe("a\\*b\\_c");
    expect(parseInline(md)).toEqual([{ text: "a*b_c" }]);
  });
});

describe("prose", () => {
  it("round-trips headings, paragraphs, quotes and breaks", () => {
    const md = "# My Essay\n\n## Part one\n\nFirst paragraph with *style*.\n\n> A quote.\n\n* * *\n\nLast line\\\nafter a break.\n";
    const doc = parseProse(md, true);
    expect(types(doc.blocks)).toEqual([
      "title:My Essay",
      "heading:Part one",
      "paragraph:First paragraph with style.",
      "quote:A quote.",
      "scene_break:",
      "paragraph:Last line\nafter a break.",
    ]);
    expect(serializeProse(doc)).toBe(md);
  });

  it("joins hard-wrapped lines from other editors", () => {
    expect(types(parseProse("one\ntwo\n", false).blocks)).toEqual(["paragraph:one two"]);
  });
});

describe("poem", () => {
  it("preserves line breaks, blank lines and indentation exactly", () => {
    const md = "# Tide\n\nThe sea comes in\n    and goes out,\n\n\n  *slowly*, slowly.\n";
    const doc = parsePoem(md);
    expect(types(doc.blocks)).toEqual([
      "title:Tide",
      "line:The sea comes in",
      "line:    and goes out,",
      "line:",
      "line:",
      "line:  slowly, slowly.",
    ]);
    expect(serializePoem(doc)).toBe(md);
  });
});

import { parseNotes, serializeNotes, parseProse as parseProse2, serializeProse as serializeProse2 } from "./markdown";

describe("notes (Notion-style)", () => {
  const md = `# Anna

Role: lead.

## Wants

- the letter back
- to leave town

1. first
2. second

- [ ] find a surname
- [x] decide her age

> [!note] She never says the word "sorry".

> Quote here.

---

1\\. not a list

\\- not a bullet
`;
  it("round-trips lists, to-dos, callouts and dividers", () => {
    const doc = parseNotes(md);
    expect(types(doc.blocks)).toEqual([
      "title:Anna",
      "paragraph:Role: lead.",
      "heading:Wants",
      "bullet:the letter back",
      "bullet:to leave town",
      "numbered:first",
      "numbered:second",
      "todo:find a surname",
      "todo_done:decide her age",
      'callout:She never says the word "sorry".',
      "quote:Quote here.",
      "divider:",
      "paragraph:1. not a list",
      "paragraph:- not a bullet",
    ]);
    expect(serializeNotes(doc)).toBe(md);
  });
});

describe("front matter pages", () => {
  it("round-trips centred lines", () => {
    const md = "-> For Anna <-\n\nA plain paragraph.\n";
    const doc = parseProse2(md, false);
    expect(types(doc.blocks)).toEqual(["centered:For Anna", "paragraph:A plain paragraph."]);
    expect(serializeProse2(doc)).toBe(md);
  });
});
