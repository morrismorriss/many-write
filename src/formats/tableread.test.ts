import { describe, expect, it } from "vitest";
import { plainBlock, type Block } from "./markdown";
import { castOf, itemsForPlay, linesOf, playsOf, tableReadFileName } from "./tableread";
import { generateTypst, type ManuscriptItem, type ProjectMeta } from "./typst";
import { TEMPLATES } from "./templates";

const b = (type: string, text: string, sim?: number): Block => ({ ...plainBlock(type as Block["type"], text), ...(sim === undefined ? {} : { sim }) });

const scene: Block[] = [
  b("scene_heading", "SCENE ONE"),
  b("character", "ANNA"),
  b("dialogue", "Hello."),
  b("character", "BEN (O.S.)"),
  b("parenthetical", "(off)"),
  b("dialogue", "Hi."),
  b("direction", "Anna sits."),
  b("character", "anna"),
  b("dialogue", "Again."),
  b("transition", "BLACKOUT."),
];

describe("table read lines", () => {
  it("takes a character's cues and the lines under them", () => {
    expect([...linesOf(scene, "ANNA")]).toEqual([1, 2, 7, 8]);
    expect([...linesOf(scene, "BEN")]).toEqual([3, 4, 5]);
  });

  it("follows speakers side by side column by column", () => {
    const row = [b("character", "ANNA", 0), b("dialogue", "One", 0), b("character", "BEN", 1), b("dialogue", "Two", 1), b("direction", "They stop.")];
    expect([...linesOf(row, "ANNA")]).toEqual([0, 1]);
    expect([...linesOf(row, "BEN")]).toEqual([2, 3]);
  });

  it("lists the cast, most speeches first", () => {
    expect(castOf([{ kind: "doc", id: "s1", title: "S", blocks: scene }])).toEqual([
      { name: "ANNA", speeches: 2 },
      { name: "BEN", speeches: 1 },
    ]);
  });

  it("picks one play of a collection, keeping front and back matter", () => {
    const items: ManuscriptItem[] = [
      { kind: "matter", id: "f", title: "Cast", blocks: [], where: "front" },
      { kind: "play", id: "p1", title: "One" },
      { kind: "doc", id: "a", title: "A", blocks: scene },
      { kind: "play", id: "p2", title: "Two" },
      { kind: "matter", id: "pf", title: "Cast", blocks: [], where: "front" },
      { kind: "doc", id: "b", title: "B", blocks: scene },
      { kind: "matter", id: "x", title: "Notes", blocks: [], where: "back" },
    ];
    expect(playsOf(items).map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(itemsForPlay(items, "p2").map((i) => i.id)).toEqual(["f", "p2", "pf", "b", "x"]);
    expect(itemsForPlay(items, "p1").map((i) => i.id)).toEqual(["f", "p1", "a", "x"]);
  });

  it("highlights only that character in the typeset script", () => {
    const meta: ProjectMeta = { title: "T", author: "", contact: "", titlePage: false, paper: "us-letter" };
    const g = generateTypst(TEMPLATES["stage-play"], meta, [{ kind: "doc", id: "s1", title: "S", blocks: scene }], { highlight: { name: "BEN", fill: "#fff176" } });
    expect(g.source.match(/#highlight/g)?.length).toBe(3);
    expect(g.source).toContain('revision: "BEN: table read"');
    expect(g.source).toMatch(/#highlight\(fill: rgb\("#fff176"\), extent: 1.5pt\)\[#"Hi."\]/);
  });

  it("names files safely", () => {
    expect(tableReadFileName("A/B: play", "ANNA")).toBe("A-B- play - ANNA.pdf");
  });
});
