import { describe, expect, it } from "vitest";
import { contdLines, generateTypst, runsToTypst } from "./typst";
import { TEMPLATES } from "./templates";
import { toExportDoc } from "./exporters";
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
  it("runs a book chapter's sections on under one chapter heading", () => {
    const items = [
      { kind: "folder" as const, id: "ch", title: "The Storm", depth: 1, chapter: true },
      { kind: "doc" as const, id: "s1", title: "Section 1", blocks: [b("paragraph", "Rain.")], section: true },
      { kind: "doc" as const, id: "s2", title: "Section 2", blocks: [b("paragraph", "Wind.")], section: true },
      { kind: "doc" as const, id: "c2", title: "Morning", blocks: [b("paragraph", "Sun.")] },
    ];
    const src = generateTypst(TEMPLATES.book, meta, items).source;
    expect(src).toContain('#doc-start("The Storm", first: true)');
    expect(src).not.toContain("Section 1");
    expect(src).not.toContain("Section 2");
    expect(src).toContain('#doc-start("Morning", first: false)');
    expect(src).not.toContain("#folder(");
    const doc = toExportDoc(TEMPLATES.book, meta, items, "x");
    expect(doc.blocks.filter((x) => x.kind === "chapter").map((x) => x.runs[0].text)).toEqual(["The Storm", "Morning"]);
    expect(doc.blocks.some((x) => x.kind === "page_break")).toBe(false);
  });
  it("starts each page of a document on a new page, and runs screenplay, essay and article sections on", () => {
    const docs = [
      { kind: "doc" as const, id: "a", title: "One", blocks: [b("paragraph", "A.")] },
      { kind: "doc" as const, id: "b", title: "Two", blocks: [b("paragraph", "B.")] },
    ];
    expect(generateTypst(TEMPLATES.document, meta, docs).source).toContain('#doc-start("Two", first: false)');
    expect(toExportDoc(TEMPLATES.document, meta, docs, "x").blocks.filter((x) => x.kind === "page_break").length).toBe(1);
    expect(toExportDoc(TEMPLATES.poem, meta, docs, "x").blocks.filter((x) => x.kind === "page_break").length).toBe(1);
    for (const id of ["essay", "article"] as const) expect(toExportDoc(TEMPLATES[id], meta, docs, "x").blocks.some((x) => x.kind === "page_break")).toBe(false);
    const scenes = [{ kind: "folder" as const, id: "f", title: "Sequence 1", depth: 1 }, ...docs];
    const sp = toExportDoc(TEMPLATES.screenplay, { ...meta, sceneNewPage: false }, scenes, "x").blocks;
    expect(sp.some((x) => x.kind === "page_break" || x.kind === "folder_heading")).toBe(false);
    expect(generateTypst(TEMPLATES.screenplay, { ...meta, sceneNewPage: false }, docs).source).toContain("new-page: false");
  });
  it("puts a script's title page on its own page in Word, with no extra break before the first scene or play", () => {
    const docs = [
      { kind: "doc" as const, id: "a", title: "One", blocks: [b("paragraph", "A.")] },
      { kind: "doc" as const, id: "b", title: "Two", blocks: [b("paragraph", "B.")] },
    ];
    const kinds = (template: keyof typeof TEMPLATES, m: Parameters<typeof toExportDoc>[1], items: Parameters<typeof toExportDoc>[2]) =>
      toExportDoc(TEMPLATES[template], { ...m, titlePage: true, title: "T" }, items, "x").blocks.map((x) => x.kind);
    expect(kinds("screenplay", { ...meta, sceneNewPage: false }, docs).slice(0, 3)).toEqual(["title", "character", "page_break"]);
    expect(kinds("screenplay", { ...meta, sceneNewPage: false }, docs).filter((k) => k === "page_break").length).toBe(1);
    // Stage plays start each scene on a new page: one break after the title page, one between the scenes.
    expect(kinds("stage-play", { ...meta, sceneNewPage: true }, docs).filter((k) => k === "page_break").length).toBe(2);
    const play = [{ kind: "play" as const, id: "p", title: "Part One", depth: 1 }, ...docs];
    const withPlay = kinds("stage-play", { ...meta, sceneNewPage: true }, play);
    expect(withPlay.slice(0, 4)).toEqual(["title", "character", "page_break", "title"]);
  });
});
