import { describe, expect, it } from "vitest";
import { contdLines, generateTypst, runsToTypst } from "./typst";
import { TEMPLATES } from "./templates";
import type { Block } from "./markdown";

const b = (type: Block["type"], text: string): Block => ({ type, runs: text ? [{ text }] : [] });
const meta = { title: "T", author: "A", contact: "", titlePage: false, paper: "us-letter" as const };

describe("(CONT'D)", () => {
  it("marks a cue repeated after a direction, not one after another speaker or with its own extension", () => {
    const blocks = [
      b("character", "ANNA"),
      b("dialogue", "Hi."),
      b("direction", "She sits."),
      b("character", "ANNA"),
      b("dialogue", "Well."),
      b("character", "BEN"),
      b("dialogue", "Yes."),
      b("character", "ANNA"),
      b("dialogue", "No."),
      b("direction", "Pause."),
      b("character", "ANNA (V.O.)"),
      b("dialogue", "Later."),
    ];
    expect([...contdLines(blocks)]).toEqual([3]);
  });
  it("starts over at a scene heading", () => {
    expect(contdLines([b("character", "ANNA"), b("dialogue", "Hi."), b("scene_heading", "Two"), b("character", "ANNA")]).size).toBe(0);
  });
});

describe("generated Typst", () => {
  it("links web addresses", () => {
    expect(runsToTypst([{ text: "See www.example.com." }])).toBe('#"See "#link("https://www.example.com")[#"www.example.com"]#"."');
  });
  it("starts each scene on a new page, except straight after an act heading", () => {
    const items = [
      { kind: "folder" as const, id: "a", title: "Act One", depth: 1 },
      { kind: "doc" as const, id: "s1", title: "Scene 1", blocks: [b("scene_heading", "One")] },
      { kind: "doc" as const, id: "s2", title: "Scene 2", blocks: [b("scene_heading", "Two")] },
    ];
    const src = generateTypst(TEMPLATES["stage-play"], { ...meta, sceneNewPage: true }, items).source;
    expect(src).toContain('#doc-start("Scene 1", first: true, new-page: true)');
    expect(src).toContain('#doc-start("Scene 2", first: false, new-page: true)');
  });
  it("prints a blank line for an empty paragraph between paragraphs", () => {
    const items = [{ kind: "doc" as const, id: "c", title: "Chapter", blocks: [b("paragraph", "One."), b("paragraph", ""), b("paragraph", "Two."), b("paragraph", "")] }];
    const src = generateTypst(TEMPLATES.book, meta, items).source;
    expect(src.match(/#hide\("x"\)/g)?.length).toBe(1);
  });
  it("gives each play of a collection its own title page", () => {
    const items = [
      { kind: "play" as const, id: "p", title: "The Crossing" },
      { kind: "matter" as const, id: "m", title: "Cast of characters", blocks: [b("paragraph", "MARA")], where: "front" as const },
      { kind: "folder" as const, id: "a", title: "Act One", depth: 2 },
      { kind: "doc" as const, id: "s", title: "Scene 1", blocks: [b("scene_heading", "One")] },
    ];
    const src = generateTypst(TEMPLATES["stage-play"], { ...meta, sceneNewPage: true }, items).source;
    expect(src).toContain('#mw-play("The Crossing", "A", first: true)');
    expect(src.indexOf("#mw-body-start()")).toBeGreaterThan(src.indexOf("#matter-start"));
  });
});
