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

import { inSong, listNumbers } from "./templates";

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

describe("nested lists", () => {
  it("round-trips indent levels with one tab per level and numbers each level on its own", () => {
    const md = "1. Act one\n\t- the letter\n\t\t- [ ] find it\n\t- the train\n2. Act two\n\t1. arrival\n\t2. departure\n";
    const doc = parseNotes(md);
    expect(doc.blocks.map((b) => `${b.indent ?? 0}:${b.type}:${blockText(b)}`)).toEqual([
      "0:numbered:Act one",
      "1:bullet:the letter",
      "2:todo:find it",
      "1:bullet:the train",
      "0:numbered:Act two",
      "1:numbered:arrival",
      "1:numbered:departure",
    ]);
    expect(serializeNotes(doc)).toBe(md);
  });

  it("reads lists indented with spaces, as other apps write them", () => {
    const doc = parseNotes("- a\n  - b\n    - c\n  - d\n- e\n\nAfter.\n");
    expect(doc.blocks.map((b) => b.indent ?? 0)).toEqual([0, 1, 2, 1, 0, 0]);
  });

  it("numbers nested items without breaking the outer count", () => {
    const blocks = [
      { type: "numbered", indent: 0 },
      { type: "numbered", indent: 1 },
      { type: "numbered", indent: 1 },
      { type: "bullet", indent: 2 },
      { type: "numbered", indent: 0 },
      { type: "paragraph" },
      { type: "numbered", indent: 0 },
    ];
    expect(listNumbers(blocks)).toEqual([1, 1, 2, 0, 2, 0, 1]);
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

describe("simultaneous dialogue", () => {
  const two = `ANNA
I told you.

BEN ^
And I warned you.
`;

  it("reads a caret cue as a speaker beside the one above", () => {
    const { blocks } = parseScript(two);
    expect(types(blocks)).toEqual(["character:ANNA", "dialogue:I told you.", "character:BEN", "dialogue:And I warned you."]);
    expect(blocks.map((b) => b.sim ?? -1)).toEqual([0, 0, 1, 1]);
  });

  it("round-trips byte for byte", () => {
    const md = serializeScript(parseScript(two));
    expect(md).toBe(two);
    expect(parseScript(md).blocks.map((b) => b.sim ?? -1)).toEqual([0, 0, 1, 1]);
  });

  it("takes up to six speakers in a row", () => {
    const names = ["ANNA", "BEN", "CY", "DEE", "EVE", "FLO"];
    const md = names.map((n, i) => `${n}${i ? " ^" : ""}\nLine ${i + 1}.`).join("\n\n") + "\n";
    const { blocks } = parseScript(md);
    expect(blocks.filter((b) => b.type === "character").map((b) => b.sim)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(serializeScript({ blocks, frontMatter: null })).toBe(md);
  });

  it("seventh speaker stays a normal cue", () => {
    const names = ["ANNA", "BEN", "CY", "DEE", "EVE", "FLO", "GUS"];
    const md = names.map((n, i) => `${n}${i ? " ^" : ""}\nLine ${i + 1}.`).join("\n\n") + "\n";
    const { blocks } = parseScript(md);
    const cues = blocks.filter((b) => b.type === "character");
    expect(cues.map((b) => b.sim ?? -1)).toEqual([0, 1, 2, 3, 4, 5, -1]);
    // The caret that could not be used is kept as text, so nothing is lost.
    expect(blockText(cues[6])).toBe("GUS ^");
  });

  it("leaves a caret alone when no speaker is directly above", () => {
    const md = `A kitchen.

BEN ^
Hello.
`;
    expect(parseScript(md).blocks.map((b) => b.sim ?? -1)).toEqual([-1, -1, -1]);
    expect(serializeScript(parseScript(md))).toBe(md);
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

describe("footnotes and endnotes", () => {
  const doc = `A first claim.[^1] A second.[^2]

[^1]: First note.

[^2]: Second note.
`;

  it("reads references and definitions, and round-trips", () => {
    const parsed = parseProse(doc, false);
    expect(parsed.notes?.map((n) => n.id)).toEqual(["1", "2"]);
    expect(blockText(parsed.blocks[0])).toBe("A first claim. A second.");
    expect(parsed.blocks[0].runs.filter((r) => r.note).map((r) => r.note)).toEqual(["1", "2"]);
    expect(serializeProse(parsed)).toBe(doc);
  });

  it("numbers notes by first reference, not by definition order", () => {
    const md = `A[^b] B[^a]

[^a]: Note A.

[^b]: Note B.
`;
    expect(serializeProse(parseProse(md, false))).toBe(`A[^1] B[^2]

[^1]: Note B.

[^2]: Note A.
`);
  });

  it("renumbers when a note is inserted before an existing one", () => {
    const parsed = parseProse(`A[^1] B[^2]

[^1]: One.

[^2]: Two.
`, false);
    parsed.blocks[0].runs.splice(3, 0, { text: "", note: "new" });
    parsed.notes!.push({ id: "new", runs: [{ text: "New." }] });
    expect(serializeProse(parsed)).toBe(`A[^1] B[^2][^3]

[^1]: One.

[^2]: New.

[^3]: Two.
`);
  });

  it("keeps the marker out of the block's text, so it is not a word", () => {
    const parsed = parseProse(`A[^1] word

[^1]: Note.
`, false);
    expect(blockText(parsed.blocks[0])).toBe("A word");
  });

  it("leaves a reference with no definition as literal text", () => {
    const parsed = parseProse("A[^7]\n", false);
    expect(parsed.notes).toBeUndefined();
    expect(blockText(parsed.blocks[0])).toBe("A[^7]");
    expect(serializeProse(parsed)).toBe("A[^7]\n");
  });

  it("keeps a definition nothing references, numbered after the rest", () => {
    const md = `A[^1]

[^1]: One.

[^9]: Orphan.
`;
    expect(serializeProse(parseProse(md, false))).toBe(`A[^1]

[^1]: One.

[^2]: Orphan.
`);
  });

  it("continues an indented definition on the next line", () => {
    const md = `A[^1]

[^1]: First line
    second line.
`;
    const parsed = parseProse(md, false);
    expect(parsed.notes![0].runs.map((r) => r.text).join("")).toBe("First line\nsecond line.");
    expect(serializeProse(parsed)).toBe(md);
  });

  it("keeps emphasis inside a note", () => {
    const md = `A[^1]

[^1]: See *Beloved*, p. 3.
`;
    expect(serializeProse(parseProse(md, false))).toBe(md);
  });

  it("takes the first definition when a label repeats, and keeps the rest as text", () => {
    const parsed = parseProse(`A[^1]

[^1]: First.

[^1]: Second.
`, false);
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes![0].runs.map((r) => r.text).join("")).toBe("First.");
    const once = serializeProse(parsed);
    expect(once).toBe(`A[^1]

\\[^1]: Second.

[^1]: First.
`);
    // Stable: reading it back gives the same file.
    expect(serializeProse(parseProse(once, false))).toBe(once);
  });

  it("does not read a marker followed by a colon as a reference", () => {
    const parsed = parseProse("See [^1]: this.\n", false);
    expect(blockText(parsed.blocks[0])).toBe("See [^1]: this.");
    expect(parsed.notes).toBeUndefined();
  });

  it("round-trips an empty note", () => {
    const md = "A[^1]\n\n[^1]:\n";
    expect(serializeProse(parseProse(md, false))).toBe(md);
  });

  it("is not special in scripts or poems", () => {
    expect(parseScript("A[^1]\n").blocks[0].runs).toEqual([{ text: "A[^1]" }]);
    expect(parsePoem("A[^1]\n").blocks[0].runs).toEqual([{ text: "A[^1]" }]);
  });

  it("keeps a note with a blank line in it as one note", () => {
    const doc = parseProse("Hello[^1]\n\n[^1]: x\n", false);
    doc.notes![0].runs = [{ text: "Para one.\n\nPara two." }];
    const back = parseProse(serializeProse(doc), false);
    expect(back.blocks).toHaveLength(1);
    expect(back.notes![0].runs.map((r) => r.text).join("")).toBe("Para one.\n\nPara two.");
  });

  it("keeps several blank lines inside a note", () => {
    const doc = parseProse("Hello[^1]\n\n[^1]: x\n", false);
    doc.notes![0].runs = [{ text: "One.\n\n\nTwo." }];
    const back = parseProse(serializeProse(doc), false);
    expect(back.blocks).toHaveLength(1);
    expect(back.notes![0].runs.map((r) => r.text).join("")).toBe("One.\n\n\nTwo.");
  });

  it("writes a stable label when no number map is given", () => {
    expect(serializeRuns([{ text: "A" }, { text: "", note: "abc" }])).toBe("A[^abc]");
  });
});

describe("songs in a musical", () => {
  const sample = `## Scene 3

~~ The Long Way Home

ANNA
~I walked the road alone
~And never looked behind
(to BEN)
~Until you

She takes his hand.

BEN
~Sing it again

They turn to the audience.

~All the road, all the way
~All the way home

> BLACKOUT.
`;

  it("reads song titles and lyrics, under a cue or on their own", () => {
    expect(types(parseScript(sample).blocks)).toEqual([
      "scene_heading:Scene 3",
      "song:The Long Way Home",
      "character:ANNA",
      "lyric:I walked the road alone",
      "lyric:And never looked behind",
      "parenthetical:(to BEN)",
      "lyric:Until you",
      "direction:She takes his hand.",
      "character:BEN",
      "lyric:Sing it again",
      "direction:They turn to the audience.",
      "lyric:All the road, all the way",
      "lyric:All the way home",
      "transition:BLACKOUT.",
    ]);
  });

  it("writes them back unchanged", () => {
    expect(serializeScript(parseScript(sample))).toBe(sample);
  });

  it("keeps a cue whose only lines are sung", () => {
    const md = serializeScript({ blocks: [{ type: "character", runs: [{ text: "Anna" }] }, { type: "lyric", runs: [{ text: "La la" }] }], frontMatter: null });
    expect(md).toBe("ANNA\n~La la\n");
  });

  it("keeps spoken lines and directions that start with ~ as they are", () => {
    const blocks: Block[] = [
      { type: "character", runs: [{ text: "ANNA" }] },
      { type: "dialogue", runs: [{ text: "~approximately" }] },
      { type: "direction", runs: [{ text: "~ A wave." }] },
      { type: "lyric", runs: [{ text: "~tilde" }] },
    ];
    const back = parseScript(serializeScript({ blocks, frontMatter: null })).blocks;
    expect(types(back)).toEqual(["character:ANNA", "dialogue:~approximately", "direction:~ A wave.", "lyric:~tilde"]);
  });

  it("knows when a cue is inside a song", () => {
    expect(inSong(["song", "character"], 2)).toBe(true);
    expect(inSong(["lyric", "direction", "character", "parenthetical"], 4)).toBe(true);
    expect(inSong(["song", "character", "lyric", "character", "dialogue", "character"], 6)).toBe(false);
    expect(inSong(["scene_heading", "character"], 2)).toBe(false);
  });
});
