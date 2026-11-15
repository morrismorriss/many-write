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

import type { ElementType, FileMode } from "./templates";

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface Block {
  type: ElementType;
  runs: Run[];
}

export interface ParsedDoc {
  blocks: Block[];
  /** YAML front matter (including the --- fences), preserved untouched. */
  frontMatter: string | null;
}

export function blockText(b: Block): string {
  return b.runs.map((r) => r.text).join("");
}

export function plainBlock(type: ElementType, text: string): Block {
  return { type, runs: text ? [{ text }] : [] };
}

// ------------------------------------------------------------------ inline

const ESCAPABLE = /[\\*_]/g;

export function serializeRuns(runs: Run[], { marks = true }: { marks?: boolean } = {}): string {
  let out = "";
  for (const r of runs) {
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

/** Parse `*italic*`, `**bold**`, `_underline_` and backslash escapes. */
export function parseInline(src: string): Run[] {
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
    if (last && !!last.bold === !!run.bold && !!last.italic === !!run.italic && !!last.underline === !!run.underline) {
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
    if (c === "\\" && i + 1 < src.length && /[\\*_`#>@!(\[\]]/.test(src[i + 1])) {
      buf += src[++i];
      continue;
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

export function parseProse(text: string, hasTitle: boolean): ParsedDoc {
  const [frontMatter, body] = splitFrontMatter(text.replace(/\r\n?/g, "\n"));
  const lines = body.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
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
      blocks.push({ type: "quote", runs: parseInline(joinSoft(q)) });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s/.test(lines[i].trim())) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", runs: parseInline(joinSoft(para.map((l) => l.trim()))) });
  }
  return { blocks, frontMatter };
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
  for (const b of doc.blocks) {
    const text = serializeRuns(b.runs).trim().replace(/\n/g, "\\\n");
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
      case "quote":
        if (text) parts.push(text.split("\n").map((l) => `> ${l}`).join("\n"));
        break;
      default:
        if (text) parts.push(/^(#{1,6}\s|>|(\*\s*){3,}$|(-\s*){3,}$)/.test(text) ? "\\" + text : text);
    }
  }
  return (doc.frontMatter ?? "") + parts.join("\n\n") + (parts.length ? "\n" : "");
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

// ---------------------------------------------------------------- dispatch

export function parseDoc(text: string, mode: FileMode, hasTitle = false): ParsedDoc {
  if (mode === "script") return parseScript(text);
  if (mode === "poem") return parsePoem(text);
  return parseProse(text, hasTitle);
}

export function serializeDoc(doc: ParsedDoc, mode: FileMode): string {
  if (mode === "script") return serializeScript(doc);
  if (mode === "poem") return serializePoem(doc);
  return serializeProse(doc);
}

/** Screenplays call directions "action"; plays call them "direction". Same file syntax. */
export function adaptScriptTypes(doc: ParsedDoc, actionType: ElementType): ParsedDoc {
  if (actionType === "direction") return doc;
  return { ...doc, blocks: doc.blocks.map((b) => (b.type === "direction" ? { ...b, type: actionType } : b)) };
}
