// Turns a manuscript into Typst source. Preview and PDF export both use this
// output with the same engine, so they cannot drift apart.

import type { Block, Note, Run } from "./markdown";
import { blockText } from "./markdown";
import { opensRow } from "./simultaneous";
import { isListType, listNumbers, MAX_INDENT, type EssayStyle, type NotePlacement, type Template } from "./templates";

export type ManuscriptItem =
  /** `chapter`: a book chapter split into sections; its title is the chapter heading. */
  | { kind: "folder"; id: string; title: string; depth: number; chapter?: boolean }
  /** A whole play inside a collection: its own title page; its front matter and acts follow. */
  | { kind: "play"; id: string; title: string }
  /** `section`: part of a book chapter; it runs on from the one before, with no heading or page break. */
  | { kind: "doc"; id: string; title: string; blocks: Block[]; notes?: Note[]; section?: boolean }
  /** A front or back matter page: typeset as plain prose on its own page. */
  | { kind: "matter"; id: string; title: string; blocks: Block[]; notes?: Note[]; where: "front" | "back" };

export interface ProjectMeta {
  title: string;
  subtitle?: string;
  author: string;
  contact: string;
  titlePage: boolean;
  paper: "us-letter" | "a4";
  /** Essays only. */
  essay?: { style: EssayStyle | "chicago"; notePlacement?: NotePlacement; instructor: string; course: string; date: string };
  /** Scripts: every scene starts on a new page. */
  sceneNewPage?: boolean;
  /** Scripts: a cue repeated after a direction, with no other speaker between, gets (CONT'D). */
  autoContd?: boolean;
  /** Books only: the scene break divider. */
  sceneBreak?: { style: "asterisks" | "line" | "hearts" | "image"; image?: string };
}

/** The text a scene break shows where a picture can't be used (editor, Word, EPUB). */
export function sceneBreakText(style: string | undefined): string {
  return style === "hearts" ? "♥   ♥   ♥" : style === "line" ? "⸻" : "*   *   *";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Today as each style writes it: MLA "16 November 2026", Chicago "November 16, 2026". */
export function essayDate(style: EssayStyle | "chicago", d = new Date()): string {
  return style === "mla" ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export interface GenOptions {
  /** Preview only: page colours that follow the app theme. */
  pageFill?: string;
  textFill?: string;
  /** Production mode (scripts): locked pages and revision marks. */
  production?: {
    /** Element id -> locked page number; `hard` starts a new page there. */
    locks: Map<string, { page: number; hard: boolean; letter?: number }>;
    /** Document id -> indices of lines changed in this revision. */
    revised: Map<string, Set<number>>;
    /** Printed at the top left of every page, e.g. "Blue Rev. 16/11/2026". */
    label: string;
  };
}

/** The pseudo-element standing for a folder's or matter page's heading. */
export const headingIndex = -1;

export interface ElementSpan {
  id: string;
  kind: string;
  start: number;
  end: number;
}

export interface Generated {
  source: string;
  elements: ElementSpan[];
}

/** Element ids are `<docId>#<blockIndex>` so the preview can follow the cursor. */
export const elementId = (docId: string, index: number) => `${docId}#${index}`;

function str(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "    ") + '"';
}

function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** Web addresses in text, for clickable links. Trailing punctuation is not part of the link. */
export const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]*[^\s<>".,;:!?)\]}'’”]/gi;

/** The address a link opens: "www.example.com" gets https://. */
export function linkTarget(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** A piece of text as Typst string literals, with web addresses made into links. */
function textToTypst(t: string): string {
  let out = "";
  let last = 0;
  URL_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = URL_RE.exec(t)); ) {
    if (m.index > last) out += `#${str(t.slice(last, m.index))}`;
    out += `#link(${str(linkTarget(m[0]))})[#${str(m[0])}]`;
    last = m.index + m[0].length;
  }
  if (last < t.length) out += `#${str(t.slice(last))}`;
  return out;
}

/** A cue's name without its extension: "ANNA (V.O.)" -> "ANNA". */
export function cueName(text: string): string {
  return text.trim().toUpperCase().replace(/\s*\(.*\)\s*$/, "").trim();
}

/**
 * Lines of a scene whose cue should read (CONT'D): the same character speaks
 * again with only directions between, and the cue has no extension of its own.
 */
export function contdLines(blocks: Block[]): Set<number> {
  const out = new Set<number>();
  let last: string | null = null;
  blocks.forEach((b, i) => {
    if (b.type === "scene_heading" || b.type === "transition" || b.type === "song") last = null;
    if (b.type !== "character") return;
    const text = blockText(b).trim();
    const name = cueName(text);
    if (!name) return;
    if (name === last && !/\(.*\)\s*$/.test(text)) out.add(i);
    last = name;
  });
  return out;
}

/** How note references are rendered, and where their text comes from. */
export interface NoteRender {
  placement: NotePlacement;
  number: (id: string) => number;
  text: (id: string) => Run[];
  /** Endnotes: record the text once, in reference order. */
  collect?: (number: number, runs: Run[]) => void;
}

/** Typst markup for a run list. Text always goes in string literals, so nothing the writer types can be read as Typst code. */
export function runsToTypst(runs: Run[], preserveSpaces = false, notes?: NoteRender): string {
  let out = "";
  for (const r of runs) {
    if (r.note) {
      if (!notes) continue;
      const text = notes.text(r.note);
      if (notes.placement === "footnotes") {
        out += `#footnote[${runsToTypst(text)}]`;
      } else {
        const n = notes.number(r.note);
        notes.collect?.(n, text);
        out += `#super[${n}]`;
      }
      continue;
    }
    const pieces = r.text.split("\n");
    let inner = pieces
      .map((p) => {
        let t = p;
        if (preserveSpaces) {
          // Keep indentation and repeated spaces exactly (poems).
          t = t.replace(/\t/g, "    ").replace(/ {2,}/g, (m) => " ".repeat(m.length)).replace(/^ /, " ");
        }
        return t ? textToTypst(t) : "";
      })
      .join("#linebreak()");
    if (!inner) continue;
    if (r.underline) inner = `#underline[${inner}]`;
    if (r.italic) inner = `#emph[${inner}]`;
    if (r.bold) inner = `#strong[${inner}]`;
    out += inner;
  }
  return out;
}

export function generateTypst(template: Template, meta: ProjectMeta, items: ManuscriptItem[], opts: GenOptions = {}): Generated {
  const parts: string[] = [];
  let bytes = 0;
  const elements: ElementSpan[] = [];
  const emit = (s: string) => {
    parts.push(s);
    bytes += utf8Length(s);
  };

  const confArgs = [
    `title: ${str(meta.title || "Untitled")}`,
    ...(meta.subtitle?.trim() ? [`subtitle: ${str(meta.subtitle.trim())}`] : []),
    `author: ${str(meta.author || "")}`,
    `contact: ${str(meta.contact || "")}`,
    `title-page: ${meta.titlePage ? "true" : "false"}`,
  ];
  if (template.id !== "book") confArgs.push(`paper: ${str(meta.paper || "us-letter")}`);
  if (template.id === "book" && meta.sceneBreak) {
    const { style, image } = meta.sceneBreak;
    const useImage = style === "image" && !!image;
    confArgs.push(`scene-break: ${str(useImage ? "image" : style === "image" ? "asterisks" : style)}`);
    if (useImage) confArgs.push(`scene-break-image: ${str("/" + image!.replace(/^\/+/, ""))}`);
  }
  if (template.id === "essay") {
    const e = meta.essay ?? { style: "mla", instructor: "", course: "", date: "" };
    confArgs.push(`style: ${str(e.style)}`, `instructor: ${str(e.instructor)}`, `course: ${str(e.course)}`, `date: ${str(e.date.trim() || essayDate(e.style))}`);
  }
  if (opts.pageFill) confArgs.push(`page-fill: rgb(${str(opts.pageFill)})`);
  if (opts.textFill) confArgs.push(`text-fill: rgb(${str(opts.textFill)})`);
  const prod = template.mode === "script" ? opts.production : undefined;
  if (prod) confArgs.push(`revision: ${str(prod.label)}`);
  const lockFor = (id: string) => {
    const l = prod?.locks.get(id);
    if (l) emit(`#mw-lock(${l.page}, hard: ${l.hard}${l.letter ? `, start: ${l.letter}` : ""})\n`);
  };
  const revMark = (docId: string, index: number) => (prod?.revised.get(docId)?.has(index) ? "#mw-rev()" : "");
  const image = (b: Block) => `#block(above: 1em, below: 0pt, width: 100%, align(center, image(${str("/" + (b.src ?? "").replace(/^\/+/, ""))}, width: 75%)))\n`;

  // Chicago notes: number every marker in reading order, and gather endnotes for the end.
  const notePlacement: NotePlacement | null =
    template.id === "essay" && meta.essay?.style === "chicago-notes" ? (meta.essay.notePlacement ?? "footnotes") : null;
  const noteKeys = new Map<string, number>();
  if (notePlacement) {
    for (const item of items) {
      if (item.kind !== "doc" && item.kind !== "matter") continue;
      for (const b of item.blocks) {
        for (const r of b.runs) {
          if (!r.note) continue;
          const key = `${item.id}:${r.note}`;
          if (!noteKeys.has(key)) noteKeys.set(key, noteKeys.size + 1);
        }
      }
    }
  }
  const endnotes = new Map<number, Run[]>();
  const notesFor = (item: { id: string; notes?: Note[] }): NoteRender | undefined => {
    if (!notePlacement) return undefined;
    return {
      placement: notePlacement,
      number: (id) => noteKeys.get(`${item.id}:${id}`) ?? 0,
      text: (id) => item.notes?.find((n) => n.id === id)?.runs ?? [],
      collect:
        notePlacement === "endnotes"
          ? (n, runs) => {
              if (!endnotes.has(n)) endnotes.set(n, runs);
            }
          : undefined,
    };
  };

  emit(`// Generated by Many Write. Edit the markdown files, not this.\n`);
  emit(`#import "/mw/${template.typst}": *\n`);
  emit(`#show: conf.with(${confArgs.join(", ")})\n`);

  const poem = template.mode === "poem";
  let prev = "none";
  let prevLevel = 0;
  let first = true;
  let matterImported = false;
  let endnotesEmitted = false;
  const emitEndnotes = () => {
    if (endnotesEmitted || !endnotes.size) return;
    endnotesEmitted = true;
    if (!matterImported) {
      emit(`#import "/mw/matter.typ": matter-start, matter-el\n`);
      matterImported = true;
    }
    emit(`#matter-start("Endnotes", first: false)\n`);
    for (const [n, runs] of [...endnotes.entries()].sort((a, b) => a[0] - b[0])) {
      emit(`#matter-el("citation", "none")[${n}. ${runsToTypst(runs)}]\n`);
    }
  };
  let lastWhere: "front" | "body" | "back" = "front";
  // The kinds of empty lines kept as blank space on the page (pressing Enter twice).
  const blankKinds = new Set(["paragraph", "centered"]);
  /** Index of the last line with text: empty lines after it are not printed. */
  const lastFilled = (blocks: Block[]) => {
    for (let i = blocks.length - 1; i >= 0; i--) if (blockText(blocks[i]).trim() || blocks[i].type === "image" || blocks[i].type === "scene_break" || blocks[i].type === "divider") return i;
    return -1;
  };
  const blank = `#hide("x")`;
  let afterHeading = false;
  for (const item of items) {
    const where = item.kind === "matter" ? item.where : item.kind === "play" ? "front" : "body";
    if (where === "back") emitEndnotes();
    const script = template.mode === "script";
    if (item.kind === "play") {
      // A play of a collection: its title page, then its own front matter (unnumbered).
      lockFor(elementId(item.id, headingIndex));
      const hstart = bytes;
      emit(`#mw-play(${str(item.title)}, ${str(meta.author || "")}, first: ${first})\n`);
      elements.push({ id: elementId(item.id, headingIndex), kind: "play_title", start: hstart, end: bytes });
      first = false;
      lastWhere = "front";
      afterHeading = true;
      prev = "none";
      continue;
    }
    // Scripts: front matter is unnumbered and the script itself starts at page 1.
    if (script && first && where === "front") emit(`#mw-front-start()\n`);
    if (script && lastWhere === "front" && where !== "front" && !first) emit(`#mw-body-start()\n`);
    // Front matter, the body and back matter each start on a fresh page.
    if (!first && where !== lastWhere) emit(`#pagebreak(weak: true)\n`);
    lastWhere = where;
    if (item.kind === "matter") {
      if (!matterImported) {
        emit(`#import "/mw/matter.typ": matter-start, matter-el\n`);
        matterImported = true;
      }
      const filled = item.blocks.filter((b) => blockText(b).trim());
      // A page of only centred lines (a dedication, an epigraph) sits lower on the page.
      const centered = filled.length > 0 && filled.every((b) => b.type === "centered" || b.type === "quote");
      lockFor(elementId(item.id, headingIndex));
      const hstart = bytes;
      // Matter page titles stay off the page, like scene titles; an essay's
      // Works Cited or Bibliography page keeps the heading its style requires.
      emit(`#matter-start(${str(template.id === "essay" ? item.title : "")}, first: ${first}, centered: ${centered})\n`);
      afterHeading = false;
      elements.push({ id: elementId(item.id, headingIndex), kind: "heading", start: hstart, end: bytes });
      first = false;
      let mprev = "none";
      const mlast = lastFilled(item.blocks);
      item.blocks.forEach((b, index) => {
        if (b.type === "image") {
          if (b.src) emit(image(b));
          return;
        }
        const empty = !blockText(b).trim();
        // An empty paragraph is a blank line on the page; trailing ones are not printed.
        if (empty && b.type !== "scene_break" && (!blankKinds.has(b.type) || index > mlast)) return;
        lockFor(elementId(item.id, index));
        const start = bytes;
        emit(`#matter-el(${str(b.type)}, ${mprev})[${empty && b.type !== "scene_break" ? blank : runsToTypst(b.runs, false, notesFor(item))}]\n`);
        elements.push({ id: elementId(item.id, index), kind: b.type, start, end: bytes });
        mprev = str(b.type);
      });
      prev = "none";
      continue;
    }
    if (item.kind === "folder") {
      lockFor(elementId(item.id, headingIndex));
      const hstart = bytes;
      if (item.chapter && template.id === "book") {
        // A chapter made of sections: the chapter heading, then its sections run on.
        emit(`#doc-start(${str(item.title)}, first: ${first})\n`);
        elements.push({ id: elementId(item.id, headingIndex), kind: "folder_heading", start: hstart, end: bytes });
        first = false;
        afterHeading = false;
        prev = '"chapter"';
        continue;
      }
      emit(`#folder(${str(item.title)}, ${item.depth}, first: ${first})\n`);
      elements.push({ id: elementId(item.id, headingIndex), kind: "folder_heading", start: hstart, end: bytes });
      first = false;
      afterHeading = true;
      prev = '"folder_heading"';
      continue;
    }
    if (item.section) {
      // A section of a book chapter: no heading, no page break; it carries on the chapter's text.
    } else if (script) {
      // A scene starts on a new page, except straight after its act's heading.
      emit(`#doc-start(${str(item.title)}, first: ${first || afterHeading}, new-page: ${meta.sceneNewPage ? "true" : "false"})\n`);
    } else if (template.id === "document") {
      // Each page of a document starts a new page, except straight after its part's heading.
      emit(`#doc-start(${str(item.title)}, first: ${first || afterHeading})\n`);
    } else {
      emit(`#doc-start(${str(item.title)}, first: ${first})\n`);
    }
    first = false;
    afterHeading = false;
    if (template.id === "book" && !item.section) prev = '"chapter"';

    if (poem) {
      // Group lines into stanzas; empty lines separate stanzas.
      let stanza: { index: number; block: Block }[] = [];
      const flush = () => {
        if (!stanza.length) return;
        emit(`#stanza(lines: ${stanza.length})[\n`);
        for (const { index, block } of stanza) {
          const start = bytes;
          emit(`#el("line", none)[${runsToTypst(block.runs, true)}]\n`);
          elements.push({ id: elementId(item.id, index), kind: "line", start, end: bytes });
        }
        emit(`]\n`);
        stanza = [];
      };
      item.blocks.forEach((b, index) => {
        if (b.type === "title") {
          flush();
          if (!blockText(b).trim()) return;
          const start = bytes;
          emit(`#el("title", none)[${runsToTypst(b.runs)}]\n`);
          elements.push({ id: elementId(item.id, index), kind: "title", start, end: bytes });
        } else if (!blockText(b).trim()) {
          flush();
        } else {
          stanza.push({ index, block: b });
        }
      });
      flush();
      continue;
    }

    const contd = template.mode === "script" && meta.autoContd ? contdLines(item.blocks) : null;
    const last = lastFilled(item.blocks);
    const nums = template.mode === "notes" ? listNumbers(item.blocks) : [];
    /** One line; returns the kind the next line in its column follows, or "" for a skipped line. */
    const emitLine = (b: Block, index: number, before: string, together = false): string => {
      const empty = !blockText(b).trim();
      // An empty paragraph (Enter pressed twice) is kept as a blank line, except at the very end.
      const blankLine = empty && template.mode !== "script" && blankKinds.has(b.type) && index < last;
      if (empty && b.type !== "scene_break" && b.type !== "divider" && !blankLine) return "";
      lockFor(elementId(item.id, index));
      const start = bytes;
      const body = blankLine ? blank : runsToTypst(contd?.has(index) ? [...b.runs, { text: " (CONT'D)" }] : b.runs, false, notesFor(item));
      // Document lists: how deep each item is nested, and the number it shows.
      let listArgs = "";
      if (template.mode === "notes" && isListType(b.type)) {
        const level = Math.min(b.indent ?? 0, MAX_INDENT);
        listArgs = `, level: ${level}, prev-level: ${prevLevel}${nums[index] ? `, num: ${nums[index]}` : ""}`;
        prevLevel = level;
      } else prevLevel = 0;
      const simArg = together ? ", sim: true" : "";
      emit(`#el(${str(b.type)}, ${before}${listArgs}${simArg})[${revMark(item.id, index)}${body}]\n`);
      elements.push({ id: elementId(item.id, index), kind: b.type, start, end: bytes });
      return str(b.type);
    };
    // Parallel speech only exists in the two script formats; anywhere else the lines print as written.
    const beside = (x: Block) => template.mode === "script" && (x.sim ?? -1) >= 0;
    for (let index = 0; index < item.blocks.length; index++) {
      const b = item.blocks[index];
      if (b.type === "image") {
        if (b.src) emit(image(b));
        continue;
      }
      if (beside(b)) {
        // Speakers one beside another: a grid, one cell per speaker (see `sim` in the template).
        // A row ends where the next one starts, so two rows in a row stay apart.
        if (index > 0 && beside(item.blocks[index - 1]) && !opensRow(b)) continue;
        let end = index + 1;
        while (end < item.blocks.length && beside(item.blocks[end]) && !opensRow(item.blocks[end])) end++;
        const row = item.blocks.slice(index, end);
        const columns = Math.max(...row.map((x) => x.sim ?? 0)) + 1;
        emit(`#sim(${columns}, `);
        for (let column = 0; column < columns; column++) {
          if (column) emit(", ");
          emit("[");
          let before = "none";
          row.forEach((cell, k) => {
            if ((cell.sim ?? 0) !== column) return;
            const kind = emitLine(cell, index + k, before, true);
            if (kind) before = kind;
          });
          emit("]");
        }
        emit(")\n");
        prev = str(row[row.length - 1].type);
        index = end - 1;
        continue;
      }
      const kind = emitLine(b, index, prev);
      if (kind) prev = kind;
    }
  }
  emitEndnotes();
  return { source: parts.join(""), elements };
}
