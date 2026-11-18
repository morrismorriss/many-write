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
  parseDoc,
  serializeDoc,
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

describe("works cited and bibliography entries", () => {
  it("reads '- ' lines as sources only where citations are allowed, and writes them back", () => {
    const md = "- Smith, Ann. *A Book*. Press, 2020.\n\n- Jones, Bo. \"An Article.\"\n  *Journal*, 2019.\n";
    const doc = parseProse(md, false, true);
    expect(types(doc.blocks)).toEqual(["citation:Smith, Ann. A Book. Press, 2020.", 'citation:Jones, Bo. "An Article." Journal, 2019.']);
    expect(serializeProse(doc)).toBe('- Smith, Ann. *A Book*. Press, 2020.\n\n- Jones, Bo. "An Article." *Journal*, 2019.\n');
    // Elsewhere (a book chapter) the same line stays a paragraph, and survives a round trip.
    const para = parseProse("- Hello, she said.\n", false);
    expect(types(para.blocks)).toEqual(["paragraph:- Hello, she said."]);
    expect(types(parseProse(serializeProse(para), false, true).blocks)).toEqual(["paragraph:- Hello, she said."]);
  });
});

describe("text-message bubbles", () => {
  it("round-trips left and right bubbles in prose and in documents", () => {
    const md = "Before.\n\n> [!text-left] Are you up?\n\n> [!text-right] Yes\\\n> why?\n";
    const prose = parseProse(md, false);
    expect(types(prose.blocks)).toEqual(["paragraph:Before.", "text_left:Are you up?", "text_right:Yes\nwhy?"]);
    expect(serializeProse(prose)).toBe(md);
    const notes = parseNotes("> [!text-right] Hi\n> there\n\n> [!note] A callout\n");
    expect(types(notes.blocks)).toEqual(["text_right:Hi\nthere", "callout:A callout"]);
    expect(serializeNotes(notes)).toBe("> [!text-right] Hi\n> there\n\n> [!note] A callout\n");
  });
});

describe("blank lines", () => {
  it("keeps empty paragraphs between text as &nbsp; lines, and drops trailing ones", () => {
    const blocks = [
      { type: "paragraph" as const, runs: [{ text: "One." }] },
      { type: "paragraph" as const, runs: [] },
      { type: "paragraph" as const, runs: [] },
      { type: "paragraph" as const, runs: [{ text: "Two." }] },
      { type: "paragraph" as const, runs: [] },
    ];
    const md = serializeDoc({ blocks, frontMatter: null }, "prose");
    expect(md).toBe("One.\n\n&nbsp;\n\n&nbsp;\n\nTwo.\n");
    expect(parseDoc(md, "prose").blocks.map((b) => b.runs.length)).toEqual([1, 0, 0, 1]);
    const notes = serializeDoc({ blocks, frontMatter: null }, "notes");
    expect(notes).toBe("One.\n\n&nbsp;\n\n&nbsp;\n\nTwo.\n");
    expect(parseDoc(notes, "notes").blocks.length).toBe(4);
  });
  it("escapes a paragraph that is literally &nbsp;", () => {
    const md = serializeDoc({ blocks: [{ type: "paragraph", runs: [{ text: "&nbsp;" }] }], frontMatter: null }, "prose");
    expect(parseDoc(md, "prose").blocks[0].runs[0].text).toBe("&nbsp;");
  });
});

describe("hostile image paths", () => {
  it("a malformed percent escape is kept literally, not thrown", () => {
    // A stray "%" (a hand-edited file, another tool) must not take the document down.
    const doc = parseProse("![x](%)\n", false, false);
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]).toMatchObject({ type: "image", src: "%" });
    const notes = parseNotes("![x](%E0%A4%A)\n");
    expect(notes.blocks[0]).toMatchObject({ type: "image", src: "%E0%A4%A" });
    expect(() => parseDoc("![a](%zz)\n", "prose")).not.toThrow();
    expect(() => parseDoc("![a](%)\n", "notes")).not.toThrow();
  });

  it("still decodes valid escapes, and round-trips", () => {
    const md = "![A cat](assets/cat%20photo.png)\n";
    const doc = parseProse(md, false, false);
    expect(doc.blocks[0].src).toBe("assets/cat photo.png");
    expect(serializeProse(doc)).toBe(md);
  });

  it("a path that cannot be encoded is written literally, not thrown", () => {
    // A lone surrogate is not encodable; serializing must not throw.
    const src = "assets/" + String.fromCharCode(0xd800) + ".png";
    expect(() => serializeDoc({ blocks: [{ type: "image", runs: [], src }], frontMatter: null }, "prose")).not.toThrow();
  });
});
