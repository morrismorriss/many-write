import { describe, expect, it } from "vitest";
import { parseDoc, plainBlock, serializeDoc, type Block, type Run } from "./markdown";
import { columnsOf, findTitlePages, stackColumns, titlePageParts, titlePageStarter } from "./titlepage";
import { generateTypst, type ManuscriptItem, type ProjectMeta } from "./typst";
import { fountainTitlePage, toExportDoc, toFdx, toFountain } from "./exporters";
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
    expect(g.source).toContain('#import "/mw/titlepage.typ"');
    expect(g.source).toContain('cover: mw-title-page([#mw-tp-line[#"MY SOUP"]], [#mw-tp-line[#"Agent"]], first: true, play: false))');
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
    expect(doc.blocks.slice(0, 4).map((x) => x.kind)).toEqual(["title_page_middle", "title_page_middle", "title_page_bottom", "page_break"]);
    expect(doc.blocks.some((x) => x.kind === "matter_title")).toBe(false);
    const fdx = toFdx(meta, items);
    expect(fdx).toContain('<Paragraph Alignment="Center" Type="Title Page"><Text>MY SOUP</Text></Paragraph>');
    expect(fdx).toContain('<Paragraph Alignment="Left" Type="Title Page"><Text>Agent</Text></Paragraph>');
  });

  it("works in every format", () => {
    for (const id of ["book", "poem", "article", "document", "essay"] as const) {
      const items: ManuscriptItem[] = [page("tp", [b("centered", "COVER")]), { kind: "doc", id: "d", title: "D", blocks: [b(id === "poem" ? "line" : "paragraph", "Text.")] }];
      const g = generateTypst(TEMPLATES[id], { ...meta, essay: { style: "mla", instructor: "", course: "", date: "" } }, items);
      expect(g.source, id).toContain("cover: mw-title-page(");
      const doc = toExportDoc(TEMPLATES[id], { ...meta, essay: { style: "mla", instructor: "", course: "", date: "" } }, items, "x");
      expect(doc.blocks[0].kind, id).toBe("title_page_middle");
    }
  });

  it("replaces Chicago's title page but keeps MLA's heading block", () => {
    const items: ManuscriptItem[] = [page("tp", [b("centered", "COVER")])];
    const chicago = toExportDoc(TEMPLATES.essay, { ...meta, essay: { style: "chicago-notes", instructor: "", course: "", date: "1 May" } }, items, "x");
    expect(chicago.blocks.some((x) => x.kind.startsWith("essay_cover"))).toBe(false);
    const mla = toExportDoc(TEMPLATES.essay, { ...meta, essay: { style: "mla", instructor: "", course: "", date: "1 May" } }, items, "x");
    expect(mla.blocks.some((x) => x.kind === "essay_heading")).toBe(true);
  });

  it("starts each format with its own kind of title page", () => {
    expect(titlePageStarter(meta, "book")).toBe("-> **Soup** <-\n\n&nbsp;\n\n-> *A comedy* <-\n\n&nbsp;\n\n&nbsp;\n\n-> Ann Writer <-\n");
    expect(titlePageStarter({ ...meta, essay: { style: "mla", instructor: "Prof. X", course: "", date: "1 May" } }, "essay")).toContain("-> Prof. X <-");
  });

  it("maps onto Fountain's title page keys", () => {
    expect(fountainTitlePage([b("centered", "SOUP"), b("centered", "by"), b("centered", "Ann"), b("centered", "Based on a story"), b("paragraph", "ann@x.com"), b("paragraph", "555")])).toEqual([
      "Title: SOUP",
      "Credit: by",
      "Author: Ann",
      "Source: Based on a story",
      "Contact:",
      "    ann@x.com",
      "    555",
    ]);
    expect(toFountain(TEMPLATES.screenplay, meta, [page("tp", [b("centered", "MINE")]), scene])).toMatch(/^Title: MINE\n\n/);
  });

  describe("columns", () => {
    const credits = [b("centered", "Book by\tMusic by\tLyrics by"), b("centered", "Ann\tBen\tCy"), b("centered", "Directed by Dee")];

    it("splits a line at its tabs, keeping bold and italics", () => {
      const runs: Run[] = [{ text: "Book by\t", italic: true }, { text: "Music", bold: true }, { text: " by" }];
      expect(columnsOf(runs)).toEqual([[{ text: "Book by", italic: true }], [{ text: "Music", bold: true }, { text: " by" }]]);
    });

    it("keeps tabs when the page is saved and opened again", () => {
      const doc = { blocks: [...credits, b("paragraph", "ann@x.com\tAgent: Dee Rep")] };
      const again = parseDoc(serializeDoc(doc as never, "prose"), "prose", false, true).blocks;
      expect(again.map((x) => x.runs.map((r) => r.text).join(""))).toEqual(["Book by\tMusic by\tLyrics by", "Ann\tBen\tCy", "Directed by Dee", "ann@x.com\tAgent: Dee Rep"]);
      expect(again.map((x) => x.type)).toEqual(["centered", "centered", "centered", "paragraph"]);
    });

    it("typesets columns side by side, and left and right at the bottom", () => {
      const g = generateTypst(TEMPLATES["stage-play"], meta, [page("tp", [...credits, b("paragraph", "ann@x.com\tAgent")]), scene]);
      expect(g.source).toContain('#mw-tp-cols([#"Book by"], [#"Music by"], [#"Lyrics by"])');
      expect(g.source).toContain('#mw-tp-cols([#"ann@x.com"], [#"Agent"], bottom: true)');
    });

    it("reads down each column where a format has none", () => {
      const lines = stackColumns(credits.map((x) => x.runs), false).map((r) => r.map((x) => x.text).join(""));
      expect(lines).toEqual(["Book by", "Ann", "Music by", "Ben", "Lyrics by", "Cy", "Directed by Dee"]);
      const fdx = toFdx(meta, [page("tp", [...credits, b("paragraph", "ann@x.com\tAgent")]), scene]);
      expect(fdx.indexOf("<Text>Book by</Text>")).toBeLessThan(fdx.indexOf("<Text>Ann</Text>"));
      expect(fdx.indexOf("<Text>Ann</Text>")).toBeLessThan(fdx.indexOf("<Text>Music by</Text>"));
      expect(fountainTitlePage([...credits, b("paragraph", "ann@x.com\tAgent")])).toContain("    Agent");
    });

    it("goes to Word and EPUB with its tabs", () => {
      const doc = toExportDoc(TEMPLATES["stage-play"], meta, [page("tp", credits), scene], "x");
      expect(doc.blocks[0]).toEqual({ kind: "title_page_middle", runs: [{ text: "Book by\tMusic by\tLyrics by" }] });
    });
  });
});
