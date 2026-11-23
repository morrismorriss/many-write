// Importing other formats as new Many Write projects. The original file is
// only read. Word, PDF and RTF are parsed by the core; Final Draft and
// Fountain here.

import { call, fsApi, join } from "../lib/backend";
import { blockText, looksLikeCue, parseScript, serializeDoc, adaptScriptTypes, type Block, type Run } from "../formats/markdown";
import { TEMPLATES, type TemplateId } from "../formats/templates";
import { desiredName, emptyProject, newId, rootOf, serializeProject, slugify, type BinderNode, type Role } from "./model";
import { projectReadme } from "./readme";

export type ImportFormat = "docx" | "fdx" | "fountain" | "pdf" | "markdown" | "rtf";

export function formatOf(path: string): ImportFormat | null {
  const ext = path.toLowerCase().replace(/\/+$/, "").split(".").pop();
  return (
    ({ docx: "docx", fdx: "fdx", fountain: "fountain", spmd: "fountain", pdf: "pdf", md: "markdown", markdown: "markdown", txt: "markdown", rtf: "rtf" } as const)[
      ext ?? ""
    ] ?? null
  );
}

export const FORMAT_NAMES: Record<ImportFormat, string> = {
  docx: "Word document",
  fdx: "Final Draft script",
  fountain: "Fountain script",
  pdf: "PDF",
  markdown: "Markdown / text",
  rtf: "Rich text (RTF)",
};

/** A document or folder to create in the new project. */
export interface ImportNode {
  kind: "folder" | "doc";
  title: string;
  blocks?: Block[];
  notes?: string;
  children?: ImportNode[];
}

export interface ImportPlan {
  title: string;
  template: TemplateId;
  manuscript: ImportNode[];
  research: ImportNode[];
  /** Optional other sections. */
  characters?: ImportNode[];
  front?: ImportNode[];
  back?: ImportNode[];
  /** A sentence for the import dialog: what was found. */
  summary: string;
  /** Markdown/text imports: the file's text, copied as the single document. */
  raw?: string;
  /** Prose split into chapters at top-level headings, used when the writer picks Book. */
  chapters?: ImportNode[];
}

interface Para {
  style: string;
  runs: Run[];
}

const text = (p: Para) => p.runs.map((r) => r.text).join("");
const fileTitle = (path: string) =>
  (path.replace(/\/+$/, "").split("/").pop() ?? "Imported").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported";

// ------------------------------------------------------------- scripts

const SCENE_RE = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;

/** Split a script into scenes at each scene heading. */
function splitScenes(blocks: Block[]): ImportNode[] {
  const scenes: ImportNode[] = [];
  let cur: ImportNode | null = null;
  for (const b of blocks) {
    if (b.type === "scene_heading" || !cur) {
      const t = b.type === "scene_heading" ? blockText(b).trim() : "Opening";
      cur = { kind: "doc", title: sceneTitle(t, scenes.length + 1), blocks: [] };
      scenes.push(cur);
    }
    cur.blocks!.push(b);
  }
  return scenes;
}

function sceneTitle(heading: string, n: number): string {
  const t = heading.replace(/\s+/g, " ").trim();
  if (!t) return `Scene ${n}`;
  // "INT. KITCHEN - NIGHT" -> "Kitchen - night"
  const s = t.replace(SCENE_RE, "").replace(/^\.\s*/, "").trim() || t;
  return (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).slice(0, 60);
}

/** Script lines (paragraph per element, no blank lines) to script blocks, by shape. */
function scriptFromLines(lines: { text: string; gapBefore: boolean; runs?: Run[] }[]): Block[] {
  const blocks: Block[] = [];
  let inSpeech = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.text.trim();
    if (!t) {
      inSpeech = false;
      continue;
    }
    const runs = l.runs ?? [{ text: t }];
    const next = lines[i + 1];
    if (l.gapBefore) inSpeech = false;
    if (inSpeech) {
      if (/^\(.*\)$/.test(t)) blocks.push({ type: "parenthetical", runs });
      else {
        const prev = blocks[blocks.length - 1];
        // Wrapped dialogue lines join the same speech.
        if (prev?.type === "dialogue" && !l.gapBefore) prev.runs = [...prev.runs, { text: " " }, ...runs];
        else blocks.push({ type: "dialogue", runs });
      }
      continue;
    }
    if (SCENE_RE.test(t)) blocks.push({ type: "scene_heading", runs: [{ text: t }] });
    else if (/^[A-Z0-9 .'’-]+TO:$/.test(t) || /^(FADE (IN|OUT)|BLACKOUT|CURTAIN|END OF (ACT|PLAY))/i.test(t) && t === t.toUpperCase()) blocks.push({ type: "transition", runs: [{ text: t }] });
    else if (looksLikeCue(t) && next && next.text.trim() && !next.gapBefore) {
      blocks.push({ type: "character", runs: [{ text: t.replace(/\s*\((CONT['’]D|CONTINUED)\)\s*$/i, "") }] });
      inSpeech = true;
    } else {
      const prev = blocks[blocks.length - 1];
      if (prev && (prev.type === "direction" || prev.type === "action") && !l.gapBefore) prev.runs = [...prev.runs, { text: " " }, ...runs];
      else blocks.push({ type: "direction", runs });
    }
  }
  return blocks;
}

/** Enough evidence that some text is a script: several cues, or a couple plus a slugline. */
function looksLikeScript(lines: string[]): boolean {
  const cues = cueCount(lines);
  return cues >= 5 || (cues >= 2 && lines.some((l) => SCENE_RE.test(l.trim())));
}

function cueCount(lines: string[]): number {
  let n = 0;
  for (let i = 0; i + 1 < lines.length; i++) if (looksLikeCue(lines[i]) && lines[i].trim().length < 40 && lines[i + 1].trim() && !looksLikeCue(lines[i + 1])) n++;
  return n;
}

function scriptTemplate(blocks: Block[]): TemplateId {
  return blocks.some((b) => b.type === "scene_heading" && SCENE_RE.test(blockText(b))) ? "screenplay" : "stage-play";
}

function finishScript(title: string, blocks: Block[], summary: string): ImportPlan {
  const template = scriptTemplate(blocks);
  const adapted = adaptScriptTypes({ blocks, frontMatter: null }, template === "screenplay" ? "action" : "direction").blocks;
  return { title, template, manuscript: splitScenes(adapted), research: [], summary };
}

// ---------------------------------------------------------------- prose

/** Prose paragraphs to chapters, split at top-level headings. */
function proseChapters(blocks: (Block & { level?: number })[]): ImportNode[] {
  const chapters: ImportNode[] = [];
  let cur: ImportNode | null = null;
  for (const b of blocks) {
    if (b.level === 1 || !cur) {
      cur = { kind: "doc", title: b.level === 1 ? blockText(b).trim().slice(0, 60) || `Chapter ${chapters.length + 1}` : "Opening", blocks: [] };
      chapters.push(cur);
      if (b.level === 1) continue;
    }
    cur.blocks!.push(b);
  }
  return chapters;
}

// ---------------------------------------------------------------- formats

const FDX_MAP: Record<string, Block["type"]> = {
  "Scene Heading": "scene_heading",
  Action: "direction",
  Character: "character",
  Parenthetical: "parenthetical",
  Dialogue: "dialogue",
  Transition: "transition",
  Shot: "scene_heading",
  Lyrics: "lyric",
  Lyric: "lyric",
  Song: "song",
  General: "direction",
};

export function importFdx(xml: string, path: string): ImportPlan {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("This .fdx file is not valid XML.");
  const paras = [...doc.querySelectorAll("FinalDraft > Content > Paragraph")];
  const blocks: Block[] = [];
  for (const p of paras) {
    const type = FDX_MAP[p.getAttribute("Type") ?? ""] ?? "direction";
    const runs: Run[] = [...p.querySelectorAll(":scope > Text")].map((t) => {
      const style = t.getAttribute("Style") ?? "";
      return { text: t.textContent ?? "", ...(style.includes("Bold") && { bold: true }), ...(style.includes("Italic") && { italic: true }), ...(style.includes("Underline") && { underline: true }) };
    });
    if (!runs.map((r) => r.text).join("").trim()) continue;
    blocks.push({ type, runs });
  }
  const tp = [...doc.querySelectorAll("TitlePage Paragraph")].map((p) => p.textContent?.trim() ?? "").filter(Boolean);
  const title = tp[0] && tp[0].length < 80 ? titleCase(tp[0]) : fileTitle(path);
  return finishScript(title, blocks, `${blocks.length} script lines from Final Draft.`);
}

export function importFountain(src: string, path: string): ImportPlan {
  let body = src.replace(/\r\n?/g, "\n");
  let title = fileTitle(path);
  // Title page: "Key: value" lines at the very top, ended by a blank line.
  const tpEnd = body.indexOf("\n\n");
  if (/^[A-Za-z ]+:/.test(body) && tpEnd > 0) {
    const tp = body.slice(0, tpEnd);
    const m = tp.match(/^Title:\s*(.*)$/im);
    if (m && m[1].trim()) title = m[1].trim().replace(/[_*]/g, "");
    body = body.slice(tpEnd + 2);
  }
  // Fountain sections (#) and synopses (=) are outline notes; drop them.
  body = body.replace(/^#+ .*$/gm, "").replace(/^= .*$/gm, "").replace(/\[\[[\s\S]*?\]\]/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = parseScript(body).blocks;
  return finishScript(title, blocks, `${blocks.length} script lines from Fountain.`);
}

export async function importDocx(path: string): Promise<ImportPlan> {
  const paras = await call<Para[]>("import.docx", { path });
  const style = (p: Para) => p.style.toLowerCase();
  const scriptStyles = ["character", "dialogue", "scene heading", "parenthetical", "action", "transition", "direction", "stage direction", "lyric", "lyrics", "song"];
  const scripty = paras.filter((p) => scriptStyles.includes(style(p))).length > paras.length * 0.3;
  if (scripty) {
    const blocks: Block[] = [];
    for (const p of paras) {
      if (!text(p).trim()) continue;
      const s = style(p);
      const type: Block["type"] = s === "scene heading" ? "scene_heading" : s === "character" ? "character" : s === "dialogue" ? "dialogue" : s === "parenthetical" ? "parenthetical" : s === "transition" ? "transition" : s === "lyric" || s === "lyrics" ? "lyric" : s === "song" ? "song" : "direction";
      blocks.push({ type, runs: p.runs });
    }
    return finishScript(fileTitle(path), blocks, `${blocks.length} script paragraphs from Word.`);
  }
  // Word files written as scripts without styles: look for cue patterns.
  const lines = paras.map((p) => text(p));
  if (looksLikeScript(lines)) {
    const blocks = scriptFromLines(paras.map((p) => ({ text: text(p), gapBefore: false, runs: p.runs })));
    return finishScript(fileTitle(path), blocks, `A script (found ${cueCount(lines)} character cues) from Word.`);
  }
  const blocks: (Block & { level?: number })[] = [];
  let title = fileTitle(path);
  for (const p of paras) {
    const t = text(p).trim();
    if (!t) continue;
    const s = style(p);
    if (s === "title") {
      title = t;
      continue;
    }
    const h = s === "chapter" ? ["", "1"] : s.match(/^heading (\d)/);
    if (h) blocks.push({ type: h[1] === "1" ? "heading" : h[1] === "2" ? "heading" : "subheading", runs: p.runs, level: Number(h[1]) });
    else if (/quote/.test(s)) blocks.push({ type: "quote", runs: p.runs });
    else if (/^(\*\s*){3}$|^#$/.test(t)) blocks.push({ type: "scene_break", runs: [] });
    else blocks.push({ type: "paragraph", runs: p.runs.map((r) => ({ ...r, text: r.text.replace(/\t/g, " ") })) });
  }
  // A Word file opens as one Document; choosing Book splits it into chapters at its top headings.
  const whole: Block[] = blocks.map(({ level, ...b }) => (level === 1 ? { ...b, type: "title" } : b));
  const chapters = proseChapters(blocks);
  return {
    title,
    template: "document",
    manuscript: [{ kind: "doc", title, blocks: whole }],
    chapters: chapters.length > 1 ? chapters : undefined,
    research: [],
    summary: `${blocks.length} paragraphs${chapters.length > 1 ? ` (${chapters.length} chapters if imported as a Book)` : ""} from Word.`,
  };
}

interface PdfLine {
  page: number;
  x: number;
  y: number;
  size: number;
  text: string;
  pageWidth: number;
  pageHeight: number;
}

export async function importPdf(path: string): Promise<ImportPlan> {
  const all = await call<PdfLine[]>("import.pdf", { path });
  if (!all.length) throw new Error("No text was found in this PDF. If it is a scan, it needs text recognition (OCR) first.");
  // Drop page numbers and running headers/footers.
  const lines = all.filter((l) => !(/^\d+[A-Z]?\.?$/.test(l.text.trim()) && (l.y < 80 || l.y > l.pageHeight - 80)) && !/^\(?(MORE|CONTINUED)\)?$/i.test(l.text.trim()) && !/^CONTINUED:?(\s*\(\d+\))?$/.test(l.text.trim()));
  // Typical line spacing, to tell a blank line from a wrapped line.
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) if (lines[i].page === lines[i - 1].page) gaps.push(lines[i].y - lines[i - 1].y);
  gaps.sort((a, b) => a - b);
  const step = gaps[Math.floor(gaps.length / 4)] || 12;
  const withGaps = lines.map((l, i) => ({
    ...l,
    gapBefore: i === 0 || l.page !== lines[i - 1].page ? true : l.y - lines[i - 1].y > step * 1.5,
  }));
  const texts = lines.map((l) => l.text);
  const title = fileTitle(path);
  if (looksLikeScript(texts)) {
    // A page break inside a speech is not a new block.
    const fixed = withGaps.map((l, i) => (i > 0 && l.page !== withGaps[i - 1].page ? { ...l, gapBefore: false } : l));
    // But skip a title page: everything on page 1 if page 1 has few lines and no cues.
    const p1 = fixed.filter((l) => l.page === 1);
    const body = p1.length < 12 && cueCount(p1.map((l) => l.text)) === 0 && fixed.some((l) => l.page > 1) ? fixed.filter((l) => l.page > 1) : fixed;
    const blocks = scriptFromLines(body.map((l) => ({ text: l.text, gapBefore: l.gapBefore })));
    return finishScript(title, blocks, `A script from a ${all[all.length - 1].page}-page PDF (${blocks.length} lines).`);
  }
  // Prose: a gap or an indented first line starts a paragraph.
  const left = Math.min(...lines.map((l) => l.x));
  const paras: string[] = [];
  for (const l of withGaps) {
    const indented = l.x > left + 8;
    if (!paras.length || l.gapBefore || indented) paras.push(l.text.trim());
    else {
      const prev = paras[paras.length - 1];
      paras[paras.length - 1] = /[a-z]-$/.test(prev) && /^[a-z]/.test(l.text.trim()) ? prev.slice(0, -1) + l.text.trim() : `${prev} ${l.text.trim()}`;
    }
  }
  const blocks = paras.map((p) => ({ type: "paragraph" as const, runs: [{ text: p }] }));
  return { title, template: "document", manuscript: [{ kind: "doc", title, blocks }], research: [], summary: `${paras.length} paragraphs from a ${all[all.length - 1].page}-page PDF.` };
}

export async function importRtf(path: string): Promise<ImportPlan> {
  const paras = await call<Para[]>("import.rtf", { path });
  const lines = paras.map(text);
  if (looksLikeScript(lines)) return finishScript(fileTitle(path), scriptFromLines(paras.map((p) => ({ text: text(p), gapBefore: false, runs: p.runs }))), "A script from rich text.");
  const blocks: Block[] = paras.filter((p) => text(p).trim()).map((p) => ({ type: "paragraph", runs: p.runs }));
  return { title: fileTitle(path), template: "document", manuscript: [{ kind: "doc", title: fileTitle(path), blocks }], research: [], summary: `${blocks.length} paragraphs from rich text.` };
}

export async function planImport(path: string): Promise<ImportPlan> {
  const fmt = formatOf(path);
  switch (fmt) {
    case "fdx":
      return importFdx((await fsApi.read(path)).content, path);
    case "fountain":
      return importFountain((await fsApi.read(path)).content, path);
    case "docx":
      return importDocx(path);
    case "pdf":
      return importPdf(path);
    case "rtf":
      return importRtf(path);
    case "markdown": {
      const src = (await fsApi.read(path)).content;
      const lines = src.split("\n");
      if (looksLikeScript(lines)) return importFountain(src, path);
      return { title: fileTitle(path), template: "document", manuscript: [{ kind: "doc", title: fileTitle(path), blocks: [] }], research: [], summary: "A markdown or text file.", raw: src };
    }
    default:
      throw new Error("Many Write can import .docx, .fdx, .fountain, .pdf, .rtf and .md/.txt files.");
  }
}

/** Convert a plan's documents when the writer picks a different format (e.g. screenplay -> stage play). */
function blocksFor(blocks: Block[], template: TemplateId): Block[] {
  const t = TEMPLATES[template];
  if (t.mode === "script") {
    const action = template === "screenplay" ? "action" : "direction";
    return blocks.map((b) => (b.type === "direction" || b.type === "action" || b.type === "paragraph" ? { ...b, type: action } : b));
  }
  // Into prose: keep every block the format has; anything else becomes a paragraph.
  const keep = new Set(t.elements.map((e) => e.type));
  if (keep.has("todo")) keep.add("todo_done");
  return blocks.map((b) => (keep.has(b.type) ? b : b.type === "title" && keep.has("heading") ? { ...b, type: "heading" } : { ...b, type: "paragraph" }));
}

/** Write a new project folder from an import plan; returns its root. */
export async function createFromImport(location: string, plan: ImportPlan, template: TemplateId, author: string): Promise<string> {
  const t = TEMPLATES[template];
  const root = join(location, plan.title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Imported");
  if (await fsApi.exists(join(root, "project.json"))) throw new Error(`There is already a project in ${root}.`);
  const data = emptyProject(plan.title, template, author, t.titlePageDefault);
  const raw = plan.raw;
  const write = async (parentDir: string, parent: BinderNode, nodes: ImportNode[], role: Role) => {
    const taken = new Set<string>();
    for (const [i, n] of nodes.entries()) {
      const node: BinderNode = { id: newId(), kind: n.kind, title: n.title || "Untitled", file: "" };
      node.file = desiredName(node, i, role === "manuscript" || role === "front" || role === "back", taken);
      (parent.children ??= []).push(node);
      const path = join(parentDir, node.file);
      if (n.kind === "folder") {
        node.children = [];
        await fsApi.mkdir(path);
        await write(path, node, n.children ?? [], role);
      } else {
        const mode = role === "manuscript" ? t.mode : role === "front" || role === "back" ? "prose" : "notes";
        const content = raw !== undefined && role === "manuscript" ? raw : serializeDoc({ blocks: role === "manuscript" ? blocksFor(n.blocks ?? [], template) : (n.blocks ?? []), frontMatter: null }, mode);
        await fsApi.write(path, content, null, true);
      }
      if (n.notes) {
        node.notes = `notes/${slugify(node.title)}-${node.id.slice(0, 6)}.md`;
        await fsApi.write(join(root, node.notes), n.notes + "\n", null, true);
      }
    }
  };
  for (const r of ["front-matter", "manuscript", "back-matter", "characters", "research", "archive", "notes"]) await fsApi.mkdir(join(root, r));
  const manuscript = template === "book" && plan.chapters ? plan.chapters : plan.manuscript;
  await write(join(root, "manuscript"), rootOf(data, "manuscript"), manuscript, "manuscript");
  await write(join(root, "research"), rootOf(data, "research"), plan.research, "research");
  await write(join(root, "characters"), rootOf(data, "characters"), plan.characters ?? [], "characters");
  await write(join(root, "front-matter"), rootOf(data, "front"), plan.front ?? [], "front");
  await write(join(root, "back-matter"), rootOf(data, "back"), plan.back ?? [], "back");
  await fsApi.write(join(root, "README.md"), projectReadme(plan.title, t), null, true);
  await fsApi.write(join(root, "project.json"), serializeProject(data), null);
  return root;
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}
