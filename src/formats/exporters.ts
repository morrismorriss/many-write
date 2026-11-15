// Text-based exports built in the UI: Fountain and Final Draft (.fdx) XML,
// plus the neutral block list the core turns into .docx and .epub.

import { blockText, serializeRuns, serializeScript, type Block, type Run } from "./markdown";
import type { ManuscriptItem, ProjectMeta } from "./typst";
import type { Template } from "./templates";

const SCENE_RE = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;

export function toFountain(template: Template, meta: ProjectMeta, items: ManuscriptItem[]): string {
  const out: string[] = [];
  const tp = [`Title: ${meta.title || "Untitled"}`];
  if (meta.author) tp.push(`Author: ${meta.author}`);
  if (meta.contact) tp.push(`Contact: ${meta.contact.replace(/\n/g, "\n    ")}`);
  out.push(tp.join("\n"), "");
  for (const item of items) {
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
}

/** Flatten the manuscript for the .docx / .epub writers in the core. */
export function toExportDoc(template: Template, meta: ProjectMeta, items: ManuscriptItem[], projectId: string): ExportDoc {
  const blocks: ExportBlock[] = [];
  const script = template.mode === "script";
  if (meta.titlePage && (script || template.id === "book")) {
    blocks.push({ kind: "title", runs: [{ text: meta.title || "Untitled" }] });
    if (meta.author) blocks.push({ kind: script ? "character" : "subheading", runs: [{ text: `by ${meta.author}` }] });
  }
  for (const item of items) {
    if (item.kind === "folder") {
      blocks.push({ kind: "folder_heading", runs: [{ text: item.title }] });
      continue;
    }
    if (template.id === "book") blocks.push({ kind: "chapter", runs: [{ text: item.title }] });
    let prevEmpty = false;
    for (const b of item.blocks) {
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
      if (empty && b.type !== "scene_break") continue;
      blocks.push({ kind: b.type, runs: normalizeRuns(b) });
    }
  }
  return { title: meta.title || "Untitled", author: meta.author, template: template.id, lang: "en", id: `urn:uuid:${projectId}`, blocks };
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
