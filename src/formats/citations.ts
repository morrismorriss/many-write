// Citations: a source is entered once, then cited anywhere with "/cite".
// MLA 9 uses author–page references and a Works Cited list; Chicago uses its
// author–date system (17th edition): "(Surname 2020, 23)" and a bibliography
// with the year after the author. The formatting covers the common kinds of
// source; anything unusual can be edited by hand on the sources page.

import type { Run } from "./markdown";

export type CitationStyle = "mla" | "chicago";
/** Chicago notes–bibliography: a superscript marker and a note, not an in-text citation. */
export type NoteStyle = "chicago-notes";
export type ReferenceStyle = CitationStyle | NoteStyle;
export type SourceKind = "book" | "article" | "website";

export interface SourceAuthor {
  first: string;
  last: string;
}

export interface Source {
  id: string;
  kind: SourceKind;
  authors: SourceAuthor[];
  title: string;
  /** A journal, magazine or newspaper (articles), or the website's name. */
  container?: string;
  publisher?: string;
  /** Chicago books: the place of publication. */
  city?: string;
  year?: string;
  /** Websites: the publication date as it should print ("4 May 2024"). */
  date?: string;
  volume?: string;
  issue?: string;
  /** Articles: the page range, e.g. "10–20". */
  pages?: string;
  url?: string;
  /** Websites: when you read it. */
  accessed?: string;
}

export const SOURCE_KINDS: { id: SourceKind; name: string }[] = [
  { id: "book", name: "Book" },
  { id: "article", name: "Article" },
  { id: "website", name: "Web page" },
];

/** The title of the sources page each style calls for. */
export function sourcesPageTitle(style: ReferenceStyle): string {
  return style === "mla" ? "Works Cited" : "Bibliography";
}

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
/** Add a full stop unless the text already ends with punctuation. */
const stop = (s: string) => (/[.?!]["”’]?$/.test(s) ? s : `${s}.`);
/** A quoted title for Chicago notes: the comma or full stop sits inside the closing quote. */
const noteTitle = (title: string, end: "," | ".") => {
  const t = clean(title).replace(/[.,;:]+$/, "");
  return /[?!]$/.test(t) ? `“${t}”` : `“${t}${end}”`;
};
const authorsOf = (s: Source) => s.authors.map((a) => ({ first: clean(a.first), last: clean(a.last) })).filter((a) => a.first || a.last);
const full = (a: SourceAuthor) => [a.first, a.last].filter(Boolean).join(" ");
const inverted = (a: SourceAuthor) => (a.last && a.first ? `${a.last}, ${a.first}` : a.last || a.first);

/** The author part of an entry, without its closing full stop. */
function authorList(s: Source, style: ReferenceStyle): string {
  const as = authorsOf(s);
  if (!as.length) return "";
  if (as.length === 1) return inverted(as[0]);
  if (as.length === 2) return `${inverted(as[0])}, and ${full(as[1])}`;
  if (style === "mla") return `${inverted(as[0])}, et al`;
  return `${inverted(as[0])}, ${as.slice(1, -1).map(full).join(", ")}, and ${full(as[as.length - 1])}`;
}

/** Lets entries be written as a list of plain and italic pieces. */
class Builder {
  runs: Run[] = [];
  text(t: string) {
    if (!t) return this;
    const last = this.runs[this.runs.length - 1];
    if (last && !last.italic) last.text += t;
    else this.runs.push({ text: t });
    return this;
  }
  italic(t: string) {
    if (t) this.runs.push({ text: t, italic: true });
    return this;
  }
}

function webAddress(url: string): string {
  // MLA leaves off http:// and https://.
  return url.replace(/^https?:\/\//i, "");
}

/** Clean every string field, so a source read from a file formats predictably. */
function normalizeSource(src: Source): Source {
  return Object.fromEntries(Object.entries(src).map(([k, v]) => [k, typeof v === "string" ? clean(v) : v])) as Source;
}

/** The full entry for the Works Cited or Bibliography page. */
export function referenceEntry(src: Source, style: ReferenceStyle): Run[] {
  const s = normalizeSource(src);
  const b = new Builder();
  const who = authorList(s, style);
  const title = s.title || "Untitled";
  if (style === "mla") {
    if (who) b.text(`${stop(who)} `);
    if (s.kind === "book") {
      b.italic(title).text(". ");
      const tail = [s.publisher, s.year].filter(Boolean).join(", ");
      if (tail) b.text(`${tail}.`);
    } else {
      b.text(`“${stop(title)}” `);
      const parts: string[] = [];
      if (s.container) {
        b.italic(s.container);
        if (s.kind === "article") {
          if (s.volume) parts.push(`vol. ${s.volume}`);
          if (s.issue) parts.push(`no. ${s.issue}`);
          if (s.year) parts.push(s.year);
          if (s.pages) parts.push(`${/[-–]/.test(s.pages) ? "pp." : "p."} ${s.pages}`);
        } else {
          if (s.publisher && s.publisher !== s.container) parts.push(s.publisher);
          if (s.date || s.year) parts.push(s.date || s.year!);
        }
        if (s.url) parts.push(webAddress(s.url));
        b.text(parts.length ? `, ${parts.join(", ")}.` : ".");
      } else {
        if (s.date || s.year) parts.push(s.date || s.year!);
        if (s.url) parts.push(webAddress(s.url));
        if (parts.length) b.text(`${parts.join(", ")}.`);
      }
      if (s.kind === "website" && s.accessed) b.text(` Accessed ${stop(s.accessed)}`);
    }
  } else if (style === "chicago-notes") {
    // Notes–bibliography: the year moves to the end of the entry.
    if (who) b.text(`${stop(who)} `);
    if (s.kind === "book") {
      b.italic(title.replace(/[.,;:]+$/, "")).text(". ");
      const pub = [s.city, s.publisher].filter(Boolean).join(": ");
      const tail = [pub, s.year].filter(Boolean).join(", ");
      if (tail) b.text(stop(tail));
    } else if (s.kind === "article") {
      b.text(`${noteTitle(title, ".")} `);
      if (s.container) b.italic(s.container);
      let tail = "";
      if (s.volume) tail += ` ${s.volume}`;
      if (s.issue) tail += `, no. ${s.issue}`;
      if (s.year) tail += ` (${s.year})`;
      if (s.pages) tail += `: ${s.pages}`;
      if (tail) b.text(`${tail}.`);
      if (s.url) b.text(` ${stop(s.url)}`);
    } else {
      b.text(`${noteTitle(title, ".")} `);
      if (s.container) b.text(`${stop(s.container)} `);
      if (s.date) b.text(`${stop(s.date)} `);
      else if (s.year) b.text(`${s.year}. `);
      if (s.url) b.text(stop(s.url));
      if (s.accessed) b.text(` Accessed ${stop(s.accessed)}`);
    }
  } else {
    // Chicago author–date: the year follows the author.
    const year = s.year || (s.kind === "website" ? "n.d." : "");
    if (who) b.text(`${stop(who)} ${year ? `${year}. ` : ""}`);
    if (s.kind === "book") {
      b.italic(title).text(". ");
      if (!who && year) b.text(`${year}. `);
      const pub = [s.city, s.publisher].filter(Boolean).join(": ");
      if (pub) b.text(`${pub}.`);
    } else {
      b.text(`“${stop(title)}” `);
      if (!who && year) b.text(`${year}. `);
      if (s.kind === "article") {
        if (s.container) b.italic(s.container);
        let tail = "";
        if (s.volume) tail += ` ${s.volume}`;
        if (s.issue) tail += ` (${s.issue})`;
        if (s.pages) tail += `: ${s.pages}`;
        if (s.container || tail) b.text(`${tail}.`);
      } else {
        if (s.container) b.text(`${stop(s.container)} `);
        if (s.date) b.text(`${stop(s.date)} `);
        else if (s.accessed) b.text(`Accessed ${stop(s.accessed)} `);
      }
      if (s.url) b.text(` ${stop(s.url)}`);
    }
  }
  const runs = b.runs.map((r) => ({ ...r, text: r.text.replace(/\s{2,}/g, " ") }));
  if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
  return runs.filter((r) => r.text);
}

/** Authors as they appear in a note, in natural order: "Ann Lee and Bo Kim". */
function noteAuthors(s: Source): string {
  const as = authorsOf(s);
  if (!as.length) return "";
  if (as.length === 1) return full(as[0]);
  if (as.length === 2) return `${full(as[0])} and ${full(as[1])}`;
  return `${as.slice(0, -1).map(full).join(", ")}, and ${full(as[as.length - 1])}`;
}

/**
 * The text of a Chicago notes–bibliography note, without its number (the
 * renderer adds "1. "). A page number goes after the publication details:
 * `Toni Morrison, *Beloved* (New York: Knopf, 1987), 23.`
 */
export function noteEntry(src: Source, page = ""): Run[] {
  const s = normalizeSource(src);
  const b = new Builder();
  const who = noteAuthors(s);
  const p = clean(page);
  const title = (s.title || "Untitled").replace(/[.,;:]+$/, "");
  if (who) b.text(`${who}, `);
  if (s.kind === "book") {
    b.italic(title);
    const pub = [s.city, s.publisher].filter(Boolean).join(": ");
    const tail = [pub, s.year].filter(Boolean).join(", ");
    if (tail) b.text(` (${tail})`);
    if (p) b.text(`, ${p}`);
    b.text(".");
  } else if (s.kind === "article") {
    let tail = "";
    if (s.volume) tail += ` ${s.volume}`;
    if (s.issue) tail += `, no. ${s.issue}`;
    if (s.year) tail += ` (${s.year})`;
    const cited = p || s.pages;
    if (cited) tail += `: ${cited}`;
    b.text(`${noteTitle(title, tail ? "," : ".")} `);
    if (s.container) b.italic(s.container);
    if (tail) b.text(`${tail}.`);
    if (s.url) b.text(` ${stop(s.url)}`);
  } else {
    const tail: string[] = [];
    if (s.container) tail.push(clean(s.container));
    if (s.date || s.year) tail.push((s.date || s.year)!);
    if (s.accessed) tail.push(`accessed ${clean(s.accessed)}`);
    if (s.url) tail.push(s.url);
    b.text(noteTitle(title, tail.length ? "," : "."));
    if (tail.length) b.text(` ${tail.join(", ")}.`);
  }
  const runs = b.runs.map((r) => ({ ...r, text: r.text.replace(/\s{2,}/g, " ") }));
  if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
  return runs.filter((r) => r.text);
}

/** The part of an in-text citation that names the source: "Smith", "Smith and Jones", "Smith et al." or a short title. */
function citedName(s: Source): Run[] {
  const as = authorsOf(s).map((a) => a.last || a.first);
  if (as.length === 1) return [{ text: as[0] }];
  if (as.length === 2) return [{ text: `${as[0]} and ${as[1]}` }];
  if (as.length > 2) return [{ text: `${as[0]} et al.` }];
  // No author: a shortened title, italic for a book, in quotation marks otherwise.
  const short = clean(s.title).split(" ").slice(0, 4).join(" ") || "Untitled";
  return s.kind === "book" ? [{ text: short, italic: true }] : [{ text: `“${short}”` }];
}

/**
 * The in-text citation: MLA "(Smith 23)", Chicago "(Smith 2020, 23)".
 * `caret` is where the cursor goes when no page was given, so the page can be typed straight in.
 */
export function inTextCitation(src: Source, style: CitationStyle, page = ""): { runs: Run[]; caret: number } {
  const p = clean(page);
  const runs: Run[] = [{ text: "(" }, ...citedName(src)];
  if (style === "chicago") {
    const year = clean(src.year) || "n.d.";
    runs.push({ text: ` ${year}${p ? `, ${p}` : ""}` });
  } else if (p) {
    runs.push({ text: ` ${p}` });
  }
  runs.push({ text: ")" });
  const len = runs.reduce((n, r) => n + r.text.length, 0);
  return { runs, caret: len - 1 };
}

/** A short label for the slash menu: "Smith — The Book". */
export function sourceLabel(s: Source): string {
  const who = authorsOf(s)[0];
  const t = clean(s.title) || "Untitled";
  const short = t.length > 40 ? `${t.slice(0, 38)}…` : t;
  return who ? `${who.last || who.first}${authorsOf(s).length > 1 ? " et al." : ""} — ${short}` : short;
}

/** Does a search typed after "/" pick out this source? */
export function sourceMatches(s: Source, q: string): boolean {
  if (!q) return true;
  const hay = [s.title, s.container, ...s.authors.flatMap((a) => [a.first, a.last])].join(" ").toLowerCase();
  return hay.includes(q.toLowerCase());
}

/** The key entries are sorted by: no quotation marks, and an initial "A", "An" or "The" ignored. */
export function sortKey(text: string): string {
  return text
    .replace(/^[\s“”"‘’'*_(]+/, "")
    .replace(/^(the|an|a)\s+/i, "")
    .toLowerCase();
}

/** Two sources are the same work when their kind, title and authors match. */
export function sameSource(a: Source, b: Source): boolean {
  const key = (s: Source) => [s.kind, clean(s.title).toLowerCase(), ...authorsOf(s).map((x) => `${x.last}|${x.first}`.toLowerCase())].join("§");
  return key(a) === key(b);
}

const FIELDS: (keyof Source)[] = ["title", "container", "publisher", "city", "year", "date", "volume", "issue", "pages", "url", "accessed"];

/** Keep a source read from project.json only if it has the right shape. */
export function cleanSource(v: unknown): Source | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !SOURCE_KINDS.some((k) => k.id === o.kind)) return null;
  const out: Source = { id: o.id.slice(0, 64), kind: o.kind as SourceKind, authors: [], title: "" };
  if (Array.isArray(o.authors)) {
    for (const a of o.authors.slice(0, 12)) {
      if (a && typeof a === "object") {
        const x = a as Record<string, unknown>;
        out.authors.push({ first: typeof x.first === "string" ? x.first.slice(0, 200) : "", last: typeof x.last === "string" ? x.last.slice(0, 200) : "" });
      }
    }
  }
  for (const f of FIELDS) if (typeof o[f] === "string") (out as unknown as Record<string, string>)[f] = (o[f] as string).slice(0, 2000);
  out.title ??= "";
  return out;
}
