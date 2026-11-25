// Text-based exports built in the UI: Fountain and Final Draft (.fdx) XML,
// plus the neutral block list the core turns into .docx and .epub.

import { blockText, serializeRuns, serializeScript, type Block, type Note, type Run } from "./markdown";
import { contdLines, essayDate, sceneBreakText, type ManuscriptItem, type ProjectMeta } from "./typst";
import { isListType, listNumbers, MAX_INDENT, type Template } from "./templates";
import { findTitlePages, titlePageParts, type MatterItem } from "./titlepage";

const SCENE_RE = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;

export function toFountain(template: Template, meta: ProjectMeta, items: ManuscriptItem[]): string {
  const out: string[] = [];
  const tp = [`Title: ${meta.title || "Untitled"}`];
  // Fountain titles may run onto indented lines; the subtitle is the second line.
  if (meta.subtitle?.trim()) tp[0] = `Title:\n    ${meta.title || "Untitled"}\n    ${meta.subtitle.trim()}`;
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
        // A song's title is centred text in Fountain; its "~" lyrics are already Fountain.
        const song = l.match(/^~~\s*(.*)$/);
        if (song) return `> ${song[1].toUpperCase()} <`;
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
      // Musicals: Final Draft has no song elements, so a song title is centred bold
      // action and lyrics are dialogue in italics (Final Draft's own lyric style).
      if (b.type === "song") {
        paras.push(`    <Paragraph Type="Action" Alignment="Center">${fdxText(b.runs.map((r) => ({ ...r, bold: true, underline: true })), true)}</Paragraph>`);
        continue;
      }
      if (b.type === "lyric") {
        paras.push(`    <Paragraph Type="Dialogue">${fdxText(b.runs.map((r) => ({ ...r, italic: true })))}</Paragraph>`);
        continue;
      }
      const type = FDX_TYPES[b.type] ?? "General";
      const upper = b.type === "scene_heading" || b.type === "character" || b.type === "transition";
      paras.push(`    <Paragraph Type="${type}">${fdxText(b.runs, upper)}</Paragraph>`);
    }
  }
  const typedPage = meta.titlePage ? findTitlePages(items).project : undefined;
  const tpLine = (align: string, b: Block) => `      <Paragraph Alignment="${align}" Type="Title Page">${blockText(b).trim() ? fdxText(b.runs.filter((r) => !r.note)) : "<Text></Text>"}</Paragraph>`;
  const typedTp = typedPage && titlePageParts(typedPage.blocks);
  const tp = typedTp ? [...typedTp.middle.map(({ block }) => tpLine("Center", block)), ...typedTp.bottom.map(({ block }) => tpLine("Left", block))] : [
    `      <Paragraph Alignment="Center" Type="Title Page"><Text>${xml((meta.title || "Untitled").toUpperCase())}</Text></Paragraph>`,
    ...(meta.subtitle?.trim() ? [`      <Paragraph Alignment="Center" Type="Title Page"><Text>${xml(meta.subtitle.trim())}</Text></Paragraph>`] : []),
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
  /** The e-book's table of contents entry, for a block that prints nothing. */
  label?: string;
  /** List items: how many levels deep the item is nested. */
  indent?: number;
  /** Scripts: the speaker's column when two to six characters speak at once (0 = leftmost). */
  sim?: number;
}

export interface ExportDoc {
  title: string;
  author: string;
  template: string;
  lang: string;
  id: string;
  blocks: ExportBlock[];
  /** Essays: "mla", "chicago" (author–date) or "chicago-notes". */
  style?: string;
  /** Essays: the words before the page number in the running header (MLA: the author's surname). */
  runningHead?: string;
  /** Chicago notes: "footnotes" or "endnotes". */
  notePlacement?: string;
  /** Chicago notes: the note texts, keyed by the ids on the note runs. */
  notes?: ExportNote[];
}

export interface ExportNote {
  id: string;
  runs: Run[];
}

/** Essay opening: MLA's heading block and title, or Chicago's title page or title and byline. */
function essayOpening(meta: ProjectMeta): ExportBlock[] {
  const e = meta.essay ?? { style: "mla" as const, instructor: "", course: "", date: "" };
  const date = e.date.trim() || essayDate(e.style);
  const title = (meta.title || "Untitled") + (meta.subtitle?.trim() ? `: ${meta.subtitle.trim()}` : "");
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
  // The export is one document, so notes from every file share one numbering space.
  const notes: ExportNote[] = [];
  const noteIds = new Map<string, string>();
  const exportRuns = (runs: Run[], owner: { id: string; notes?: Note[] }): Run[] =>
    runs.flatMap((r) => {
      if (!r.note) return [r];
      const key = `${owner.id}:${r.note}`;
      let id = noteIds.get(key);
      if (!id) {
        const note = owner.notes?.find((n) => n.id === r.note);
        if (!note) return [];
        id = `n${notes.length + 1}`;
        noteIds.set(key, id);
        notes.push({ id, runs: note.runs.filter((x) => !x.note) });
      }
      return [{ ...r, note: id }];
    });
  /** An empty paragraph keeps its place as a blank line (a no-break space, so Word and e-readers don't drop it). */
  const blankLine: Run[] = [{ text: "\u00a0" }];
  if (essay) blocks.push(...essayOpening(meta));
  // Scripts: title pages the writer typed replace the automatic ones.
  const typed = script ? findTitlePages(items) : { project: undefined, plays: new Map<string, MatterItem>() };
  const typedPages = new Set<ManuscriptItem>([...(typed.project ? [typed.project] : []), ...typed.plays.values()]);
  const typedTitle = (page: MatterItem) => {
    const { middle, bottom } = titlePageParts(page.blocks);
    middle.forEach(({ block }, i) => {
      const filled = !!blockText(block).trim();
      blocks.push({ kind: i === 0 ? "title" : "centered", runs: filled ? block.runs.filter((r) => !r.note) : blankLine });
    });
    for (const { block } of bottom) blocks.push({ kind: "matter_paragraph", runs: blockText(block).trim() ? block.runs.filter((r) => !r.note) : blankLine });
    blocks.push({ kind: "page_break", runs: [] });
  };
  if (meta.titlePage && script && typed.project) {
    typedTitle(typed.project);
  } else if (meta.titlePage && (script || template.id === "book")) {
    blocks.push({ kind: "title", runs: [{ text: meta.title || "Untitled" }] });
    if (meta.subtitle?.trim()) blocks.push({ kind: script ? "centered" : "subheading", runs: [{ text: meta.subtitle.trim() }] });
    if (meta.author) blocks.push({ kind: script ? "character" : "subheading", runs: [{ text: `by ${meta.author}` }] });
    // A script's title page is a page of its own (a book's first chapter already starts a new page).
    if (script) blocks.push({ kind: "page_break", runs: [] });
  }
  const keptBlank = (b: Block, i: number, blocks: Block[]) =>
    (b.type === "paragraph" || b.type === "centered") && !blockText(b).trim() && blocks.slice(i + 1).some((x) => blockText(x).trim() || x.type === "image");
  let newPage = blocks.at(-1)?.kind === "page_break";
  // Which formats start every document on a new page: stage plays (unless turned off), poems and documents.
  // Screenplays, essays, articles and a book's sections run on.
  const docNewPage = script ? !!meta.sceneNewPage : template.id === "document" || template.mode === "poem";
  for (const item of items) {
    if (typedPages.has(item)) continue;
    if (item.kind === "play") {
      // A play of a collection: a new page with its title.
      if (blocks.length && !newPage) blocks.push({ kind: "page_break", runs: [] });
      const own = typed.plays.get(item.id);
      if (own) {
        typedTitle(own);
        newPage = true;
        continue;
      }
      blocks.push({ kind: "title", runs: [{ text: item.title }] });
      if (meta.author) blocks.push({ kind: script ? "character" : "subheading", runs: [{ text: `by ${meta.author}` }] });
      blocks.push({ kind: "page_break", runs: [] });
      newPage = true;
      continue;
    }
    if (item.kind === "folder") {
      if (item.chapter && template.id === "book") {
        // A chapter made of sections: its title is the chapter heading.
        blocks.push({ kind: "chapter", runs: [{ text: item.title }] });
        newPage = true;
        continue;
      }
      // Screenplay sequences and article parts print nothing on the page (as in the PDF), so they don't break the page either.
      if (template.id === "screenplay" || template.id === "article") continue;
      blocks.push({ kind: "folder_heading", runs: [{ text: item.title }] });
      newPage = true;
      continue;
    }
    if (item.kind === "matter") {
      // Front and back matter pages start a new page but don't print their titles, like scenes;
      // an essay's Works Cited or Bibliography page keeps its required heading.
      blocks.push(essay ? { kind: "matter_title", runs: [{ text: item.title }] } : { kind: "matter_title", runs: [], label: item.title });
      item.blocks.forEach((b, i, all) => {
        if (keptBlank(b, i, all)) blocks.push({ kind: b.type === "paragraph" ? "matter_paragraph" : b.type, runs: blankLine });
        else if (blockText(b).trim() || b.type === "scene_break") blocks.push({ kind: b.type === "paragraph" ? "matter_paragraph" : b.type, runs: exportRuns(b.runs, item) });
      });
      newPage = true;
      continue;
    }
    if (template.id === "book" && !item.section) blocks.push({ kind: "chapter", runs: [{ text: item.title }] });
    // Each scene, poem or page on a new page (not straight after a heading that starts one).
    else if (docNewPage && !item.section && !newPage && blocks.length) blocks.push({ kind: "page_break", runs: [] });
    newPage = false;
    const contd = script && meta.autoContd ? contdLines(item.blocks) : null;
    let prevEmpty = false;
    const nums = template.mode === "notes" ? listNumbers(item.blocks) : [];
    for (const [i, b] of item.blocks.entries()) {
      const empty = !blockText(b).trim();
      if (template.mode === "poem") {
        if (empty) {
          if (!prevEmpty) blocks.push({ kind: "stanza_break", runs: [] });
          prevEmpty = true;
          continue;
        }
        prevEmpty = false;
        blocks.push({ kind: b.type === "title" ? "title" : "line", runs: exportRuns(b.runs, item) });
        continue;
      }
      if (!script && keptBlank(b, i, item.blocks)) {
        blocks.push({ kind: b.type, runs: blankLine });
        continue;
      }
      if (empty && b.type !== "scene_break" && b.type !== "divider") continue;
      if (contd?.has(i)) {
        blocks.push({ kind: b.type, runs: [{ text: `${blockText(b).toUpperCase()} (CONT'D)` }], ...(script && b.sim !== undefined ? { sim: b.sim } : {}) });
        continue;
      }
      if (template.mode === "notes") {
        const k = exportKind(b, nums[i]);
        const indent = isListType(b.type) ? Math.min(b.indent ?? 0, MAX_INDENT) : 0;
        blocks.push({ kind: k.kind, runs: exportRuns(k.prefix ? [{ text: k.prefix }, ...b.runs] : b.runs, item), ...(indent ? { indent } : {}) });
        continue;
      }
      if (b.type === "scene_break" && meta.sceneBreak && meta.sceneBreak.style !== "asterisks") {
        blocks.push({ kind: b.type, runs: [{ text: sceneBreakText(meta.sceneBreak.style) }] });
        continue;
      }
      blocks.push({ kind: b.type, runs: exportRuns(normalizeRuns(b), item), ...(script && b.sim !== undefined ? { sim: b.sim } : {}) });
    }
  }
  const doc: ExportDoc = { title: meta.title || "Untitled", author: meta.author, template: template.id, lang: "en", id: `urn:uuid:${projectId}`, blocks };
  if (essay) {
    doc.style = meta.essay?.style ?? "mla";
    doc.runningHead = doc.style === "mla" ? (meta.author.trim().split(/\s+/).pop() ?? "") : "";
    if (doc.style === "chicago-notes") doc.notePlacement = meta.essay?.notePlacement ?? "footnotes";
  }
  if (notes.length) doc.notes = notes;
  return doc;
}

/** Notion-style blocks (Document format) as plain styles Word and e-readers understand. */
function exportKind(b: Block, n: number): { kind: string; prefix?: string } {
  switch (b.type) {
    case "title":
      return { kind: "heading" };
    case "bullet":
      return { kind: "list", prefix: `${["•", "◦", "▪"][(b.indent ?? 0) % 3]}\u00a0\u00a0` };
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
