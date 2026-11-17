import { describe, expect, it } from "vitest";
import { cleanSource, inTextCitation, referenceEntry, sameSource, sortKey, type Source } from "./citations";
import type { Run } from "./markdown";

const md = (runs: Run[]) => runs.map((r) => (r.italic ? `*${r.text}*` : r.text)).join("");
const book: Source = { id: "1", kind: "book", authors: [{ first: "Toni", last: "Morrison" }], title: "Beloved", publisher: "Knopf", city: "New York", year: "1987" };
const article: Source = {
  id: "2",
  kind: "article",
  authors: [
    { first: "Ann", last: "Lee" },
    { first: "Bo", last: "Kim" },
  ],
  title: "Reading Slowly",
  container: "Journal of Reading",
  volume: "12",
  issue: "3",
  year: "2020",
  pages: "10–20",
};
const web: Source = { id: "3", kind: "website", authors: [], title: "How Tides Work", container: "Ocean Facts", date: "4 May 2024", year: "2024", url: "https://www.example.com/tides" };

describe("MLA", () => {
  it("formats books, articles and web pages", () => {
    expect(md(referenceEntry(book, "mla"))).toBe("Morrison, Toni. *Beloved*. Knopf, 1987.");
    expect(md(referenceEntry(article, "mla"))).toBe("Lee, Ann, and Bo Kim. “Reading Slowly.” *Journal of Reading*, vol. 12, no. 3, 2020, pp. 10–20.");
    expect(md(referenceEntry(web, "mla"))).toBe("“How Tides Work.” *Ocean Facts*, 4 May 2024, www.example.com/tides.");
  });
  it("cites author and page in the text", () => {
    expect(md(inTextCitation(book, "mla", "23").runs)).toBe("(Morrison 23)");
    expect(md(inTextCitation(article, "mla").runs)).toBe("(Lee and Kim)");
    expect(md(inTextCitation(web, "mla").runs)).toBe("(“How Tides Work”)");
    expect(md(inTextCitation({ ...book, authors: [...article.authors, { first: "C", last: "Day" }] }, "mla").runs)).toBe("(Lee et al.)");
  });
  it("puts the cursor before the closing bracket when no page is given", () => {
    const c = inTextCitation(book, "mla");
    expect(md(c.runs).slice(0, c.caret)).toBe("(Morrison");
  });
});

describe("Chicago author–date", () => {
  it("puts the year after the author", () => {
    expect(md(referenceEntry(book, "chicago"))).toBe("Morrison, Toni. 1987. *Beloved*. New York: Knopf.");
    expect(md(referenceEntry(article, "chicago"))).toBe("Lee, Ann, and Bo Kim. 2020. “Reading Slowly.” *Journal of Reading* 12 (3): 10–20.");
    expect(md(inTextCitation(book, "chicago", "23").runs)).toBe("(Morrison 1987, 23)");
  });
});

describe("sources", () => {
  it("sorts without quotation marks or articles", () => {
    expect(sortKey("“The Tides.”")).toBe("tides.”");
  });
  it("recognises the same work", () => {
    expect(sameSource(book, { ...book, id: "9", year: "1988" })).toBe(true);
    expect(sameSource(book, article)).toBe(false);
  });
  it("drops sources with the wrong shape from project.json", () => {
    expect(cleanSource({ id: "x", kind: "poster", title: "T" })).toBeNull();
    expect(cleanSource({ id: "x", kind: "book", title: 4, authors: [{ first: 1, last: "A" }] })).toEqual({ id: "x", kind: "book", title: "", authors: [{ first: "", last: "A" }] });
  });
});
