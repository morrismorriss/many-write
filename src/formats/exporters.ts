// Text-based exports built in the UI: Fountain and Final Draft (.fdx) XML,
// plus the neutral block list the core turns into .docx and .epub.

import { blockText, serializeRuns, serializeScript, type Block, type Run } from "./markdown";
import { contdLines, essayDate, sceneBreakText, type ManuscriptItem, type ProjectMeta } from "./typst";
import type { Template } from "./templates";

const SCENE_RE = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;

export function toFountain(template: Template, meta: ProjectMeta, items: ManuscriptItem[]): string {
  const out: string[] = [];
  const tp = [`Title: ${meta.title || "Untitled"}`];
  if (meta.author) tp.push(`Author: ${meta.author}`);
  if (meta.contact) tp.push(`Contact: ${meta.contact.replace(/\n/g, "\n    ")}`);
  out.push(tp.join("\n"), "");
  for (const item of items) {
    if (item.kind === "matter") continue; // front/back matter is not part of a Fountain script
    if (item.kind === "play") {
      // A play of a collection: a page break and a section heading.
      out.push("===", "", `# ${item.title}`, "");
      continue;
    }
    if (item.kind === "folder") {
      out.push(`${"#".repeat(Math.min(item.depth, 3))} ${item.title}`, "");
      continue;
    }
    // Our script files are already Fountain except for headings ("## X").
    const md = serializeScript({ blocks: item.blocks, frontMatter: null });
    const fixed = md
      .split("\n")
      .map((l) => {
        const h = l.match(/^#{1,6}\s+(.*)$/);
        if (!h) return l;
        return SCENE_RE.test(h[1]) ? h[1].toUpperCase() : `.${h[1].toUpperCase()}`;
      })
      .join("\n");
    out.push(fixed.trimEnd(), "");
  }
  void template;
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function xml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

const FDX_TYPES: Record<string, string> = {
  scene_heading: "Scene Heading",
  action: "Action",
  direction: "Action",
  character: "Character",
  parenthetical: "Parenthetical",
  dialogue: "Dialogue",
  transition: "Transition",
};

function fdxText(runs: Run[], upper = false): string {
  if (!runs.length) return "<Text></Text>";
  return runs
    .map((r) => {
      const styles = [r.bold && "Bold", r.italic && "Italic", r.underline && "Underline"].filter(Boolean).join("+");
      const t = xml(upper ? r.text.toUpperCase() : r.text);
      return styles ? `<Text Style="${styles}">${t}</Text>` : `<Text>${t}</Text>`;
    })
    .join("");
}

export function toFdx(meta: ProjectMeta, items: ManuscriptItem[]): string {
  const paras: string[] = [];
  for (const item of items) {
    if (item.kind === "matter") continue;
    if (item.kind === "play") {
      paras.push(`    <Paragraph Type="New Act" StartsNewPage="Yes"><Text>${xml(item.title.toUpperCase())}</Text></Paragraph>`);
      continue;
    }
    if (item.kind === "folder") {
      paras.push(`    <Paragraph Type="New Act"><Text>${xml(item.title.toUpperCase())}</Text></Paragraph>`);
      continue;
    }
    for (const b of item.blocks) {
      if (!blockText(b).trim()) continue;
      const type = FDX_TYPES[b.type] ?? "General";
      const upper = b.type === "scene_heading" || b.type === "character" || b.type === "transition";
      paras.push(`    <Paragraph Type="${type}">${fdxText(b.runs, upper)}</Paragraph>`);
    }
  }
  const tp = [
    `      <Paragraph Alignment="Center" Type="Title Page"><Text>${xml((meta.title || "Untitled").toUpperCase())}</Text></Paragraph>`,
    `      <Paragraph Alignment="Center" Type="Title Page"><Text></Text></Paragraph>`,
    `      <Paragraph Alignment="Center" Type="Title Page"><Text>by</Text></Paragraph>`,
    `      <Paragraph Alignment="Center" Type="Title Page"><Text>${xml(meta.author || "")}</Text></Paragraph>`,
    ...(meta.contact || "")
      .split("\n")
      .filter(Boolean)
      .map((l) => `      <Paragraph Alignment="Left" Type="Title Page"><Text>${xml(l)}</Text></Paragraph>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
${paras.join("\n")}
  </Content>
  <TitlePage>
    <Content>
${tp.join("\n")}
    </Content>
  </TitlePage>
</FinalDraft>
`;
}

export interface ExportBlock {
  kind: string;
  runs: Run[];
}

export interface ExportDoc {
  title: string;
  author: string;
  template: string;
  lang: string;
  id: string;
  blocks: ExportBlock[];
  /** Essays: "mla" or "chicago". */
  style?: string;
  /** Essays: the words before the page number in the running header (MLA: the author's surname). */
  runningHead?: string;
}

/** Essay opening: MLA's heading block and title, or Chicago's title page or title and byline. */
function essayOpening(meta: ProjectMeta): ExportBlock[] {
  const e = meta.essay ?? { style: "mla" as const, instructor: "", course: "", date: "" };
  const date = e.date.trim() || essayDate(e.style);
  const title = meta.title || "Untitled";
  const line = (kind: string, text: string): ExportBlock => ({ kind, runs: [{ text }] });
  if (e.style === "mla") {
    return [...[meta.author, e.instructor, e.course, date].filter((l) => l.trim()).map((l) => line("essay_heading", l)), line("essay_title", title)];
  }
  const details = [meta.author, e.course, e.instructor, date].filter((l) => l.trim());
  if (meta.titlePage) {
    return [line("essay_cover_title", title), ...details.map((l, i) => line(i === 0 ? "essay_cover_details" : "essay_cover_line", l)), line("page_break", "")];
  }
  return [line("essay_title", title), ...details.map((l) => line("essay_byline", l))];
}

/** Flatten the manuscript for the .docx / .epub writers in the core. */
export function toExportDoc(template: Template, meta: ProjectMeta, items: ManuscriptItem[], projectId: string): ExportDoc {
  const blocks: ExportBlock[] = [];
  const script = template.mode === "script";
  const essay = template.id === "essay";
  if (essay) blocks.push(...essayOpening(meta));
  if (meta.titlePage && (script || template.id === "book")) {
    blocks.push({ kind: "title", runs: [{ text: meta.title || "Untitled" }] });
    if (meta.author) blocks.push({ kind: script ? "character" : "subheading", runs: [{ text: `by ${meta.author}` }] });
  }
  /** An empty paragraph keeps its place as a blank line (a no-break space, so Word and e-readers don't drop it). */
  const blankLine: Run[] = [{ text: "\u00a0" }];
  const keptBlank = (b: Block, i: number, blocks: Block[]) =>
    (b.type === "paragraph" || b.type === "centered") && !blockText(b).trim() && blocks.slice(i + 1).some((x) => blockText(x).trim() || x.type === "image");
  let newPage = false;
  for (const item of items) {
    if (item.kind === "play") {
      // A play of a collection: a new page with its title.
      blocks.push({ kind: "page_break", runs: [] });
      blocks.push({ kind: "title", runs: [{ text: item.title }] });
      if (meta.author) blocks.push({ kind: script ? "character" : "subheading", runs: [{ text: `by ${meta.author}` }] });
      blocks.push({ kind: "page_break", runs: [] });
      newPage = true;
      continue;
    }
    if (item.kind === "folder") {
      blocks.push({ kind: "folder_heading", runs: [{ text: item.title }] });
      newPage = true;
      continue;
    }
    if (item.kind === "matter") {
      blocks.push({ kind: "matter_title", runs: [{ text: item.title }] });
      item.blocks.forEach((b, i, all) => {
        if (keptBlank(b, i, all)) blocks.push({ kind: b.type === "paragraph" ? "matter_paragraph" : b.type, runs: blankLine });
        else if (blockText(b).trim() || b.type === "scene_break") blocks.push({ kind: b.type === "paragraph" ? "matter_paragraph" : b.type, runs: b.runs });
      });
      newPage = true;
      continue;
    }
    if (template.id === "book") blocks.push({ kind: "chapter", runs: [{ text: item.title }] });
    // Scripts: each scene on a new page (not straight after an act heading, which starts one).
    if (script && meta.sceneNewPage && !newPage && blocks.length) blocks.push({ kind: "page_break", runs: [] });
    newPage = false;
    const contd = script && meta.autoContd ? contdLines(item.blocks) : null;
    let prevEmpty = false;
    let num = 0;
    for (const [i, b] of item.blocks.entries()) {
      const empty = !blockText(b).trim();
      if (template.mode === "poem") {
        if (empty) {
          if (!prevEmpty) blocks.push({ kind: "stanza_break", runs: [] });
          prevEmpty = true;
          continue;
        }
        prevEmpty = false;
        blocks.push({ kind: b.type === "title" ? "title" : "line", runs: b.runs });
        continue;
      }
      if (!script && keptBlank(b, i, item.blocks)) {
        blocks.push({ kind: b.type, runs: blankLine });
        continue;
      }
      if (empty && b.type !== "scene_break" && b.type !== "divider") continue;
      if (contd?.has(i)) {
        blocks.push({ kind: b.type, runs: [{ text: `${blockText(b).toUpperCase()} (CONT'D)` }] });
        continue;
      }
      if (template.mode === "notes") {
        num = b.type === "numbered" ? num + 1 : 0;
        const k = exportKind(b, num);
        blocks.push({ kind: k.kind, runs: k.prefix ? [{ text: k.prefix }, ...b.runs] : b.runs });
        continue;
      }
      if (b.type === "scene_break" && meta.sceneBreak && meta.sceneBreak.style !== "asterisks") {
        blocks.push({ kind: b.type, runs: [{ text: sceneBreakText(meta.sceneBreak.style) }] });
        continue;
      }
      blocks.push({ kind: b.type, runs: normalizeRuns(b) });
    }
  }
  const doc: ExportDoc = { title: meta.title || "Untitled", author: meta.author, template: template.id, lang: "en", id: `urn:uuid:${projectId}`, blocks };
  if (essay) {
    doc.style = meta.essay?.style ?? "mla";
    doc.runningHead = doc.style === "mla" ? (meta.author.trim().split(/\s+/).pop() ?? "") : "";
  }
  return doc;
}

/** Notion-style blocks (Document format) as plain styles Word and e-readers understand. */
function exportKind(b: Block, n: number): { kind: string; prefix?: string } {
  switch (b.type) {
    case "title":
      return { kind: "heading" };
    case "bullet":
      return { kind: "list", prefix: "•\u00a0\u00a0" };
    case "numbered":
      return { kind: "list", prefix: `${n}.\u00a0\u00a0` };
    case "todo":
      return { kind: "list", prefix: "☐\u00a0\u00a0" };
    case "todo_done":
      return { kind: "list", prefix: "☑\u00a0\u00a0" };
    case "callout":
      return { kind: "quote" };
    case "divider":
      return { kind: "scene_break" };
    default:
      return { kind: b.type };
  }
}

function normalizeRuns(b: Block): Run[] {
  if (b.type === "character" || b.type === "transition") return [{ text: blockText(b).toUpperCase() }];
  return b.runs;
}

/** Plain text of a document for quick previews (binder tooltips, word counts). */
export function docToPlain(blocks: Block[]): string {
  return blocks.map((b) => serializeRuns(b.runs, { marks: false })).join("\n");
}

export function wordCount(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) n += (blockText(b).match(/\S+/g) ?? []).length;
  return n;
}
