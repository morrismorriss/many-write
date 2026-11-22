import { describe, expect, it } from "vitest";
import { searchZotero, zoteroItemToSource, zoteroSummary, type ZoteroItem } from "./zotero";

const creator = (firstName: string, lastName: string, creatorType = "author") => ({ creatorType, firstName, lastName });

describe("Zotero items become sources", () => {
  it("maps a book with its author, publisher, place and year", () => {
    const item: ZoteroItem = {
      key: "K1",
      data: { itemType: "book", title: "Beloved", creators: [creator("Toni", "Morrison")], date: "1987", publisher: "Knopf", place: "New York" },
    };
    expect(zoteroItemToSource(item, "id1")).toEqual({
      id: "id1",
      kind: "book",
      authors: [{ first: "Toni", last: "Morrison" }],
      title: "Beloved",
      publisher: "Knopf",
      city: "New York",
      year: "1987",
    });
  });

  it("maps a journal article, using the DOI as the address when there is no URL", () => {
    const item: ZoteroItem = {
      key: "K2",
      data: {
        itemType: "journalArticle",
        title: "The Case",
        creators: [creator("Jane", "Doe")],
        date: "2020-03-01",
        publicationTitle: "The Atlantic",
        volume: "12",
        issue: "3",
        pages: "10–20",
        DOI: "10.1234/x",
      },
    };
    expect(zoteroItemToSource(item, "id2")).toMatchObject({
      kind: "article",
      title: "The Case",
      container: "The Atlantic",
      year: "2020",
      volume: "12",
      issue: "3",
      pages: "10–20",
      url: "https://doi.org/10.1234/x",
    });
  });

  it("maps a web page with readable dates", () => {
    const item: ZoteroItem = {
      key: "K3",
      data: { itemType: "webpage", title: "News", websiteTitle: "BBC News", date: "2024-05-04", url: "https://bbc.co.uk/x", accessDate: "2024-05-05T10:00:00Z" },
    };
    expect(zoteroItemToSource(item, "id3")).toMatchObject({
      kind: "website",
      title: "News",
      container: "BBC News",
      year: "2024",
      date: "4 May 2024",
      url: "https://bbc.co.uk/x",
      accessed: "5 May 2024",
    });
  });

  it("uses editors when there is no author, and single-field names", () => {
    const item: ZoteroItem = {
      key: "K4",
      data: { itemType: "book", title: "Letters", creators: [{ creatorType: "editor", name: "The Editors" }] },
    };
    expect(zoteroItemToSource(item, "id4").authors).toEqual([{ first: "", last: "The Editors" }]);
  });

  it("treats an unknown item type as a web page", () => {
    const item: ZoteroItem = { key: "K5", data: { itemType: "podcast", title: "Episode" } };
    expect(zoteroItemToSource(item, "id5").kind).toBe("website");
  });

  it("summarizes a result in one line", () => {
    const item: ZoteroItem = { key: "K6", data: { itemType: "book", title: "Beloved", creators: [creator("Toni", "Morrison")], date: "1987" } };
    expect(zoteroSummary(item)).toBe("Morrison · 1987 · Book");
  });
});

describe("the local API", () => {
  it("asks the core to search the library", async () => {
    const book: ZoteroItem = { key: "K1", data: { itemType: "book", title: "Beloved" } };
    const calls: { cmd: string; args: Record<string, unknown> }[] = [];
    const fake = async (cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return [book];
    };
    await expect(searchZotero("beloved", { request: fake })).resolves.toEqual([book]);
    expect(calls).toEqual([{ cmd: "zotero.search", args: { query: "beloved", limit: 25 } }]);
  });

  it("browses when the query is empty", async () => {
    const calls: Record<string, unknown>[] = [];
    const fake = async (_cmd: string, args: Record<string, unknown>) => {
      calls.push(args);
      return [];
    };
    await expect(searchZotero("", { request: fake })).resolves.toEqual([]);
    expect(calls[0]).toEqual({ query: "", limit: 25 });
  });

  it("reports a refused or failing answer", async () => {
    const fake = async () => {
      throw new Error("Could not reach Zotero at 127.0.0.1:23119");
    };
    await expect(searchZotero("x", { request: fake })).rejects.toThrow("Could not reach Zotero");
  });

  it("treats a non-list answer as no results", async () => {
    const fake = async () => ({ error: "no" });
    await expect(searchZotero("x", { request: fake })).resolves.toEqual([]);
  });

  it("drops notes and attachments", async () => {
    const fake = async () => [
      { key: "N", data: { itemType: "note", note: "A thought" } },
      { key: "A", data: { itemType: "attachment", title: "PDF" } },
      { key: "X", data: null },
      { key: "K", data: { itemType: "book", title: "Beloved" } },
    ];
    const items = await searchZotero("x", { request: fake });
    expect(items.map((i) => i.key)).toEqual(["K"]);
  });
});
