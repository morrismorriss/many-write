// Reading and writing documents as plain markdown.
//
// Script formats (stage play, screenplay) follow a Fountain-style convention so
// files stay readable in any text editor or Obsidian. See docs/FILE-FORMAT.md.
//
//   ## Scene 2                    scene heading (any markdown heading)
//
//   ANNA                          character cue: a line in capitals with
//   (quietly)                     parenthetical in brackets, directly under it
//   I told you already.           dialogue: lines directly under the cue
//
//   She crosses to the window.    stage direction / action: any other paragraph
//
//   > BLACKOUT.                   transition: starts with ">"
//
//   @McCoy                        forced character cue (mixed case or no dialogue)
//   !NOBODY MOVES.                forced direction (would otherwise look like a cue)

import { listNumbers, MAX_INDENT, type ElementType, type FileMode } from "./templates";

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** A footnote/endnote reference: the id of the note it points to. `text` is empty. */
  note?: string;
}

export interface Block {
  type: ElementType;
  runs: Run[];
  /** Images: path of the file, relative to the project folder. Runs hold the caption. */
  src?: string;
  /** List items: how many levels it is nested under the item above (0 or absent = not nested). */
  indent?: number;
}

/** A footnote or endnote definition, written as `[^1]: text` at the end of a file. */
export interface Note {
  /** The label as read from the file, or generated for a new note. */
  id: string;
  runs: Run[];
}

export interface ParsedDoc {
  blocks: Block[];
  /** YAML front matter (including the --- fences), preserved untouched. */
  frontMatter: string | null;
  /** Footnote/endnote definitions, in the order they appear in the file. */
  notes?: Note[];
}

export function blockText(b: Block): string {
  return b.runs.map((r) => r.text).join("");
}

/**
 * `decodeURI`/`encodeURI` throw on malformed input (a stray "%" in a hand-edited
 * file, a lone surrogate). A picture path must never take the whole document
 * down, so fall back to the raw text.
 */
function safeDecodeUri(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

function safeEncodeUri(s: string): string {
  try {
    return encodeURI(s);
  } catch {
    return s;
  }
}

export function plainBlock(type: ElementType, text: string): Block {
  return { type, runs: text ? [{ text }] : [] };
}

// ------------------------------------------------------------------ inline

const ESCAPABLE = /[\\*_]/g;

export function serializeRuns(runs: Run[], { marks = true, notes }: { marks?: boolean; notes?: Map<string, number> } = {}): string {
  let out = "";
  for (const r of runs) {
    if (r.note) {
      const n = notes?.get(r.note);
      out += `[^${n ?? r.note}]`;
      continue;
    }
    let t = r.text.replace(ESCAPABLE, (m) => "\\" + m);
    if (!marks || !t) {
      out += t;
      continue;
    }
    // Keep surrounding spaces outside the markers so `*word*` stays valid markdown.
    const lead = t.match(/^\s*/)![0];
    const trail = t.slice(lead.length).match(/\s*$/)![0];
    let core = t.slice(lead.length, t.length - trail.length);
    if (!core) {
      out += t;
      continue;
    }
    if (r.underline) core = `_${core}_`;
    if (r.italic) core = `*${core}*`;
    if (r.bold) core = `**${core}**`;
    out += lead + core + trail;
  }
  return out;
}

/** Parse `*italic*`, `**bold**`, `_underline_`, `[^1]` notes and backslash escapes. */
export function parseInline(src: string, { notes = false }: { notes?: boolean } = {}): Run[] {
  const runs: Run[] = [];
  const state = { bold: false, italic: false, underline: false };
  let buf = "";
  const flush = () => {
    if (!buf) return;
    const run: Run = { text: buf };
    if (state.bold) run.bold = true;
    if (state.italic) run.italic = true;
    if (state.underline) run.underline = true;
    const last = runs[runs.length - 1];
    if (last && !last.note && !!last.bold === !!run.bold && !!last.italic === !!run.italic && !!last.underline === !!run.underline) {
      last.text += run.text;
    } else {
      runs.push(run);
    }
    buf = "";
  };
  // A marker only toggles when it has a matching partner later on, so a lone
  // asterisk typed in another editor stays literal.
  const hasClosing = (marker: string, from: number) => {
    for (let j = from; j < src.length; j++) {
      if (src[j] === "\\") {
        j++;
        continue;
      }
      if (src.startsWith(marker, j) && (marker !== "*" || src[j + 1] !== "*") && (marker !== "*" || src[j - 1] !== "*")) return true;
    }
    return false;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\" && i + 1 < src.length && /[\\*_`#>@!()\[\].+&-]/.test(src[i + 1])) {
      buf += src[++i];
      continue;
    }
    if (notes && c === "[" && src[i + 1] === "^") {
      // `[^label]` is a reference; `[^label]:` starts a definition, not a reference.
      const m = src.slice(i).match(/^\[\^([^\]\s]{1,64})\](?!:)/);
      if (m) {
        flush();
        runs.push({ text: "", note: m[1] });
        i += m[0].length - 1;
        continue;
      }
    }
    if (c === "*" && src[i + 1] === "*") {
      if (state.bold || hasClosing("**", i + 2)) {
        flush();
        state.bold = !state.bold;
        i++;
        continue;
      }
    } else if (c === "*") {
      if (state.italic || hasClosing("*", i + 1)) {
        flush();
        state.italic = !state.italic;
        continue;
      }
    } else if (c === "_") {
      // Underscores inside words (snake_case) are literal.
      const prevWord = /\w/.test(src[i - 1] ?? "");
      const nextWord = /\w/.test(src[i + 1] ?? "");
      const opening = !state.underline && !prevWord && nextWord && hasClosing("_", i + 1);
      const closing = state.underline && prevWord && !nextWord;
      if (opening || closing) {
        flush();
        state.underline = !state.underline;
        continue;
      }
    }
    buf += c;
  }
  flush();
  return runs;
}

// ----------------------------------------------------------- front matter

function splitFrontMatter(text: string): [string | null, string] {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return [null, text];
  const end = text.indexOf("\n---", 3);
  if (end < 0) return [null, text];
  const after = text.indexOf("\n", end + 4);
  const fm = after < 0 ? text : text.slice(0, after + 1);
  return [fm, after < 0 ? "" : text.slice(after + 1)];
}

// ----------------------------------------------------------------- script

const SCENE_HEADING_RE = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;
const TRANSITION_RE = /^[A-Z0-9 .'’-]+TO:$/;

/** A character cue: has a letter, no lowercase letters, not too long. */
export function looksLikeCue(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 60 || !/\p{L}/u.test(t)) return false;
  // Ignore an extension like (V.O.) or (cont'd) when checking case.
  const name = t.replace(/\(.*\)\s*$/, "").replace(/\^$/, "").trim();
  if (!name || !/\p{L}/u.test(name)) return false;
  return name === name.toUpperCase() && !TRANSITION_RE.test(t) && !SCENE_HEADING_RE.test(t);
}

function isBlank(line: string | undefined) {
  return line === undefined || line.trim() === "";
}

export function parseScript(text: string): ParsedDoc {
  const [frontMatter, body] = splitFrontMatter(text.replace(/\r\n?/g, "\n"));
  const lines = body.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const t = line.trim();
    // Headings: any markdown heading, or a Fountain forced heading ".HEADING".
    const heading = t.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      blocks.push({ type: "scene_heading", runs: parseInline(heading[1].trim()) });
      i++;
      continue;
    }
    if (/^\.[^.]/.test(t) || (SCENE_HEADING_RE.test(t) && isBlank(lines[i + 1]))) {
      blocks.push({ type: "scene_heading", runs: parseInline(t.startsWith(".") ? t.slice(1).trim() : t) });
      i++;
      continue;
    }
    if (t.startsWith(">")) {
      blocks.push({ type: "transition", runs: parseInline(t.slice(1).replace(/<\s*$/, "").trim()) });
      i++;
      continue;
    }
    if (TRANSITION_RE.test(t) && isBlank(lines[i + 1])) {
      blocks.push({ type: "transition", runs: parseInline(t) });
      i++;
      continue;
    }
    const forcedCue = t.startsWith("@");
    if (forcedCue || (looksLikeCue(t) && !t.startsWith("!") && !isBlank(lines[i + 1]))) {
      blocks.push({ type: "character", runs: parseInline(forcedCue ? t.slice(1).trim() : t) });
      i++;
      while (!isBlank(lines[i])) {
        const d = lines[i].trim();
        if (/^\(.*\)$/.test(d)) blocks.push({ type: "parenthetical", runs: parseInline(d) });
        else blocks.push({ type: "dialogue", runs: parseInline(d) });
        i++;
      }
      continue;
    }
    // Direction / action paragraph: everything up to the next blank line.
    const para: string[] = [];
    while (!isBlank(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    para[0] = para[0].replace(/^\s*!/, "");
    blocks.push({ type: "direction", runs: parseInline(para.map((l) => l.trim()).join("\n")) });
  }
  return { blocks, frontMatter };
}

/** Does a direction/action paragraph need a "!" so it is not read as something else? */
function needsForcing(text: string): boolean {
  const first = text.split("\n")[0].trim();
  if (/^[#>@!.]/.test(first)) return true;
  if (looksLikeCue(first) && text.includes("\n")) return true;
  if (SCENE_HEADING_RE.test(first) || TRANSITION_RE.test(first)) return true;
  return false;
}

export function serializeScript(doc: ParsedDoc, actionType: ElementType = "direction"): string {
  const groups: string[] = [];
  const bs = doc.blocks;
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    const text = blockText(b).trim();
    if (!text && b.type !== "character") continue;
    switch (b.type) {
      case "scene_heading":
        groups.push(`## ${serializeRuns(b.runs).trim()}`);
        break;
      case "transition":
        groups.push(`> ${text.toUpperCase()}`);
        break;
      case "character": {
        if (!text) continue;
        const lines: string[] = [];
        let j = i + 1;
        for (; j < bs.length && (bs[j].type === "parenthetical" || bs[j].type === "dialogue"); j++) {
          const t = blockText(bs[j]).trim();
          if (!t) continue;
          if (bs[j].type === "parenthetical") {
            lines.push(/^\(.*\)$/.test(t) ? t : `(${t.replace(/^\(|\)$/g, "")})`);
          } else {
            // A dialogue line that looks like a parenthetical stays dialogue via escape.
            for (let d of serializeRuns(bs[j].runs).trim().split("\n")) {
              d = d.trim();
              if (!d) continue;
              if (/^\(.*\)$/.test(d)) d = "\\" + d;
              lines.push(d);
            }
          }
        }
        const name = text.toUpperCase().replace(/\n/g, " ");
        const cue = lines.length && looksLikeCue(name) ? name : `@${name}`;
        groups.push([cue, ...lines].join("\n"));
        i = j - 1;
        break;
      }
      case "parenthetical":
      case "dialogue":
      default: {
        // Directions, action, and any dialogue that lost its cue.
        let t = serializeRuns(b.runs)
          .split("\n")
          .map((l) => l.trim())
          .join("\n")
          .trim();
        if (needsForcing(t)) t = "!" + t;
        groups.push(t);
      }
    }
  }
  void actionType;
  const body = groups.join("\n\n") + (groups.length ? "\n" : "");
  return (doc.frontMatter ?? "") + body;
}

// ------------------------------------------------------------------ prose

/**
 * An empty paragraph (Enter pressed twice) is kept as a blank line. Markdown
 * drops blank lines, so it is written as "&nbsp;", which Obsidian and other
 * markdown apps also show as an empty line.
 */
export const BLANK_LINE = "&nbsp;";

/** Index of the last block with something in it; empty paragraphs after it are not kept. */
function lastContent(blocks: Block[]): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (blockText(b).trim() || b.type === "image" || b.type === "scene_break" || b.type === "divider") return i;
  }
  return -1;
}

/** `citations`: "- " lines are sources (Works Cited, Bibliography); only front and back matter has them. */
export function parseProse(text: string, hasTitle: boolean, citations = false): ParsedDoc {
  const [frontMatter, body] = splitFrontMatter(text.replace(/\r\n?/g, "\n"));
  const lines = body.split("\n");
  const blocks: Block[] = [];
  const notes: Note[] = [];
  const inline = (s: string) => parseInline(s, { notes: true });
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      i++;
      continue;
    }
    // `[^1]: text` defines a note; indented lines below it continue the same note.
    const def = t.match(/^\[\^([^\]\s]{1,64})\]:[ \t]?(.*)$/);
    if (def && !notes.some((n) => n.id === def[1])) {
      const parts = [def[2]];
      i++;
      while (i < lines.length && /^[ \t]+\S/.test(lines[i]) && !/^\[\^[^\]\s]{1,64}\]:/.test(lines[i].trim())) {
        parts.push(lines[i].replace(/^(?: {1,4}|\t)/, ""));
        i++;
      }
      notes.push({ id: def[1], runs: parseInline(parts.join("\n")) });
      continue;
    }
    if (t === BLANK_LINE) {
      blocks.push({ type: "paragraph", runs: [] });
      i++;
      continue;
    }
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const type: ElementType = level === 1 && hasTitle ? "title" : level <= 2 ? "heading" : "subheading";
      blocks.push({ type, runs: parseInline(h[2].trim()) });
      i++;
      continue;
    }
    const img = t.match(/^!\[(.*)\]\((.+?)\)$/);
    if (img) {
      blocks.push({ type: "image", runs: img[1] ? [{ text: img[1] }] : [], src: safeDecodeUri(img[2]) });
      i++;
      continue;
    }
    const centered = t.match(/^->\s*(.*?)\s*<-$/);
    if (centered) {
      blocks.push({ type: "centered", runs: parseInline(centered[1]) });
      i++;
      continue;
    }
    if (citations && /^[-*+]\s+\S/.test(t)) {
      // One source; a wrapped source continues on the following indented or plain lines.
      const src = [t.replace(/^[-*+]\s+/, "")];
      i++;
      while (i < lines.length && lines[i].trim() && !/^\s*[-*+]\s/.test(lines[i]) && !/^(#{1,6})\s|^>/.test(lines[i].trim())) src.push(lines[i++].trim());
      blocks.push({ type: "citation", runs: inline(joinSoft(src)) });
      continue;
    }
    if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(t)) {
      blocks.push({ type: "scene_break", runs: [] });
      i++;
      continue;
    }
    if (t.startsWith(">")) {
      const q: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        q.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      const bubble = q[0].match(/^\[!text-(left|right)\]\s*(.*)$/i);
      if (bubble) {
        q[0] = bubble[2];
        blocks.push({ type: bubble[1].toLowerCase() === "left" ? "text_left" : "text_right", runs: inline(joinSoft(q.filter((l, k) => l || k > 0))) });
        continue;
      }
      blocks.push({ type: "quote", runs: inline(joinSoft(q)) });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s/.test(lines[i].trim())) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", runs: inline(joinSoft(para.map((l) => l.trim()))) });
  }
  resolveNoteRefs(blocks, notes);
  const out: ParsedDoc = { blocks, frontMatter };
  if (notes.length) out.notes = notes;
  return out;
}

/** A `[^x]` with no definition is literal text, so a hand-typed marker never becomes a phantom note. */
function resolveNoteRefs(blocks: Block[], notes: Note[]) {
  const known = new Set(notes.map((n) => n.id));
  for (const b of blocks) {
    for (const r of b.runs) {
      if (r.note && !known.has(r.note)) {
        r.text = `[^${r.note}]`;
        delete r.note;
      }
    }
  }
}

/** The number each note gets: by first reference in the text, then any unreferenced definitions. */
export function noteNumbers(doc: ParsedDoc): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const b of doc.blocks) {
    for (const r of b.runs) {
      if (r.note && !numbers.has(r.note)) numbers.set(r.note, numbers.size + 1);
    }
  }
  for (const n of doc.notes ?? []) {
    if (!numbers.has(n.id)) numbers.set(n.id, numbers.size + 1);
  }
  return numbers;
}

/** Join markdown lines: soft wraps become spaces, a trailing "\" is a hard break. */
function joinSoft(lines: string[]): string {
  let out = "";
  lines.forEach((l, idx) => {
    if (idx === 0) out = l;
    else if (out.endsWith("\\")) out = out.slice(0, -1) + "\n" + l;
    else out += " " + l;
  });
  return out;
}

export function serializeProse(doc: ParsedDoc): string {
  const parts: string[] = [];
  const numbers = noteNumbers(doc);
  const last = lastContent(doc.blocks);
  for (const [i, b] of doc.blocks.entries()) {
    const text = serializeRuns(b.runs, { notes: numbers }).trim().replace(/\n/g, "\\\n");
    if (!text && b.type === "paragraph") {
      if (i < last) parts.push(BLANK_LINE);
      continue;
    }
    switch (b.type) {
      case "title":
        if (text) parts.push(`# ${text}`);
        break;
      case "heading":
        if (text) parts.push(`## ${text}`);
        break;
      case "subheading":
        if (text) parts.push(`### ${text}`);
        break;
      case "scene_break":
        parts.push("* * *");
        break;
      case "centered":
        if (text) parts.push(`-> ${text.replace(/\\\n/g, " ")} <-`);
        break;
      case "image":
        if (b.src) parts.push(`![${blockText(b).replace(/[\[\]]/g, "")}](${safeEncodeUri(b.src)})`);
        break;
      case "quote":
        if (text) parts.push(text.split("\n").map((l) => `> ${l}`).join("\n"));
        break;
      case "citation":
        if (text) parts.push(`- ${text}`);
        break;
      case "text_left":
      case "text_right":
        if (text) parts.push(bubbleLines(b.type, text));
        break;
      default:
        if (text) parts.push(/^(#{1,6}\s|>|[-+]\s|(\*\s*){3,}$|(-\s*){3,}$|&nbsp;$|\[\^[^\]\s]+\]:)/.test(text) ? "\\" + text : text);
    }
  }
  const body = (doc.frontMatter ?? "") + parts.join("\n\n") + (parts.length ? "\n" : "");
  const defs = [...(doc.notes ?? [])]
    .sort((a, b) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0))
    .map((n) => {
      const text = serializeRuns(n.runs).trim().replace(/\n/g, "\n    ");
      return `[^${numbers.get(n.id)}]:${text ? ` ${text}` : ""}`;
    });
  if (!defs.length) return body;
  return body + (parts.length ? "\n" : "") + defs.join("\n\n") + "\n";
}

// ------------------------------------------------------------------- poem

export function parsePoem(text: string): ParsedDoc {
  const [frontMatter, body] = splitFrontMatter(text.replace(/\r\n?/g, "\n"));
  const lines = body.split("\n");
  // A file ends with one newline; that is not an empty line of the poem.
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const blocks: Block[] = [];
  let i = 0;
  // Title: a leading "# " heading.
  if (lines[0]?.startsWith("# ")) {
    blocks.push({ type: "title", runs: parseInline(lines[0].slice(2).trim()) });
    i = 1;
    if (lines[1] === "") i = 2; // the blank line after the title is formatting
  }
  for (; i < lines.length; i++) {
    const l = lines[i];
    // Keep indentation exactly; only inline markup is interpreted.
    const indent = l.match(/^[ \t]*/)![0];
    const rest = l.slice(indent.length).replace(/^\\#/, "#");
    const runs = parseInline(rest);
    if (indent) {
      if (runs.length && !runs[0].bold && !runs[0].italic && !runs[0].underline) runs[0].text = indent + runs[0].text;
      else runs.unshift({ text: indent });
    }
    blocks.push({ type: "line", runs });
  }
  return { blocks, frontMatter };
}

export function serializePoem(doc: ParsedDoc): string {
  const out: string[] = [];
  const bs = doc.blocks;
  let k = 0;
  if (bs[0]?.type === "title") {
    const t = serializeRuns(bs[0].runs).trim();
    if (t) out.push(`# ${t}`, "");
    k = 1;
  }
  for (; k < bs.length; k++) {
    const raw = serializeRuns(bs[k].runs);
    const indent = raw.match(/^[ \t]*/)![0];
    let rest = raw.slice(indent.length).replace(/\s+$/, "");
    if (rest.startsWith("# ")) rest = "\\" + rest;
    out.push(indent && rest ? indent + rest : rest);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return (doc.frontMatter ?? "") + out.join("\n") + (out.length ? "\n" : "");
}

/** A text-message bubble: an Obsidian-style callout, `> [!text-left] Hi`. Later lines continue it. */
function bubbleLines(type: ElementType, text: string): string {
  const side = type === "text_left" ? "left" : "right";
  return text
    .split("\n")
    .map((l, k) => (k ? `> ${l}` : `> [!text-${side}] ${l}`))
    .join("\n");
}

// ------------------------------------------------------------------ notes
// Notion-style pages written as markdown that Obsidian also understands:
// lists, "- [ ]" to-dos, "> [!note]" callouts and "---" dividers.

const LIST_FAMILY: Partial<Record<ElementType, string>> = { bullet: "ul", numbered: "ol", todo: "todo", todo_done: "todo" };

export function parseNotes(text: string): ParsedDoc {
  const [frontMatter, body] = splitFrontMatter(text.replace(/\r\n?/g, "\n"));
  const lines = body.split("\n");
  const blocks: Block[] = [];
  // Leading whitespace of each open list level, to tell how deep an item is nested.
  const widths: number[] = [];
  const listLevel = (raw: string): number => {
    const lead = raw.match(/^[ \t]*/)![0];
    const w = lead.replace(/\t/g, "    ").length;
    while (widths.length && w < widths[widths.length - 1]) widths.pop();
    if (!widths.length || w > widths[widths.length - 1]) widths.push(w);
    return Math.min(widths.length - 1, MAX_INDENT);
  };
  const listItem = (type: ElementType, runs: Run[], raw: string): Block => {
    const indent = listLevel(raw);
    return indent ? { type, runs, indent } : { type, runs };
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    let m: RegExpMatchArray | null;
    const isItem = /^([-*+]\s|\d+[.)]\s)/.test(t) && !/^(-{3,}|\*{3,}|_{3,})$/.test(t.replace(/\s/g, ""));
    if (!isItem) widths.length = 0;
    if (t === BLANK_LINE) {
      blocks.push({ type: "paragraph", runs: [] });
    } else if ((m = t.match(/^!\[(.*)\]\((.+?)\)$/))) {
      blocks.push({ type: "image", runs: m[1] ? [{ text: m[1] }] : [], src: safeDecodeUri(m[2]) });
    } else if ((m = t.match(/^(#{1,6})\s+(.*)$/))) {
      const lvl = m[1].length;
      blocks.push({ type: lvl === 1 ? "title" : lvl === 2 ? "heading" : "subheading", runs: parseInline(m[2]) });
    } else if ((m = t.match(/^[-*+]\s+\[([ xX])\]\s?(.*)$/))) {
      blocks.push(listItem(m[1] === " " ? "todo" : "todo_done", parseInline(m[2]), lines[i]));
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(t.replace(/\s/g, ""))) {
      blocks.push({ type: "divider", runs: [] });
    } else if ((m = t.match(/^[-*+]\s+(.*)$/))) {
      blocks.push(listItem("bullet", parseInline(m[1]), lines[i]));
    } else if ((m = t.match(/^\d+[.)]\s+(.*)$/))) {
      blocks.push(listItem("numbered", parseInline(m[1]), lines[i]));
    } else if (t.startsWith(">")) {
      const q: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) q.push(lines[i++].trim().replace(/^>\s?/, ""));
      i--;
      const bubble = q[0].match(/^\[!text-(left|right)\]\s*(.*)$/i);
      const call = q[0].match(/^\[!\w+\][-+]?\s*(.*)$/);
      if (bubble) q[0] = bubble[2];
      else if (call) q[0] = call[1];
      const type: ElementType = bubble ? (bubble[1].toLowerCase() === "left" ? "text_left" : "text_right") : call ? "callout" : "quote";
      blocks.push({ type, runs: parseInline(q.filter((l, k) => l || k > 0).join("\n")) });
    } else {
      // A trailing backslash is a line break inside the same paragraph.
      let p = t;
      while (p.endsWith("\\") && i + 1 < lines.length && lines[i + 1].trim()) p = p.slice(0, -1) + "\n" + lines[++i].trim();
      blocks.push({ type: "paragraph", runs: parseInline(p) });
    }
  }
  return { blocks, frontMatter };
}

/** Stop a plain line from being read back as a list, heading, quote or divider. */
function escapeNoteLine(l: string): string {
  if (/^\d+[.)]\s/.test(l)) return l.replace(/^(\d+)([.)])/, "$1\\$2");
  if (/^([-*+]\s|#|>|-{3,}$|&nbsp;$)/.test(l)) return "\\" + l;
  return l;
}

export function serializeNotes(doc: ParsedDoc): string {
  let out = "";
  let prevFamily: string | undefined;
  let prevIndent = 0;
  // The kind of list the current nested items hang from.
  let topFamily: string | undefined;
  const nums = listNumbers(doc.blocks);
  const last = lastContent(doc.blocks);
  for (const [i, b] of doc.blocks.entries()) {
    const text = serializeRuns(b.runs).trim();
    if (!text && b.type === "paragraph" && i < last) {
      // A blank line the writer left on purpose.
      if (out) out += "\n\n";
      out += BLANK_LINE;
      prevFamily = undefined;
      prevIndent = 0;
      continue;
    }
    if (!text && b.type !== "divider" && b.type !== "image") continue;
    const family = LIST_FAMILY[b.type];
    const n = nums[i];
    const indent = family ? Math.min(b.indent ?? 0, MAX_INDENT) : 0;
    let line: string;
    switch (b.type) {
      case "title": line = `# ${text}`; break;
      case "heading": line = `## ${text}`; break;
      case "subheading": line = `### ${text}`; break;
      case "bullet": line = `- ${text}`; break;
      case "numbered": line = `${n}. ${text}`; break;
      case "todo": line = `- [ ] ${text}`; break;
      case "todo_done": line = `- [x] ${text}`; break;
      case "divider": line = "---"; break;
      case "image": line = `![${blockText(b).replace(/[\[\]]/g, "")}](${safeEncodeUri(b.src ?? "")})`; break;
      case "quote": line = text.split("\n").map((l) => `> ${l}`).join("\n"); break;
      case "callout": line = text.split("\n").map((l, k) => (k ? `> ${l}` : `> [!note] ${l}`)).join("\n"); break;
      case "text_left":
      case "text_right": line = bubbleLines(b.type, text); break;
      default:
        line = text.split("\n").map(escapeNoteLine).join("\\\n");
    }
    // Nested items are indented with one tab per level (as Obsidian writes them).
    if (indent) line = "\t".repeat(indent) + line;
    // Items of one list (and the lists nested in it) sit on consecutive lines; everything else gets a blank line.
    const together = family && prevFamily && (family === prevFamily || indent > 0 || (prevIndent > 0 && family === topFamily));
    if (out) out += together ? "\n" : "\n\n";
    out += line;
    prevFamily = family;
    prevIndent = indent;
    if (!indent) topFamily = family;
  }
  return (doc.frontMatter ?? "") + out + (out ? "\n" : "");
}

// ---------------------------------------------------------------- dispatch

export function parseDoc(text: string, mode: FileMode, hasTitle = false, citations = false): ParsedDoc {
  if (mode === "script") return parseScript(text);
  if (mode === "poem") return parsePoem(text);
  if (mode === "notes") return parseNotes(text);
  return parseProse(text, hasTitle, citations);
}

export function serializeDoc(doc: ParsedDoc, mode: FileMode): string {
  if (mode === "script") return serializeScript(doc);
  if (mode === "poem") return serializePoem(doc);
  if (mode === "notes") return serializeNotes(doc);
  return serializeProse(doc);
}

/** Screenplays call directions "action"; plays call them "direction". Same file syntax. */
export function adaptScriptTypes(doc: ParsedDoc, actionType: ElementType): ParsedDoc {
  if (actionType === "direction") return doc;
  return { ...doc, blocks: doc.blocks.map((b) => (b.type === "direction" ? { ...b, type: actionType } : b)) };
}
