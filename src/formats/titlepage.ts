// A title page the writer types: a front matter page called "Title page".
// It replaces the automatic title page (the project's, or a collection play's).
// Centred lines sit in the middle of the page; the left-aligned lines after the
// last centred one sit at the bottom left, for contact details.

import type { Block } from "./markdown";
import { blockText, BLANK_LINE } from "./markdown";
import { essayDate, type ManuscriptItem, type ProjectMeta } from "./typst";
import type { TemplateId } from "./templates";

export const TITLE_PAGE = "Title page";

export type MatterItem = Extract<ManuscriptItem, { kind: "matter" }>;

export const isTitlePageName = (title: string) => title.trim().toLowerCase() === TITLE_PAGE.toLowerCase();

export const isTitlePage = (item: ManuscriptItem): item is MatterItem => item.kind === "matter" && item.where === "front" && isTitlePageName(item.title);

/**
 * Where typed title pages are: the project's own (front matter before the
 * first play) and each play's (in the front matter that follows it).
 * `project` is undefined when there is none; plays without one are absent.
 */
export function findTitlePages(items: ManuscriptItem[]): { project?: MatterItem; plays: Map<string, MatterItem> } {
  let project: MatterItem | undefined;
  const plays = new Map<string, MatterItem>();
  let play: string | null = null;
  for (const item of items) {
    if (item.kind === "play") play = item.id;
    if (item.kind !== "matter") continue;
    if (!isTitlePage(item) || !blockText({ type: "paragraph", runs: item.blocks.flatMap((b) => b.runs) }).trim()) continue;
    if (play === null) project ??= item;
    else if (!plays.has(play)) plays.set(play, item);
  }
  return { project, plays };
}

/** The page split into its middle (centred) part and its bottom-left part. Leading and trailing empty lines are dropped. */
export function titlePageParts(blocks: Block[]): { middle: { block: Block; index: number }[]; bottom: { block: Block; index: number }[] } {
  const all = blocks.map((block, index) => ({ block, index })).filter(({ block }) => block.type !== "image");
  let lastCentered = -1;
  all.forEach(({ block }, i) => {
    if (block.type === "centered") lastCentered = i;
  });
  const trim = (xs: typeof all) => {
    let s = 0;
    let e = xs.length;
    while (s < e && !blockText(xs[s].block).trim()) s++;
    while (e > s && !blockText(xs[e - 1].block).trim()) e--;
    return xs.slice(s, e);
  };
  // No centred lines at all: everything is the middle, centred.
  if (lastCentered < 0) return { middle: trim(all), bottom: [] };
  return { middle: trim(all.slice(0, lastCentered + 1)), bottom: trim(all.slice(lastCentered + 1)) };
}

const md = (s: string) => s.replace(/([\\*_])/g, "\\$1");

/**
 * What a new title page starts with: the automatic one, written out so it can
 * be changed. Scripts get the industry layout (title, "by", author, contact at
 * the bottom left); a book its title, subtitle and author; an essay its title
 * and the student's details; anything else title, subtitle and author.
 */
export function titlePageStarter(meta: Pick<ProjectMeta, "title" | "subtitle" | "author" | "contact" | "essay">, kind: TemplateId = "stage-play", title?: string): string {
  const centred = (s: string) => `-> ${s} <-`;
  const name = title || meta.title || "Untitled";
  const subtitle = !title && meta.subtitle?.trim() ? md(meta.subtitle.trim()) : "";
  const author = meta.author?.trim() ? md(meta.author.trim()) : "";
  const lines: string[] = [];
  if (kind === "stage-play" || kind === "screenplay") {
    lines.push(centred(`**${md(name.toUpperCase())}**`));
    if (subtitle) lines.push(BLANK_LINE, centred(subtitle));
    if (author) lines.push(BLANK_LINE, BLANK_LINE, centred("by"), BLANK_LINE, centred(author));
    lines.push(...(meta.contact ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map(md));
  } else if (kind === "essay") {
    const e = meta.essay;
    lines.push(centred(md(name + (subtitle ? `: ${meta.subtitle!.trim()}` : ""))));
    const details = [author, md(e?.course ?? ""), md(e?.instructor ?? ""), md(e?.date?.trim() || (e ? essayDate(e.style) : ""))].filter((l) => l.trim());
    if (details.length) lines.push(BLANK_LINE, BLANK_LINE, BLANK_LINE, ...details.map(centred));
  } else {
    lines.push(centred(`**${md(name)}**`));
    if (subtitle) lines.push(BLANK_LINE, centred(`*${subtitle}*`));
    if (author) lines.push(BLANK_LINE, BLANK_LINE, centred(kind === "book" ? author : `by ${author}`));
  }
  return lines.join("\n\n") + "\n";
}
