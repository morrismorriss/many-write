import { describe, expect, it } from "vitest";
import { parseDoc, plainBlock, type Block } from "./markdown";
import { findTitlePages, titlePageParts, titlePageStarter } from "./titlepage";
import { generateTypst, type ManuscriptItem, type ProjectMeta } from "./typst";
import { toExportDoc, toFdx } from "./exporters";
import { TEMPLATES } from "./templates";

const b = (type: string, text: string): Block => plainBlock(type as Block["type"], text);
const meta: ProjectMeta = { title: "Soup", subtitle: "A comedy", author: "Ann Writer", contact: "ann@example.com\n555 1234", titlePage: true, paper: "us-letter" };
const page = (id: string, blocks: Block[]): ManuscriptItem => ({ kind: "matter", id, title: "Title page", blocks, where: "front" });
const scene: ManuscriptItem = { kind: "doc", id: "s", title: "S", blocks: [b("character", "ANNA"), b("dialogue", "Hi.")] };

describe("typed title pages", () => {
  it("starts as the automatic page, written out", () => {
    const blocks = parseDoc(titlePageStarter(meta), "prose", false, true).blocks;
    const { middle, bottom } = titlePageParts(blocks);
    expect(middle.filter((x) => x.block.runs.length).map((x) => x.block.runs.map((r) => r.text).join(""))).toEqual(["SOUP", "A comedy", "by", "Ann Writer"]);
    expect(middle[0].block.runs[0].bold).toBe(true);
    expect(bottom.map((x) => x.block.runs.map((r) => r.text).join(""))).toEqual(["ann@example.com", "555 1234"]);
  });

  it("puts the left lines after the last centred one at the bottom", () => {
    const { middle, bottom } = titlePageParts([b("paragraph", ""), b("centered", "SOUP"), b("paragraph", ""), b("centered", "by me"), b("paragraph", ""), b("paragraph", "Agent: X"), b("paragraph", "")]);
    expect(middle.map((x) => x.index)).toEqual([1, 2, 3]);
    expect(bottom.map((x) => x.index)).toEqual([5]);
  });

  it("finds the project's and each play's, ignoring empty ones", () => {
    const items: ManuscriptItem[] = [page("tp", [b("centered", "ALL")]), { kind: "play", id: "p1", title: "One" }, page("e", []), scene, { kind: "play", id: "p2", title: "Two" }, page("tp2", [b("centered", "TWO")])];
    const found = findTitlePages(items);
    expect(found.project?.id).toBe("tp");
    expect([...found.plays.keys()]).toEqual(["p2"]);
  });

  it("replaces the automatic title page in the PDF", () => {
    const items = [page("tp", [b("centered", "MY SOUP"), b("paragraph", "Agent")]), scene];
    const g = generateTypst(TEMPLATES["stage-play"], meta, items);
    expect(g.source).toContain("title-page: false");
    expect(g.source).toContain('#mw-title-page([#mw-tp-line[#"MY SOUP"]], [#mw-tp-line[#"Agent"]], first: true, play: false)');
    expect(g.source).not.toContain("matter-start");
    expect(g.elements.some((e) => e.id === "tp#0")).toBe(true);
  });

  it("is left out with the title page turned off", () => {
    const g = generateTypst(TEMPLATES["stage-play"], { ...meta, titlePage: false }, [page("tp", [b("centered", "MY SOUP")]), scene]);
    expect(g.source).not.toContain("MY SOUP");
  });

  it("replaces a collection play's title page", () => {
    const items: ManuscriptItem[] = [{ kind: "play", id: "p1", title: "One" }, page("tp1", [b("centered", "PLAY ONE, TYPED")]), scene];
    const g = generateTypst(TEMPLATES["stage-play"], meta, items);
    expect(g.source).not.toContain("#mw-play(");
    expect(g.source).toContain("play: true");
  });

  it("goes into Word and Final Draft exports", () => {
    const items = [page("tp", [b("centered", "MY SOUP"), b("centered", "by Ann"), b("paragraph", "Agent")]), scene];
    const doc = toExportDoc(TEMPLATES["stage-play"], meta, items, "x");
    expect(doc.blocks.slice(0, 4).map((x) => x.kind)).toEqual(["title", "centered", "matter_paragraph", "page_break"]);
    expect(doc.blocks.some((x) => x.kind === "matter_title")).toBe(false);
    const fdx = toFdx(meta, items);
    expect(fdx).toContain('<Paragraph Alignment="Center" Type="Title Page"><Text>MY SOUP</Text></Paragraph>');
    expect(fdx).toContain('<Paragraph Alignment="Left" Type="Title Page"><Text>Agent</Text></Paragraph>');
  });
});
