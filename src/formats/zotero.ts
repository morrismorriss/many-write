// Zotero 7's local API: http://localhost:23119/api/users/0.
// It answers the same JSON as the Zotero web API, with no key, as long as
// Zotero is running on this computer. The core makes the request: Zotero sends
// no CORS headers, so the webview cannot fetch it directly.

import { call } from "../lib/backend";
import type { Source, SourceAuthor, SourceKind } from "./citations";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface ZoteroCreator {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  /** Single-field names ("The Editors"). */
  name?: string;
}

export interface ZoteroItemData {
  itemType: string;
  title?: string;
  creators?: ZoteroCreator[];
  date?: string;
  accessDate?: string;
  publisher?: string;
  place?: string;
  publicationTitle?: string;
  bookTitle?: string;
  websiteTitle?: string;
  proceedingsTitle?: string;
  blogTitle?: string;
  forumTitle?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  DOI?: string;
  url?: string;
}

export interface ZoteroItem {
  key: string;
  version?: number;
  data: ZoteroItemData;
}

/** "2024-05-04" or "2024-05-04T10:00:00Z" as "4 May 2024"; anything else is left alone. */
function prettyDate(value: string | undefined): string | undefined {
  const m = (value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return value?.trim() || undefined;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : undefined;
}

function kindOf(itemType: string): SourceKind {
  if (itemType === "book" || itemType === "thesis" || itemType === "report" || itemType === "manuscript") return "book";
  if (["journalArticle", "magazineArticle", "newspaperArticle", "bookSection", "conferencePaper", "preprint"].includes(itemType)) return "article";
  return "website";
}

function authorsOf(data: ZoteroItemData): SourceAuthor[] {
  const creators = data.creators ?? [];
  const chosen = creators.some((c) => c.creatorType === "author") ? creators.filter((c) => c.creatorType === "author") : creators.filter((c) => c.creatorType === "editor");
  return chosen
    .map((c) => (c.name ? { first: "", last: c.name } : { first: c.firstName ?? "", last: c.lastName ?? "" }))
    .map((a) => ({ first: a.first.trim(), last: a.last.trim() }))
    .filter((a) => a.first || a.last);
}

/** Turn one Zotero item into a source the citation formatters understand. */
export function zoteroItemToSource(item: ZoteroItem, id: string): Source {
  const d = item.data;
  const kind = kindOf(d.itemType);
  const src: Source = { id, kind, authors: authorsOf(d), title: (d.title ?? "").trim() };
  const put = (key: keyof Source, value: string | undefined) => {
    const v = value?.replace(/\s+/g, " ").trim();
    if (v) (src as unknown as Record<string, string>)[key] = v;
  };
  const year = d.date?.match(/\b(\d{4})\b/)?.[1];
  put("container", d.publicationTitle ?? d.bookTitle ?? d.websiteTitle ?? d.proceedingsTitle ?? d.blogTitle ?? d.forumTitle);
  put("publisher", d.publisher);
  put("city", d.place);
  put("year", year);
  if (kind === "website") {
    put("date", prettyDate(d.date));
    put("accessed", prettyDate(d.accessDate));
  }
  put("volume", d.volume);
  put("issue", d.issue);
  put("pages", d.pages);
  put("url", d.url || (d.DOI ? `https://doi.org/${d.DOI}` : undefined));
  return src;
}

const KIND_NAME: Record<SourceKind, string> = { book: "Book", article: "Article", website: "Web page" };

/** One line for the result list: "Morrison · 1987 · Book". */
export function zoteroSummary(item: ZoteroItem): string {
  const src = zoteroItemToSource(item, "summary");
  const who = src.authors.map((a) => a.last || a.first).filter(Boolean).slice(0, 2).join(", ");
  return [who, src.year, KIND_NAME[src.kind]].filter(Boolean).join(" · ");
}

/**
 * Search the local library. Zotero must be running; a refused connection means
 * it is not, or its local API is switched off.
 */
export async function searchZotero(
  query: string,
  opts: { request?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>; limit?: number } = {},
): Promise<ZoteroItem[]> {
  const run = opts.request ?? ((cmd: string, args: Record<string, unknown>) => call<unknown>(cmd, args));
  const data = await run("zotero.search", { query, limit: opts.limit ?? 25 });
  if (!Array.isArray(data)) return [];
  return data.filter((x): x is ZoteroItem => {
    if (!x || typeof x !== "object" || !("data" in x)) return false;
    const d = (x as ZoteroItem).data;
    return !!d && typeof d === "object" && !["note", "attachment", "annotation"].includes(d.itemType ?? "");
  });
}
