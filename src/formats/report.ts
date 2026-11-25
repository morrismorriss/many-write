// Production report for scripts: the scene breakdown, cast, locations and a
// character-by-scene plot that a production office, stage manager or
// assistant director works from. Lengths are in eighths of a page, the unit
// schedules are built in.

import type { Block } from "./markdown";
import { blockText } from "./markdown";
import { cueName, type ManuscriptItem } from "./typst";

/** Line types spoken by the cue above them. */
const SPEECH = new Set(["dialogue", "parenthetical", "lyric"]);
/** Line types whose words are spoken or sung (parentheticals are not). */
const SPOKEN = new Set(["dialogue", "lyric"]);
/** Line types in which a character can appear without speaking. */
const DESCRIBES = new Set(["direction", "action"]);

export interface Slug {
  /** "INT", "EXT", "INT/EXT" or "" when the heading has no prefix. */
  ie: string;
  location: string;
  /** "DAY", "NIGHT", "CONTINUOUS"… or "". */
  time: string;
}

/**
 * Read a screenplay scene heading: "INT. KITCHEN - NIGHT" ->
 * { ie: "INT", location: "KITCHEN", time: "NIGHT" }. Anything without an
 * INT/EXT prefix keeps its whole text as the location.
 */
export function parseSlug(text: string): Slug {
  let s = text.trim().replace(/\s*#[^#\s]+#\s*$/, ""); // Fountain scene number: "#12#"
  let ie = "";
  const m = /^(INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\s*\/\s*E|E\s*\/\s*I|INT|EXT|EST)(?:\.|\b)\s*/i.exec(s);
  if (m) {
    const p = m[1].toUpperCase().replace(/[.\s]/g, "");
    ie = p === "INT" ? "INT" : p === "EXT" || p === "EST" ? "EXT" : "INT/EXT";
    s = s.slice(m[0].length);
  }
  let time = "";
  const dash = /\s+[-–—]+\s+([^-–—]+)$/.exec(s);
  if (dash && (ie || TIMES.test(dash[1].trim()))) {
    time = dash[1].trim().toUpperCase();
    s = s.slice(0, dash.index);
  }
  return { ie, location: s.trim().replace(/[-–—\s]+$/, "").toUpperCase(), time };
}
const TIMES = /^(DAY|NIGHT|MORNING|EVENING|AFTERNOON|DAWN|DUSK|SUNRISE|SUNSET|NOON|MIDNIGHT|LATER|CONTINUOUS|MOMENTS LATER|SAME|SAME TIME)\b/i;

export interface SceneSpeaker {
  speeches: number;
  /** Words of dialogue and lyrics. */
  words: number;
}

export interface ReportScene {
  /** Numbered from 1 in each play. */
  number: number;
  docId: string;
  /** Block range of the scene in its document: [start, end). */
  start: number;
  end: number;
  play: string;
  act: string;
  heading: string;
  slug: Slug;
  speakers: Map<string, SceneSpeaker>;
  /** Characters named in directions or action who do not speak in the scene. */
  silent: Set<string>;
  /** Filled in from the typeset pages, when known. */
  pages?: { first: string; last: string; eighths: number };
}

/**
 * The scenes of a script in order. A scene heading starts a scene; so does
 * every scene document, whose binder title names it if it opens without one.
 */
export function scenesOf(items: ManuscriptItem[], listed: string[] = []): ReportScene[] {
  const out: ReportScene[] = [];
  let play = "";
  let act = "";
  let number = 0;
  for (const item of items) {
    if (item.kind === "play") {
      play = item.title;
      act = "";
      number = 0;
      continue;
    }
    if (item.kind === "folder") {
      act = item.title;
      continue;
    }
    if (item.kind !== "doc") continue;
    const blocks = item.blocks;
    const starts: number[] = [];
    const first = blocks.findIndex((b) => blockText(b).trim());
    if (first < 0) continue;
    if (blocks[first].type !== "scene_heading") starts.push(0);
    blocks.forEach((b, i) => b.type === "scene_heading" && blockText(b).trim() && starts.push(i));
    starts.forEach((start, k) => {
      const end = k + 1 < starts.length ? starts[k + 1] : blocks.length;
      const head = blocks[start].type === "scene_heading" ? blockText(blocks[start]).trim() : "";
      out.push({
        number: ++number,
        docId: item.id,
        start,
        end,
        play,
        act,
        heading: head || item.title,
        slug: head ? parseSlug(head) : { ie: "", location: "", time: "" },
        speakers: new Map(),
        silent: new Set(),
      });
    });
  }
  // Who speaks, and how much, in each scene.
  const byDoc = new Map(items.flatMap((i) => (i.kind === "doc" ? [[i.id, i.blocks] as const] : [])));
  for (const sc of out) countSpeakers(sc, byDoc.get(sc.docId)!.slice(sc.start, sc.end));
  // Characters mentioned in capitals in directions, without speaking.
  const cast = [...new Set([...out.flatMap((s) => [...s.speakers.keys()]), ...listed])].filter((n) => /[A-Z]/.test(n) && n.length > 1);
  const patterns = cast.map((n) => [n, new RegExp(`(^|[^A-Za-z0-9])${escapeRe(n)}(?![A-Za-z0-9])`)] as const);
  for (const sc of out) {
    const text = byDoc
      .get(sc.docId)!
      .slice(sc.start, sc.end)
      .filter((b) => DESCRIBES.has(b.type))
      .map(blockText)
      .join("\n");
    if (!text) continue;
    for (const [name, re] of patterns) if (!sc.speakers.has(name) && re.test(text)) sc.silent.add(name);
  }
  return out;
}

/**
 * Names from a "Cast of characters" page: each line starts with the name in
 * capitals ("ANNA, thirties, a teacher." / "THE DOCTOR - a ghost").
 */
export function castListNames(items: ManuscriptItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.kind !== "matter" || it.where !== "front" || !/cast|characters|dramatis/i.test(it.title)) continue;
    for (const b of it.blocks) {
      const m = /^\s*([A-Z][A-Z0-9.'’ -]*?[A-Z0-9.])\s*(?:[,:;(–—]|\s-\s|$)/.exec(blockText(b));
      const name = m?.[1].replace(/\.$/, "").trim();
      if (name && name.length > 1 && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function words(s: string): number {
  return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Attribute every speech to its speaker, column by column for simultaneous dialogue. */
function countSpeakers(sc: ReportScene, blocks: Block[]) {
  const speaker = new Map<number, string | null>();
  for (const b of blocks) {
    const column = b.sim ?? -1;
    if (column < 0) for (const k of [...speaker.keys()]) if (k >= 0) speaker.delete(k);
    if (b.type === "character") {
      const who = cueName(blockText(b));
      speaker.set(column, who || null);
      if (!who) continue;
      const s = sc.speakers.get(who) ?? { speeches: 0, words: 0 };
      s.speeches++;
      sc.speakers.set(who, s);
    } else if (SPEECH.has(b.type)) {
      const who = speaker.get(column);
      if (who && SPOKEN.has(b.type)) sc.speakers.get(who)!.words += words(blockText(b));
    } else {
      speaker.set(column, null);
    }
  }
}

// ------------------------------------------------------------------ pages

/** Where the script's lines landed, from a typeset report. */
export interface LayoutInfo {
  /** Element ids (`docId#index`) in order. */
  ids: string[];
  first: number[];
  last: number[];
  tops: number[];
  bottoms: number[];
  pageHeight: number;
  /** The number printed on each physical page (index 0 = page 1); null when unnumbered. */
  labels: (string | null)[];
}

/** Script pages have 1in margins top and bottom. */
const MARGIN = 72;
/** A 12pt line sits about this far above its baseline, and descends this far below. */
const ASCENT = 10;
const DESCENT = 3;

/** Page span and length in eighths of a page, measured from where the lines were set. */
export function measureScenes(scenes: ReportScene[], layout: LayoutInfo) {
  const at = new Map<string, number>();
  layout.ids.forEach((id, i) => at.set(id, i));
  const body = layout.pageHeight - 2 * MARGIN;
  if (body <= 0) return;
  for (const sc of scenes) {
    let start: [number, number] | null = null;
    let end: [number, number] | null = null;
    for (let b = sc.start; b < sc.end; b++) {
      const i = at.get(`${sc.docId}#${b}`);
      if (i === undefined || !layout.first[i]) continue;
      if (!start) start = [layout.first[i], layout.tops[i] - ASCENT];
      end = [layout.last[i] || layout.first[i], layout.bottoms[i] + DESCENT];
    }
    if (!start || !end) continue;
    const pos = ([page, y]: [number, number]) => (page - 1) * body + Math.min(Math.max(y - MARGIN, 0), body);
    const eighths = Math.max(1, Math.round(((pos(end) - pos(start)) / body) * 8));
    const label = (p: number) => layout.labels[p - 1] ?? String(p);
    sc.pages = { first: label(start[0]), last: label(end[0]), eighths };
  }
}

/**
 * The number printed on every page, worked out the way the script template
 * prints it: front matter is unnumbered, the script (and each play of a
 * collection) starts at 1, and in production mode locked pages keep their
 * numbers and added pages get letters.
 */
export function pageLabels(
  pageCount: number,
  ids: string[],
  first: number[],
  /** Front matter, title pages and plays' own front matter. */
  isFront: (docId: string) => boolean,
  locks?: Map<string, { page: number; hard: boolean; letter?: number }>,
): (string | null)[] {
  const front = new Array<boolean>(pageCount + 1).fill(false);
  const restart = new Array<boolean>(pageCount + 1).fill(false);
  let inFront = false;
  ids.forEach((id, i) => {
    const p = first[i];
    if (!p) return;
    const f = isFront(id.split("#")[0]);
    if (f) front[p] = true;
    else if (inFront || i === firstBody(ids, first, isFront)) restart[p] = true;
    inFront = f;
  });
  const out: (string | null)[] = [];
  let n = 0;
  for (let p = 1; p <= pageCount; p++) {
    if (restart[p]) n = 0;
    if (front[p] && !restart[p]) {
      out.push(null);
      continue;
    }
    n++;
    out.push(String(n));
  }
  if (!locks?.size) return out;
  // Production: a lock's page is where its line (or, for a heading, the next line) was set.
  const hard = new Map<number, { page: number; letter: number }>();
  const soft = new Map<number, { page: number; letter: number }>();
  ids.forEach((id, i) => {
    const l = locks.get(id);
    if (!l) return;
    let p = first[i];
    for (let j = i + 1; !p && j < ids.length; j++) p = first[j];
    if (!p) return;
    const into = l.hard ? hard : soft;
    if (!into.has(p)) into.set(p, { page: l.page, letter: l.letter ?? 0 });
  });
  const lockPages = [...hard.keys(), ...[...soft.keys()].map((p) => p + 1)];
  if (!lockPages.length) return out;
  const firstLock = Math.min(...lockPages);
  let base: number | null = null;
  let extra = 0;
  for (let p = firstLock; p <= pageCount; p++) {
    const h = hard.get(p) ?? soft.get(p - 1);
    if (h) {
      base = h.page;
      extra = h.letter;
    } else if (base !== null) extra++;
    if (base !== null && out[p - 1] !== null) out[p - 1] = `${base}${letters(extra)}`;
  }
  return out;
}

function firstBody(ids: string[], first: number[], isFront: (docId: string) => boolean): number {
  return ids.findIndex((id, i) => first[i] > 0 && !isFront(id.split("#")[0]));
}

function letters(n: number): string {
  let s = "";
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** "1 3/8", "4/8", "2" pages. */
export function formatEighths(e: number): string {
  const whole = Math.floor(e / 8);
  const rest = e % 8;
  if (!rest) return String(whole);
  return whole ? `${whole} ${rest}/8` : `${rest}/8`;
}

// ------------------------------------------------------------------ report

export interface CastRow {
  name: string;
  speeches: number;
  words: number;
  /** Scenes they speak in. */
  speaking: number;
  /** Scenes they are in without speaking. */
  silent: number;
  /** Eighths of the script they are in (speaking or not). */
  eighths: number;
  /** Page they first appear on. */
  firstPage: string;
  scenes: number[];
}

export interface LocationRow {
  location: string;
  ie: string[];
  times: string[];
  scenes: number[];
  eighths: number;
}

export interface ProductionReport {
  screenplay: boolean;
  scenes: ReportScene[];
  cast: CastRow[];
  locations: LocationRow[];
  /** Total eighths, when pages are known. */
  eighths: number;
  measured: boolean;
  /** Screenplay day/night and interior/exterior split, in scenes. */
  split: { int: number; ext: number; both: number; day: number; night: number; other: number };
}

const NIGHT = /NIGHT|EVENING|DUSK|SUNSET|MIDNIGHT/;
const DAY = /DAY|MORNING|AFTERNOON|DAWN|SUNRISE|NOON/;

export function buildReport(items: ManuscriptItem[], screenplay: boolean, layout?: LayoutInfo): ProductionReport {
  const listed = castListNames(items);
  const scenes = scenesOf(items, listed);
  if (layout) measureScenes(scenes, layout);
  const measured = scenes.some((s) => s.pages);
  const key = (s: ReportScene) => scenes.indexOf(s);
  const cast = new Map<string, CastRow & { at: number }>();
  for (const sc of scenes) {
    const add = (name: string, speaking: boolean) => {
      const r = cast.get(name) ?? { name, speeches: 0, words: 0, speaking: 0, silent: 0, eighths: 0, firstPage: "", scenes: [], at: key(sc) };
      if (speaking) {
        const s = sc.speakers.get(name)!;
        r.speeches += s.speeches;
        r.words += s.words;
        r.speaking++;
      } else r.silent++;
      r.eighths += sc.pages?.eighths ?? 0;
      if (!r.firstPage && sc.pages) r.firstPage = sc.pages.first;
      r.scenes.push(sc.number);
      cast.set(name, r);
    };
    for (const name of sc.speakers.keys()) add(name, true);
    for (const name of sc.silent) add(name, false);
  }
  // Characters on the cast list who never appear still belong in the cast report.
  for (const name of listed) if (!cast.has(name)) cast.set(name, { name, speeches: 0, words: 0, speaking: 0, silent: 0, eighths: 0, firstPage: "", scenes: [], at: Number.MAX_SAFE_INTEGER });
  const castRows = [...cast.values()]
    .sort((a, b) => b.speeches - a.speeches || b.words - a.words || a.at - b.at)
    .map(({ at: _at, ...r }) => r);

  const locs = new Map<string, LocationRow>();
  if (screenplay) {
    for (const sc of scenes) {
      if (!sc.slug.location) continue;
      const r = locs.get(sc.slug.location) ?? { location: sc.slug.location, ie: [], times: [], scenes: [], eighths: 0 };
      if (sc.slug.ie && !r.ie.includes(sc.slug.ie)) r.ie.push(sc.slug.ie);
      if (sc.slug.time && !r.times.includes(sc.slug.time)) r.times.push(sc.slug.time);
      r.scenes.push(sc.number);
      r.eighths += sc.pages?.eighths ?? 0;
      locs.set(sc.slug.location, r);
    }
  }
  const split = { int: 0, ext: 0, both: 0, day: 0, night: 0, other: 0 };
  for (const sc of scenes) {
    if (sc.slug.ie === "INT") split.int++;
    else if (sc.slug.ie === "EXT") split.ext++;
    else if (sc.slug.ie) split.both++;
    if (!sc.slug.time) continue;
    if (NIGHT.test(sc.slug.time)) split.night++;
    else if (DAY.test(sc.slug.time)) split.day++;
    else split.other++;
  }
  return {
    screenplay,
    scenes,
    cast: castRows,
    locations: [...locs.values()].sort((a, b) => b.scenes.length - a.scenes.length || a.location.localeCompare(b.location)),
    eighths: scenes.reduce((n, s) => n + (s.pages?.eighths ?? 0), 0),
    measured,
    split,
  };
}

/** "3", "pp. 3–5" style page span for a scene. */
export function pageSpan(sc: ReportScene): string {
  if (!sc.pages) return "";
  return sc.pages.first === sc.pages.last ? sc.pages.first : `${sc.pages.first}–${sc.pages.last}`;
}

/** Scene numbers as ranges: [1,2,3,5] -> "1–3, 5". */
export function sceneList(ns: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    out.push(j > i ? `${ns[i]}–${ns[j]}` : String(ns[i]));
    i = j;
  }
  return out.join(", ");
}

/** Scene label in a collection: plays restart their numbering, so name the play. */
function sceneRef(sc: ReportScene, multi: boolean): string {
  return multi && sc.play ? `${sc.play} ${sc.number}` : String(sc.number);
}

// ------------------------------------------------------------------ CSV

export type ReportSection = "scenes" | "cast" | "locations" | "plot";

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function reportCsv(r: ProductionReport, section: ReportSection): string {
  const multi = new Set(r.scenes.map((s) => s.play)).size > 1;
  if (section === "scenes") {
    const head = ["Scene", ...(multi ? ["Play"] : []), r.screenplay ? "Sequence" : "Act", "Heading", ...(r.screenplay ? ["Int/Ext", "Location", "Time"] : []), "Pages", "Length (eighths)", "Speaking", "Non-speaking"];
    return csv([
      head,
      ...r.scenes.map((s) => [
        s.number,
        ...(multi ? [s.play] : []),
        s.act,
        s.heading,
        ...(r.screenplay ? [s.slug.ie, s.slug.location, s.slug.time] : []),
        pageSpan(s),
        s.pages ? formatEighths(s.pages.eighths) : "",
        [...s.speakers.keys()].join("; "),
        [...s.silent].join("; "),
      ]),
    ]);
  }
  if (section === "cast") {
    return csv([
      ["Character", "Speeches", "Words", "Speaking scenes", "Non-speaking scenes", "Pages in (eighths)", "First page", "Scenes"],
      ...r.cast.map((c) => [c.name, c.speeches, c.words, c.speaking, c.silent, r.measured ? formatEighths(c.eighths) : "", c.firstPage, sceneList(c.scenes)]),
    ]);
  }
  if (section === "locations") {
    return csv([
      ["Location", "Int/Ext", "Times", "Scenes", "Pages (eighths)", "Scene numbers"],
      ...r.locations.map((l) => [l.location, l.ie.join("; "), l.times.join("; "), l.scenes.length, r.measured ? formatEighths(l.eighths) : "", sceneList(l.scenes)]),
    ]);
  }
  // The plot: one row per character, one column per scene. S = speaks, X = on without speaking.
  return csv([
    ["Character", ...r.scenes.map((s) => sceneRef(s, multi))],
    ...r.cast.map((c) => [c.name, ...r.scenes.map((s) => (s.speakers.has(c.name) ? "S" : s.silent.has(c.name) ? "X" : ""))]),
  ]);
}

// ------------------------------------------------------------------ PDF (Typst)

function tstr(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ") + '"';
}

/** A Typst document of the whole report, for PDF export. */
export function reportTypst(r: ProductionReport, meta: { title: string; author: string; paper: string; revision?: string }, date: string): string {
  const multi = new Set(r.scenes.map((s) => s.play)).size > 1;
  const cell = (s: string | number) => `[#${tstr(String(s))}]`;
  const out: string[] = [];
  const e = (s: string) => out.push(s);
  e(`#set document(title: ${tstr(`${meta.title} – Production report`)})`);
  e(`#set page(paper: ${tstr(meta.paper)}, margin: (x: 0.6in, y: 0.7in), footer: context align(center, text(size: 8pt, counter(page).display())), header: align(right, text(size: 8pt, ${tstr([meta.title, meta.revision, date].filter(Boolean).join("   ·   "))})))`);
  e(`#set text(font: "Courier Prime", size: 9pt)`);
  e(`#set table(stroke: (x, y) => (bottom: 0.4pt + luma(170)), inset: (x: 4pt, y: 3.5pt))`);
  e(`#show table.cell.where(y: 0): set text(weight: "bold")`);
  e(`#show heading: set block(above: 1.4em, below: 0.8em)`);
  e(`#align(center)[#text(size: 16pt, weight: "bold", ${tstr(meta.title || "Untitled")}) \\ #v(2pt) #text(size: 11pt, "Production report")${meta.author ? ` \\ #text(size: 9pt, ${tstr(meta.author)})` : ""}]`);
  e(`#v(8pt)`);
  // Summary
  const summary: [string, string][] = [
    ["Scenes", String(r.scenes.length)],
    ["Pages", r.measured ? formatEighths(r.eighths) : "—"],
    ["Speaking roles", String(r.cast.filter((c) => c.speeches).length)],
  ];
  if (r.cast.some((c) => !c.speeches)) summary.push(["Non-speaking", String(r.cast.filter((c) => !c.speeches).length)]);
  if (r.screenplay) {
    summary.push(["Locations", String(r.locations.length)]);
    summary.push(["Int / Ext", `${r.split.int} / ${r.split.ext}${r.split.both ? ` (+${r.split.both} both)` : ""}`]);
    summary.push(["Day / Night", `${r.split.day} / ${r.split.night}${r.split.other ? ` (+${r.split.other} other)` : ""}`]);
  }
  e(`#align(center, table(columns: ${summary.length}, align: center, stroke: none, ${summary.map(([k]) => cell(k)).join(", ")}, ${summary.map(([, v]) => `[#text(size: 12pt, ${tstr(v)})]`).join(", ")}))`);

  // Scene breakdown
  e(`= Scene breakdown`);
  const sh = ["#", ...(multi ? ["Play"] : []), r.screenplay ? "I/E" : "Act", r.screenplay ? "Location" : "Scene", ...(r.screenplay ? ["Time"] : []), "Page", "Length", "Cast"];
  const cols = ["auto", ...(multi ? ["auto"] : []), "auto", "1.4fr", ...(r.screenplay ? ["auto"] : []), "auto", "auto", "2fr"];
  e(`#table(columns: (${cols.join(", ")}), table.header(${sh.map(cell).join(", ")}),`);
  for (const s of r.scenes) {
    const castCell = [...[...s.speakers.keys()], ...[...s.silent].map((n) => `(${n})`)].join(", ");
    const row = [
      String(s.number),
      ...(multi ? [s.play] : []),
      r.screenplay ? s.slug.ie : s.act,
      r.screenplay ? s.slug.location || s.heading : s.heading,
      ...(r.screenplay ? [s.slug.time] : []),
      pageSpan(s),
      s.pages ? formatEighths(s.pages.eighths) : "",
      castCell,
    ];
    e(`  ${row.map(cell).join(", ")},`);
  }
  e(`)`);
  e(`#text(size: 8pt, "Lengths are in eighths of a page. Names in brackets are in the scene without speaking.")`);

  // Cast
  e(`= Cast`);
  e(`#table(columns: (1.4fr, auto, auto, auto, auto, auto, 2fr), align: (left, right, right, right, right, right, left), table.header(${["Character", "Speeches", "Words", "Scenes", "Pages", "First", "Scenes in"].map(cell).join(", ")}),`);
  for (const c of r.cast) {
    const scenesIn = c.silent ? `${c.speaking} + ${c.silent}` : String(c.speaking);
    e(`  ${[c.name, c.speeches, c.words, scenesIn, r.measured ? formatEighths(c.eighths) : "", c.firstPage, sceneList(c.scenes)].map(cell).join(", ")},`);
  }
  e(`)`);
  if (r.cast.some((c) => c.silent)) e(`#text(size: 8pt, "Scenes: speaking + non-speaking.")`);

  // Locations
  if (r.screenplay && r.locations.length) {
    e(`= Locations`);
    e(`#table(columns: (2fr, auto, 1fr, auto, auto, 1.4fr), align: (left, left, left, right, right, left), table.header(${["Location", "I/E", "Time", "Scenes", "Pages", "Scene numbers"].map(cell).join(", ")}),`);
    for (const l of r.locations) e(`  ${[l.location, l.ie.join(", "), l.times.join(", "), l.scenes.length, r.measured ? formatEighths(l.eighths) : "", sceneList(l.scenes)].map(cell).join(", ")},`);
    e(`)`);
  }

  // Plot: characters down, scenes across, in chunks that fit the page.
  if (r.cast.length && r.scenes.length) {
    e(`= ${r.screenplay ? "Cast by scene" : "Scene plot"}`);
    e(`#text(size: 8pt, "● speaks   ○ in the scene without speaking")`);
    const per = 22;
    for (let k = 0; k < r.scenes.length; k += per) {
      const chunk = r.scenes.slice(k, k + per);
      e(`#v(4pt)`);
      e(`#table(columns: (auto, ${chunk.map(() => "16pt").join(", ")}), align: (x, y) => if x == 0 { left } else { center }, stroke: (x, y) => (bottom: 0.4pt + luma(200), left: if x > 0 { 0.4pt + luma(220) } else { none }), inset: (x: 2pt, y: 3pt),`);
      e(`  table.header(${cell("")}, ${chunk.map((s) => `[#text(size: 7pt, ${tstr(sceneRef(s, multi))})]`).join(", ")}),`);
      for (const c of r.cast) {
        e(`  ${cell(c.name)}, ${chunk.map((s) => (s.speakers.has(c.name) ? "[●]" : s.silent.has(c.name) ? "[○]" : "[]")).join(", ")},`);
      }
      e(`)`);
    }
    if (multi) e(`#text(size: 8pt, "Scenes are numbered from 1 in each play.")`);
  }
  return out.join("\n") + "\n";
}
