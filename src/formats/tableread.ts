// Table read scripts: one PDF per character, with that character's lines highlighted.

import type { Block } from "./markdown";
import { blockText } from "./markdown";
import { cueName, type ManuscriptItem } from "./typst";

/** Line types that belong to the speaker of the cue above them. */
const SPEECH = new Set(["dialogue", "parenthetical", "lyric"]);

/**
 * Indices of a scene's lines spoken by `name`: their cues and the dialogue,
 * parentheticals and lyrics under them. Speakers side by side (simultaneous
 * dialogue) are followed column by column.
 */
export function linesOf(blocks: Block[], name: string): Set<number> {
  const out = new Set<number>();
  const want = name.trim().toUpperCase();
  // Who is speaking in each column; -1 is the ordinary, full-width column.
  const speaker = new Map<number, string | null>();
  blocks.forEach((b, i) => {
    const column = b.sim ?? -1;
    if (column < 0) {
      // A full-width line ends any row of speakers beside each other.
      for (const k of [...speaker.keys()]) if (k >= 0) speaker.delete(k);
    }
    if (b.type === "character") {
      const who = cueName(blockText(b));
      speaker.set(column, who || null);
      if (who && who === want) out.add(i);
    } else if (SPEECH.has(b.type)) {
      if (speaker.get(column) === want && blockText(b).trim()) out.add(i);
    } else {
      speaker.set(column, null);
    }
  });
  return out;
}

export interface CastMember {
  name: string;
  /** How many times the character speaks (cues). */
  speeches: number;
}

/** Everyone with a cue in the script, most speeches first. */
export function castOf(items: ManuscriptItem[]): CastMember[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.kind !== "doc") continue;
    for (const b of item.blocks) {
      if (b.type !== "character") continue;
      const name = cueName(blockText(b));
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([name, speeches]) => ({ name, speeches })).sort((a, b) => b.speeches - a.speeches || a.name.localeCompare(b.name));
}

/** The plays of a collection, in order. Empty for a single play or a screenplay. */
export function playsOf(items: ManuscriptItem[]): { id: string; title: string }[] {
  return items.flatMap((i) => (i.kind === "play" ? [{ id: i.id, title: i.title }] : []));
}

/**
 * Just one play of a collection: the project's own front matter, that play
 * (its title page, front matter and acts) and the back matter.
 */
export function itemsForPlay(items: ManuscriptItem[], playId: string): ManuscriptItem[] {
  const start = items.findIndex((i) => i.kind === "play" && i.id === playId);
  if (start < 0) return items;
  const firstPlay = items.findIndex((i) => i.kind === "play");
  let end = start + 1;
  while (end < items.length && items[end].kind !== "play" && !(items[end].kind === "matter" && (items[end] as { where: string }).where === "back")) end++;
  const back = items.filter((i) => i.kind === "matter" && i.where === "back");
  return [...items.slice(0, firstPlay), ...items.slice(start, end), ...back];
}

/** A file name for a character's copy: "Hamlet - OPHELIA.pdf". */
export function tableReadFileName(title: string, name: string): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").trim();
  return `${safe(title) || "Untitled"} - ${safe(name) || "Character"}.pdf`;
}

/** Highlighter colours for the printed lines. */
export const HIGHLIGHTS = [
  { id: "yellow", label: "Yellow", fill: "#fff176" },
  { id: "pink", label: "Pink", fill: "#f8bbd0" },
  { id: "green", label: "Green", fill: "#c5e1a5" },
  { id: "blue", label: "Blue", fill: "#b3e5fc" },
] as const;
