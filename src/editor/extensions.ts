import { Extension, Node, type JSONContent } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { Fragment, Slice, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { cycleNext, elementLabel, hasType, inSong, isListType, listNumbers, MAX_INDENT, type ElementType, type NotePlacement, type Template } from "../formats/templates";
import { parseDoc, serializeDoc, adaptScriptTypes, noteNumbers, type Block, type Run } from "../formats/markdown";
import { linkTarget, URL_RE } from "../formats/typst";
import { openUrl } from "../lib/backend";
import { inTextCitation, noteEntry, sourceLabel, sourceMatches, type CitationStyle, type ReferenceStyle, type Source } from "../formats/citations";
import { appendColumn, gridCells, gridStyle, isSpeechType, joinColumn, MAX_TOGETHER, normalizeSim, simRowAt, speakerGroupAt, type Group, type SimLine } from "../formats/simultaneous";
import { newId } from "../project/model";

// --------------------------------------------------------------- schema

export const ScriptDocument = Document.extend({ content: "(element | image)+" });

export interface ImageOptions {
  /** Absolute path of the project folder, to find images on disk. */
  getRoot: () => string;
  loadUrl: (absPath: string) => Promise<string>;
}

/** A picture from the project's assets folder, with an editable caption. */
export const ImageNode = Node.create<ImageOptions>({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { getRoot: () => "", loadUrl: async () => "" };
  },
  addAttributes() {
    return { src: { default: "" }, alt: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "figure[data-src]", getAttrs: (el) => ({ src: (el as HTMLElement).dataset.src, alt: (el as HTMLElement).dataset.alt ?? "" }) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["figure", { "data-src": HTMLAttributes.src, "data-alt": HTMLAttributes.alt, class: "mw-image" }];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("figure");
      dom.className = "mw-image";
      dom.contentEditable = "false";
      const img = document.createElement("img");
      img.alt = node.attrs.alt;
      const cap = document.createElement("input");
      cap.className = "mw-caption";
      cap.placeholder = "Add a caption";
      cap.value = node.attrs.alt;
      cap.addEventListener("change", () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (pos !== undefined) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, alt: cap.value }));
      });
      cap.addEventListener("keydown", (e) => e.stopPropagation());
      dom.append(img, cap);
      const root = this.options.getRoot();
      void this.options
        .loadUrl(`${root}/${node.attrs.src}`)
        .then((u) => (img.src = u))
        .catch(() => (dom.dataset.missing = "true"));
      return { dom, stopEvent: (e) => e.target === cap, ignoreMutation: () => true };
    };
  },
});

/** Every line is an `element` whose `type` attribute is its element type. */
export const ElementNode = Node.create({
  name: "element",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes() {
    return {
      type: {
        default: "paragraph",
        parseHTML: (el) => el.getAttribute("data-type") || "paragraph",
        renderHTML: (attrs) => ({ "data-type": attrs.type, class: `el el-${attrs.type}` }),
      },
      /** List items: how many levels deep the item is nested. */
      indent: {
        default: 0,
        parseHTML: (el) => Math.min(MAX_INDENT, Math.max(0, parseInt(el.getAttribute("data-indent") ?? "0", 10) || 0)),
        renderHTML: (attrs) => (attrs.indent ? { "data-indent": String(attrs.indent) } : {}),
      },
      /** Scripts: the speaker's column in a simultaneous row (0 = leftmost); -1 for a normal line. */
      sim: {
        default: -1,
        parseHTML: (el) => Math.max(-1, parseInt(el.getAttribute("data-sim") ?? "-1", 10) || 0),
        renderHTML: (attrs) => (attrs.sim >= 0 ? { "data-sim": String(attrs.sim) } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "p" }, { tag: "h1" }, { tag: "h2" }, { tag: "h3" }, { tag: "blockquote" }, { tag: "li" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["p", HTMLAttributes, 0];
  },
});

/** A superscript number pointing at a footnote or endnote; the text lives in the document's notes. */
export const NoteRefNode = Node.create({
  name: "noteRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { id: { default: "" }, number: { default: 0 } };
  },
  parseHTML() {
    return [
      {
        tag: "sup[data-note]",
        getAttrs: (el) => ({ id: (el as HTMLElement).dataset.note ?? "", number: Number((el as HTMLElement).textContent ?? 0) }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sup", { class: "mw-note", "data-note": HTMLAttributes.id }, String(HTMLAttributes.number || "")];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        // Keep the printed numbers in step with the text: first reference is 1.
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged)) return null;
          let n = 0;
          let tr: Transaction | null = null;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== "noteRef") return;
            n++;
            if (node.attrs.number !== n) {
              tr ??= state.tr;
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, number: n });
            }
          });
          return tr;
        },
      }),
    ];
  },
});

// ---------------------------------------------------- blocks <-> editor

function runsToInline(runs: Run[], numbers?: Map<string, number>): JSONContent[] {
  const out: JSONContent[] = [];
  for (const r of runs) {
    if (r.note) {
      out.push({ type: "noteRef", attrs: { id: r.note, number: numbers?.get(r.note) ?? 0 } });
      continue;
    }
    const marks = [r.bold && { type: "bold" }, r.italic && { type: "italic" }, r.underline && { type: "underline" }].filter(Boolean) as { type: string }[];
    r.text.split("\n").forEach((piece, i) => {
      if (i > 0) out.push({ type: "hardBreak" });
      if (piece) out.push({ type: "text", text: piece, ...(marks.length ? { marks } : {}) });
    });
  }
  return out;
}

export function blocksToContent(blocks: Block[], template: Template): JSONContent {
  const list: Block[] = blocks.length ? blocks : [{ type: template.firstElement, runs: [] }];
  const numbers = noteNumbers({ blocks: list, frontMatter: null });
  return {
    type: "doc",
    content: list.map((b) =>
      b.type === "image"
        ? { type: "image", attrs: { src: b.src ?? "", alt: b.runs.map((r) => r.text).join("") } }
        : { type: "element", attrs: { type: b.type, indent: isListType(b.type) ? Math.min(b.indent ?? 0, MAX_INDENT) : 0, sim: b.sim ?? -1 }, content: runsToInline(b.runs, numbers) },
    ),
  };
}

export function docToBlocks(doc: PMNode): Block[] {
  const blocks: Block[] = [];
  doc.forEach((node) => {
    if (node.type.name === "image") {
      blocks.push({ type: "image", runs: node.attrs.alt ? [{ text: node.attrs.alt }] : [], src: node.attrs.src });
      return;
    }
    const runs: Run[] = [];
    node.forEach((child) => {
      if (child.type.name === "noteRef") {
        runs.push({ text: "", note: child.attrs.id as string });
        return;
      }
      if (child.type.name === "hardBreak") {
        const last = runs[runs.length - 1];
        if (last) last.text += "\n";
        else runs.push({ text: "\n" });
        return;
      }
      if (!child.isText) return;
      const run: Run = { text: child.text ?? "" };
      for (const m of child.marks) {
        if (m.type.name === "bold") run.bold = true;
        if (m.type.name === "italic") run.italic = true;
        if (m.type.name === "underline") run.underline = true;
      }
      const last = runs[runs.length - 1];
      if (last && !!last.bold === !!run.bold && !!last.italic === !!run.italic && !!last.underline === !!run.underline) last.text += run.text;
      else runs.push(run);
    });
    const indent = isListType(node.attrs.type) ? (node.attrs.indent as number) : 0;
    const sim = (node.attrs.sim as number) ?? -1;
    blocks.push({ type: node.attrs.type as ElementType, runs, ...(sim >= 0 ? { sim } : {}), ...(indent ? { indent } : {}) });
  });
  return blocks;
}

/** A line's text with hard breaks as "\n" — the same offsets search results use. */
export function lineText(node: PMNode): string {
  return node.textBetween(0, node.content.size, undefined, "\n");
}

// ---------------------------------------------------- simultaneous rows

interface TopLine extends SimLine {
  pos: number;
  size: number;
  node: PMNode;
}

/** Every top-level line with the position it starts at. */
function topLines(doc: PMNode): TopLine[] {
  const out: TopLine[] = [];
  doc.forEach((node, pos) =>
    out.push({
      pos,
      size: node.nodeSize,
      node,
      type: node.type.name === "element" ? (node.attrs.type as string) : node.type.name,
      sim: node.type.name === "element" ? ((node.attrs.sim as number) ?? -1) : -1,
      text: lineText(node),
    }),
  );
  return out;
}

function setSim(tr: Transaction, line: TopLine, sim: number) {
  tr.setNodeMarkup(line.pos, undefined, { ...line.node.attrs, sim });
}

/**
 * Make the cue at `cuePos` (with the lines under it) a new speaker beside the
 * one above. Returns false when there is no speaker above or the row is full.
 */
function joinCue(view: EditorView, cuePos: number, notify?: (message: string) => void): boolean {
  const lines = topLines(view.state.doc);
  const group = speakerGroupAt(lines, lines.findIndex((l) => l.pos === cuePos));
  if (!group) return false;
  const join = joinColumn(lines, group.start);
  if (!join) {
    if (speakerGroupAt(lines, group.start - 1)) notify?.(`${MAX_TOGETHER} characters is the most who can speak at once.`);
    else notify?.("Put the cue directly under the speaker it speaks with.");
    return false;
  }
  const tr = view.state.tr;
  if (join.first) for (let k = join.first.start; k < join.first.end; k++) setSim(tr, lines[k], 0);
  for (let k = group.start; k < group.end; k++) setSim(tr, lines[k], join.column);
  const cue = lines[group.start];
  tr.setSelection(TextSelection.create(tr.doc, cue.pos + 1 + lineText(cue.node).length));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** "/simultaneous": put the current cue (or an empty line) beside the speaker above. */
function startTogether(view: EditorView, notify?: (message: string) => void): boolean {
  const { state } = view;
  const { $from } = state.selection;
  if ($from.parent.type.name !== "element") return false;
  const type = $from.parent.attrs.type as ElementType;
  const pos = $from.before();
  if (type === "character") return joinCue(view, pos, notify);
  if (isSpeechType(type)) {
    const lines = topLines(state.doc);
    const group = speakerGroupAt(lines, lines.findIndex((l) => l.pos === pos));
    if (group) return joinCue(view, lines[group.start].pos, notify);
  }
  if ($from.parent.content.size) {
    notify?.("Put the cursor on a character line, or on an empty line, to start speaking together.");
    return false;
  }
  // An empty line of any type becomes the next speaker's cue, beside the one above.
  view.dispatch(state.tr.setNodeMarkup(pos, undefined, { ...$from.parent.attrs, type: "character", sim: -1 }));
  return joinCue(view, pos, notify);
}

/** The lines a grip drag carries: a cue takes its speech along, anything else goes alone. */
function dragUnit(lines: SimLine[], index: number): Group {
  if (index < 0 || index >= lines.length) return { start: -1, end: -1 };
  return speakerGroupAt(lines, index) ?? { start: index, end: index + 1 };
}

/** Move a block — or a cue with its speech — above or below another line. */
function moveBlock(view: EditorView, srcPos: number, targetPos: number, after: boolean) {
  const lines = topLines(view.state.doc);
  const src = dragUnit(lines, lines.findIndex((l) => l.pos === srcPos));
  const at = lines.findIndex((l) => l.pos === targetPos);
  if (src.start < 0 || at < 0) return;
  // Dropping into the block itself, or right back where it was, changes nothing.
  if (at >= src.start && at < src.end) return;
  if ((after && at === src.start - 1) || (!after && at === src.end)) return;
  const nodes: PMNode[] = [];
  for (let k = src.start; k < src.end; k++) {
    nodes.push(lines[k].node.type.create({ ...lines[k].node.attrs, sim: -1 }, lines[k].node.content, lines[k].node.marks));
  }
  const tr = view.state.tr;
  tr.delete(lines[src.start].pos, lines[src.end - 1].pos + lines[src.end - 1].size);
  const target = lines[at];
  const insertAt = tr.mapping.map(after ? target.pos + target.size : target.pos, after ? -1 : 1);
  tr.insert(insertAt, Fragment.fromArray(nodes));
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 2)));
  fixRows(tr);
  view.dispatch(tr.scrollIntoView());
}

/** Drop a cue's speaker group beside a target cue: a new column in its row. */
function joinRow(view: EditorView, srcPos: number, targetPos: number, notify?: (message: string) => void) {
  const lines = topLines(view.state.doc);
  const src = speakerGroupAt(lines, lines.findIndex((l) => l.pos === srcPos));
  const tgt = speakerGroupAt(lines, lines.findIndex((l) => l.pos === targetPos));
  if (!src || !tgt) return;
  const srcRow = simRowAt(lines, src.start);
  const tgtRow = simRowAt(lines, tgt.start);
  if (srcRow && tgtRow && srcRow.start === tgtRow.start) return;
  const join = appendColumn(lines, tgt.start);
  if (!join) {
    notify?.(`${MAX_TOGETHER} characters is the most who can speak at once.`);
    return;
  }
  const nodes: PMNode[] = [];
  for (let k = src.start; k < src.end; k++) nodes.push(lines[k].node.type.create({ ...lines[k].node.attrs, sim: join.column }, lines[k].node.content, lines[k].node.marks));
  const tr = view.state.tr;
  if (join.first) for (let k = join.first.start; k < join.first.end; k++) setSim(tr, lines[k], 0);
  tr.delete(lines[src.start].pos, lines[src.end - 1].pos + lines[src.end - 1].size);
  const rowEnd = tgtRow ? tgtRow.end : tgt.end;
  const at = tr.mapping.map(lines[rowEnd - 1].pos + lines[rowEnd - 1].size, 1);
  tr.insert(at, Fragment.fromArray(nodes));
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + 2)));
  fixRows(tr);
  view.dispatch(tr.scrollIntoView());
}

/** Put a row's columns back in order after lines are moved, and dissolve a row left with one speaker. */
function fixRows(tr: Transaction) {
  const lines = topLines(tr.doc);
  const want = normalizeSim(lines);
  lines.forEach((l, i) => {
    if (l.sim !== want[i]) tr.setNodeMarkup(l.pos, undefined, { ...l.node.attrs, sim: want[i] });
  });
}

/** The little grip shown beside a line, for dragging the block about. */
function gripFor(pos: number, canJoin: boolean): HTMLElement {
  const grip = document.createElement("span");
  grip.className = "mw-grip";
  grip.contentEditable = "false";
  grip.dataset.pos = String(pos);
  grip.title = canJoin ? "Drag to move this line, or onto a name to share the line" : "Drag to move this line";
  grip.textContent = "⠿";
  return grip;
}

/** Follow a drag from a line's grip: up or down to move the block, to the side to speak together. */
function beginBlockDrag(view: EditorView, pos: number, canJoin: boolean, notify?: (message: string) => void) {
  const lines = topLines(view.state.doc);
  const from = lines.findIndex((l) => l.pos === pos);
  if (from < 0) return;
  const unit = dragUnit(lines, from);
  const scroller = view.dom.closest(".editor-scroll") as HTMLElement | null;
  let target: DropTarget | null = null;
  let marked: string | null = null;
  // The highlight is a node decoration, not a class on the line: ProseMirror owns that DOM and
  // would throw the class away on its next redraw.
  const mark = (next: DropTarget | null) => {
    const key = next ? `${next.pos}:${next.mode}` : null;
    if (key === marked) return;
    marked = key;
    view.dispatch(view.state.tr.setMeta(dropKey, next));
  };
  const find = (event: MouseEvent) => {
    const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!hit) return null;
    const $hit = view.state.doc.resolve(hit.pos);
    if ($hit.depth < 1) return null;
    const now = topLines(view.state.doc);
    const over = now.findIndex((l) => l.pos === $hit.before(1));
    if (over < 0) return null;
    const group = dragUnit(now, over);
    if (group.start >= unit.start && group.start < unit.end) return null;
    const side = canJoin && now[group.start].type === "character";
    const dom = view.nodeDOM(now[group.start].pos) as HTMLElement | null;
    if (!dom || !dom.getBoundingClientRect) return null;
    const r = dom.getBoundingClientRect();
    let mode: DropTarget["mode"];
    if (side) {
      const band = Math.min(r.height * 0.25, 9);
      mode = event.clientY < r.top + band ? "before" : event.clientY > r.bottom - band ? "after" : "side";
    } else {
      mode = event.clientY < r.top + r.height / 2 ? "before" : "after";
    }
    const last = now[group.end - 1];
    const line = mode === "after" ? last.pos : now[group.start].pos;
    return { pos: line, mode } as DropTarget;
  };
  const move = (event: Event) => {
    const found = find(event as MouseEvent);
    target = found;
    mark(target);
    // Nudge the page along when the pointer rests near the top or bottom edge.
    if (scroller) {
      const r = scroller.getBoundingClientRect();
      const y = (event as MouseEvent).clientY;
      scrollBy(y < r.top + 40 ? -1 : y > r.bottom - 40 ? 1 : 0);
    }
  };
  let raf = 0;
  let direction = 0;
  const tick = () => {
    if (!scroller || !direction) {
      raf = 0;
      return;
    }
    scroller.scrollTop += direction * 12;
    raf = requestAnimationFrame(tick);
  };
  const scrollBy = (dir: number) => {
    if (dir === direction) return;
    direction = dir;
    if (dir && !raf) raf = requestAnimationFrame(tick);
  };
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    for (const [name, fn] of [["pointermove", move], ["mousemove", move], ["pointerup", end], ["mouseup", end], ["keydown", escape]] as const) {
      window.removeEventListener(name, fn as EventListener, true);
    }
    scrollBy(0);
    cancelAnimationFrame(raf);
    view.dom.classList.remove("mw-dragging");
    mark(null);
    const drop = target;
    if (!drop) return;
    if (drop.mode === "side") joinRow(view, pos, drop.pos, notify);
    else moveBlock(view, pos, drop.pos, drop.mode === "after");
  };
  const escape = (event: Event) => {
    if ((event as KeyboardEvent).key !== "Escape") return;
    target = null;
    end();
  };
  view.dom.classList.add("mw-dragging");
  // Pointer events cover mouse, pen and touch; the mouse pair is there for engines without them.
  for (const [name, fn] of [["pointermove", move], ["mousemove", move], ["pointerup", end], ["mouseup", end], ["keydown", escape]] as const) {
    window.addEventListener(name, fn as EventListener, true);
  }
}

// ------------------------------------------------------------- commands

/** Change the type of the line holding the cursor, as part of `tr`. */
function retype(tr: Transaction, type: ElementType): Transaction {
  const { $from } = tr.selection;
  const node = $from.parent;
  if (node.type.name !== "element") return tr;
  const pos = $from.before();
  const keepsColumn = type === "character" || isSpeechType(type);
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, type, indent: isListType(type) ? node.attrs.indent : 0, sim: keepsColumn ? node.attrs.sim : -1 });
  const text = node.textContent;
  if (type === "parenthetical" && text === "") {
    // Final Draft habit: a new parenthetical opens with the cursor inside "()".
    tr.insertText("()", pos + 1);
    tr.setSelection(TextSelection.create(tr.doc, pos + 2));
  } else if (node.attrs.type === "parenthetical" && text === "()") {
    tr.delete(pos + 1, pos + 3);
  }
  if (type === "divider") {
    // A divider holds no text; continue on a fresh line below it (Notion does the same).
    if (text) tr.delete(pos + 1, pos + 1 + node.content.size);
    const end = pos + tr.doc.nodeAt(pos)!.nodeSize;
    tr.insert(end, tr.doc.type.schema.nodes.element.create({ type: "paragraph" }));
    tr.setSelection(TextSelection.create(tr.doc, end + 1));
  }
  return tr;
}

export function setLineType(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, type: ElementType): boolean {
  if (state.selection.$from.parent.type.name !== "element") return false;
  if (dispatch) dispatch(retype(state.tr, type).scrollIntoView());
  return true;
}

/** Nest the list items in the selection one level deeper (step 1) or bring them out one level (step -1). */
export function shiftIndent(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, step: 1 | -1): boolean {
  const { from, to } = state.selection;
  const tr = state.tr;
  let any = false;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== "element") return false;
    if (!isListType(node.attrs.type)) return false;
    any = true;
    const indent = Math.max(0, Math.min(MAX_INDENT, (node.attrs.indent as number) + step));
    if (indent !== node.attrs.indent) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent });
    return false;
  });
  if (!any) return false;
  if (dispatch && tr.docChanged) dispatch(tr.scrollIntoView());
  return true;
}

/**
 * In a musical, the line after a cue or parenthetical inside a song is a lyric,
 * not spoken dialogue. `index` is the position (among the document's top-level
 * lines) the new line will take.
 */
function songAware(doc: PMNode, index: number, next: ElementType, template: Template): ElementType {
  if (next !== "dialogue" || !hasType(template, "lyric")) return next;
  const types: ElementType[] = [];
  doc.forEach((n, _, i) => {
    if (i < index) types.push(n.attrs.type as ElementType);
  });
  return inSong(types, index) ? "lyric" : next;
}

// ------------------------------------------------------------ popup menu
// One small menu serves two jobs: the "/" block menu and, on a character
// line, the list of names already used in the script (as in Scrivener).

export interface MenuItem {
  label: string;
  hint?: string;
  value: string;
}

/** Character extensions offered after a name: "ANNA (V.O.)". */
export const CUE_EXTENSIONS: { value: string; hint: string }[] = [
  { value: "CONT'D", hint: "continued" },
  { value: "V.O.", hint: "voice-over" },
  { value: "O.S.", hint: "off stage / screen" },
  { value: "O.C.", hint: "off camera" },
];

interface PopupInfo {
  kind: "slash" | "names" | "ext";
  /** Range of the text the pick replaces. */
  from: number;
  to: number;
  items: MenuItem[];
  index: number;
}

interface PopupState {
  slashFrom: number | null;
  /** null = the default highlight for this list. */
  index: number | null;
  dismissed: string | null;
}

const popupKey = new PluginKey<PopupState>("mw-popup");

/** The line a dragged cue would join, marked while the mouse is over it. */
const dropKey = new PluginKey<DropTarget | null>("mw-drop");
type DropTarget = { pos: number; mode: "side" | "before" | "after" };

export interface ScriptKeysOptions {
  getTemplate: () => Template;
  getNames: () => string[];
  getSearch: () => SearchHighlight | null;
  /** Ask for an image, copy it into the project and return its relative path. */
  pickImage: () => Promise<string | null>;
  /** Grey text for an empty document, and the type its first line starts as. */
  getHint: () => { text: string; type?: ElementType } | null;
  /** Essays, books, articles and documents: the sources cited so far (newest first). null = no "/cite" here. */
  getCitations?: () => { sources: Source[]; style: ReferenceStyle } | null;
  /** Chicago notes: where a citation lands; null = in-text citations. */
  getNotePlacement?: () => NotePlacement | null;
  /** "/cite" › New citation: ask for a source; the dialog then calls insertCitation. */
  requestCitation?: () => void;
  /** A remembered source was cited again. */
  onCite?: (id: string) => void;
  /** "/note": ask the writer for the text of a new note. */
  requestNote?: () => void;
  /** A remembered source was cited as a note: its text is ready to store. */
  addNote?: (id: string, runs: Run[]) => void;
  /** A word about what just happened, e.g. that six is the most who can speak at once. */
  notify?: (message: string) => void;
}

const CITE_WORDS = ["citation", "cite", "source", "reference", "mla", "chicago", "works cited", "bibliography", "footnote", "endnote", "note"];

/** "/simultaneous": scripts only. */
const TOGETHER_WORDS = ["simultaneous", "together", "dual", "duet", "unison", "speak at once", "at once", "sim"];

export interface SearchHighlight {
  re: RegExp;
  /** The match to show as current: line index and character offset in that line. */
  current?: { index: number; from: number } | null;
}

function slashItems(
  t: Template,
  query: string,
  cite: { sources: Source[]; style: ReferenceStyle } | null = null,
  notePlacement: NotePlacement | null = null,
): MenuItem[] {
  const q = query.toLowerCase();
  const items: MenuItem[] = t.elements
    .filter((e) => e.type !== "todo_done")
    .filter((e) => !q || e.label.toLowerCase().includes(q) || e.type.includes(q) || (e.aliases ?? []).some((a) => a.startsWith(q)))
    .map((e) => ({ label: e.label, value: e.type, hint: e.aliases?.[0] }));
  // Scripts: put two (or more) characters on one line.
  if (t.mode === "script") {
    const together: MenuItem = { label: "Simultaneous dialogue", value: "sim", hint: "Together" };
    if (!q) items.push(together);
    else if (TOGETHER_WORDS.some((w) => w.startsWith(q))) items.unshift(together);
  }
  if (!cite) return items;
  // "/cite" offers a new citation first, then every source cited before, newest first.
  const citeWord = !!q && CITE_WORDS.some((w) => w.startsWith(q));
  const style = cite.style === "mla" ? "MLA" : cite.style === "chicago-notes" ? "Notes" : "Chicago";
  const hint = notePlacement ? (notePlacement === "footnotes" ? "Footnote" : "Endnote") : style;
  const out: MenuItem[] = [];
  if (!q || citeWord) {
    out.push({ label: "Citation…", value: "cite:new", hint });
    if (notePlacement) out.push({ label: "Note…", value: "note:new", hint: notePlacement === "footnotes" ? "Footnote" : "Endnote" });
  }
  const saved = cite.sources.filter((s) => citeWord || (q.length >= 2 && sourceMatches(s, q))).slice(0, 8);
  for (const s of saved) out.push({ label: `Cite ${sourceLabel(s)}`, value: `cite:${s.id}` });
  // Typing "/cite" puts citations at the top; otherwise they follow the blocks.
  return citeWord ? [...out, ...items] : [...items, ...out];
}

/**
 * Put an in-text citation at the cursor: "(Smith 23)" in MLA, "(Smith 2020, 23)"
 * in Chicago. Without a page number the cursor lands just before the ")" so the page can be typed straight in.
 */
export function insertCitation(view: EditorView, src: Source, style: CitationStyle, page = "") {
  const { state } = view;
  const { schema } = state;
  const { runs, caret } = inTextCitation(src, style, page);
  const $from = state.selection.$from;
  if ($from.parent.type.name !== "element") return;
  // Keep the marks of the text around the cursor (bold…), but put a title in italics where it needs them.
  const around = (state.storedMarks ?? $from.marks()).filter((m) => m.type.name !== "italic");
  const nodes = runs.map((r) => schema.text(r.text, r.italic && schema.marks.italic ? [...around, schema.marks.italic.create()] : around));
  // A space before the citation when it follows a word.
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset);
  const lead = before && !/\s/.test(before) ? 1 : 0;
  let tr = state.tr.deleteSelection();
  const at = tr.selection.from;
  const frag = Fragment.from(lead ? [schema.text(" ", around), ...nodes] : nodes);
  tr = tr.insert(at, frag);
  const end = at + frag.size;
  tr = tr.setSelection(TextSelection.create(tr.doc, page.trim() ? end : at + lead + caret));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** Put a footnote/endnote marker at the cursor, after a space when it follows a word. */
export function insertNoteRef(view: EditorView, id: string): boolean {
  const { state } = view;
  const { $from } = state.selection;
  if ($from.parent.type.name !== "element") return false;
  const node = state.schema.nodes.noteRef.create({ id, number: 0 });
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset);
  const lead = before && !/\s/.test(before) ? [state.schema.text(" ")] : [];
  let tr = state.tr.deleteSelection();
  const at = tr.selection.from;
  const frag = Fragment.from([...lead, node]);
  tr = tr.insert(at, frag);
  tr = tr.setSelection(TextSelection.create(tr.doc, at + frag.size));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function popupInfo(state: EditorState, opts: ScriptKeysOptions): PopupInfo | null {
  const ps = popupKey.getState(state);
  const { $from, empty } = state.selection;
  if (!ps || !empty || $from.parent.type.name !== "element") return null;
  const lineStart = $from.start();
  const lineEnd = $from.end();

  if (ps.slashFrom !== null) {
    const from = ps.slashFrom;
    if (from < lineStart || from >= lineEnd || state.doc.textBetween(from, from + 1) !== "/" || $from.pos <= from) return null;
    const query = state.doc.textBetween(from + 1, $from.pos);
    if (query.length > 24 || /\s{2}/.test(query)) return null;
    const items = slashItems(opts.getTemplate(), query.trim(), opts.getCitations?.() ?? null, opts.getNotePlacement?.() ?? null);
    if (!items.length) return null;
    return { kind: "slash", from, to: $from.pos, items, index: Math.min(ps.index ?? 0, items.length - 1) };
  }

  if ($from.parent.attrs.type === "character" && $from.pos === lineEnd) {
    const typed = $from.parent.textContent.toUpperCase().trim();
    if (ps.dismissed === typed) return null;
    // "ANNA (" or "ANNA (V": offer the extensions.
    const open = typed.match(/^(.*\S)\s*\(([^)]*)$/);
    if (open) {
      const q = open[2].trim();
      const exts = CUE_EXTENSIONS.filter((e) => e.value.startsWith(q) || e.value.replace(/\W/g, "").startsWith(q.replace(/\W/g, "")));
      if (!exts.length) return null;
      const items = exts.map((e) => ({ label: `(${e.value})`, hint: e.hint, value: `${open[1]} (${e.value})` }));
      return { kind: "ext", from: lineStart, to: lineEnd, items, index: Math.min(ps.index ?? 0, items.length - 1) };
    }
    // Names used elsewhere: other documents (from the store) and other lines of this one, never the line being typed.
    const here = new Map<string, number>();
    state.doc.forEach((n) => {
      if (n === $from.parent || n.type.name !== "element" || n.attrs.type !== "character") return;
      const name = n.textContent.toUpperCase().trim().replace(/\s*\(.*\)$/, "");
      if (name) here.set(name, (here.get(name) ?? 0) + 1);
    });
    const all = [...new Set([...[...here.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n), ...opts.getNames()])];
    // A whole name typed: offer its extensions, with none highlighted so Enter still moves on to dialogue.
    if (typed && all.includes(typed)) {
      const items = CUE_EXTENSIONS.map((e) => ({ label: `(${e.value})`, hint: e.hint, value: `${typed} (${e.value})` }));
      return { kind: "ext", from: lineStart, to: lineEnd, items, index: Math.min(ps.index ?? -1, items.length - 1) };
    }
    const names = all.filter((n) => n.startsWith(typed) && n !== typed).slice(0, 8);
    if (!names.length) return null;
    // On an empty line nothing is highlighted, so Enter keeps its usual job.
    const index = ps.index ?? (typed ? 0 : -1);
    return { kind: "names", from: lineStart, to: lineEnd, items: names.map((n) => ({ label: n, value: n })), index: Math.min(index, names.length - 1) };
  }
  return null;
}

function choose(view: EditorView, info: PopupInfo, i: number, opts: ScriptKeysOptions): boolean {
  const template = opts.getTemplate();
  const item = info.items[i];
  if (!item) return false;
  let tr = view.state.tr.setMeta(popupKey, { slashFrom: null, index: null, dismissed: null });
  if (info.kind === "slash") {
    tr.delete(info.from, info.to);
    if (item.value === "note:new") {
      view.dispatch(tr);
      opts.requestNote?.();
      return true;
    }
    if (item.value.startsWith("cite:")) {
      view.dispatch(tr);
      const id = item.value.slice(5);
      if (id === "new") {
        opts.requestCitation?.();
        return true;
      }
      const cite = opts.getCitations?.();
      const src = cite?.sources.find((s) => s.id === id);
      if (src && cite) {
        if (cite.style === "chicago-notes" && opts.getNotePlacement?.()) {
          const noteId = newId();
          if (insertNoteRef(view, noteId)) opts.addNote?.(noteId, noteEntry(src));
        } else {
          insertCitation(view, src, cite.style === "mla" ? "mla" : "chicago");
          opts.onCite?.(id);
        }
      }
      return true;
    }
    if (item.value === "image") {
      view.dispatch(tr);
      void pickImageFor(view);
      return true;
    }
    if (item.value === "sim") {
      view.dispatch(tr);
      startTogether(view, opts.notify);
      return true;
    }
    if (item.value === "song" && tr.selection.$from.parent.textContent.trim()) {
      // "/song" typed after some words: the song starts on its own line below them.
      const end = tr.selection.$from.after();
      tr.insert(end, view.state.schema.nodes.element.create({ type: "song" }));
      tr.setSelection(TextSelection.create(tr.doc, end + 1));
      view.dispatch(tr.scrollIntoView());
      return true;
    }
    tr = retype(tr, item.value as ElementType);
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  // A picked name fills the cue and moves on to the dialogue line (a lyric inside a song).
  tr.insertText(item.value, info.from, info.to);
  const at = tr.selection.$from.end();
  const cueIndex = tr.selection.$from.index(0);
  const next = songAware(tr.doc, cueIndex + 1, template.afterEnter.character ?? "dialogue", template);
  tr.split(at, 1, [{ type: view.state.schema.nodes.element, attrs: { type: next } }]);
  tr.setSelection(TextSelection.create(tr.doc, at + 2));
  view.dispatch(tr.scrollIntoView());
  return true;
}

let imagePicker: (() => Promise<string | null>) | null = null;

/** Insert a picked image at the cursor's line (replacing it when empty). */
async function pickImageFor(view: EditorView) {
  const src = await imagePicker?.();
  if (!src) return;
  const { state } = view;
  const { $from } = state.selection;
  const image = state.schema.nodes.image.create({ src, alt: "" });
  const tr = state.tr;
  let after: number;
  if ($from.parent.type.name === "element" && $from.parent.content.size === 0) {
    tr.replaceWith($from.before(), $from.after(), image);
    after = $from.before() + image.nodeSize;
  } else {
    after = $from.after() + image.nodeSize;
    tr.insert($from.after(), image);
  }
  // A fresh line to keep typing on, under the picture.
  tr.insert(after, state.schema.nodes.element.create({ type: "paragraph" }));
  tr.setSelection(TextSelection.create(tr.doc, after + 1));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

class PopupView {
  dom: HTMLDivElement;
  private info: PopupInfo | null = null;
  constructor(
    private view: EditorView,
    private opts: ScriptKeysOptions,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "menu popup-menu";
    this.dom.setAttribute("role", "listbox");
    this.dom.style.display = "none";
    document.body.appendChild(this.dom);
    this.update(view);
  }
  update(view: EditorView) {
    this.view = view;
    const info = view.hasFocus() || this.info ? popupInfo(view.state, this.opts) : null;
    this.info = info;
    if (!info) {
      this.dom.style.display = "none";
      return;
    }
    this.dom.dataset.kind = info.kind;
    this.dom.replaceChildren(
      ...(info.kind !== "slash" ? [Object.assign(document.createElement("div"), { className: "popup-title", textContent: info.kind === "names" ? "Characters" : "Add to the name" })] : []),
      ...info.items.map((it, i) => {
        const b = document.createElement("button");
        b.className = i === info.index ? "menu-item active" : "menu-item";
        b.setAttribute("role", "option");
        b.dataset.value = it.value;
        const l = document.createElement("span");
        l.textContent = it.label;
        b.appendChild(l);
        if (it.hint && info.kind !== "names") {
          const k = document.createElement("kbd");
          k.textContent = it.hint;
          b.appendChild(k);
        }
        b.addEventListener("mousedown", (e) => {
          e.preventDefault();
          choose(this.view, info, i, this.opts);
          this.view.focus();
        });
        return b;
      }),
    );
    const c = view.coordsAtPos(info.kind === "slash" ? info.from : view.state.selection.from);
    this.dom.style.display = "block";
    const below = c.bottom + 6;
    const h = this.dom.offsetHeight;
    this.dom.style.top = `${below + h > window.innerHeight ? c.top - h - 6 : below}px`;
    this.dom.style.left = `${Math.min(c.left, window.innerWidth - this.dom.offsetWidth - 12)}px`;
  }
  destroy() {
    this.dom.remove();
  }
}

// ---------------------------------------------------------------- Enter

function handleEnter(view: EditorView, template: Template): boolean {
  const { state } = view;
  let tr = state.tr;
  if (!state.selection.empty) tr = tr.deleteSelection();
  const $pos = tr.selection.$from;
  const node = $pos.parent;
  if (node.type.name !== "element") return false;
  const type = node.attrs.type as ElementType;
  const text = node.textContent;
  const blockStart = $pos.before();

  if (type === "divider") {
    const end = blockStart + node.nodeSize;
    tr.insert(end, state.schema.nodes.element.create({ type: "paragraph" }));
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)).scrollIntoView());
    return true;
  }

  const blank = !text.trim() || (type === "parenthetical" && text.trim() === "()");
  const sim = (node.attrs.sim as number) ?? -1;
  // Enter on an empty line of a simultaneous row leaves the row (and moves on as usual).
  if (blank && sim >= 0 && state.selection.empty) {
    const next = template.emptyCycle.length ? cycleNext(template.emptyCycle, type) : type;
    view.dispatch(state.tr.setNodeMarkup(blockStart, undefined, { ...node.attrs, type: next, sim: -1 }).scrollIntoView());
    return true;
  }
  // Enter on an empty list item nests it one level deeper (Backspace brings it back out);
  // at the deepest level it leaves the list.
  const indent = (node.attrs.indent as number) ?? 0;
  if (blank && isListType(type) && indent < MAX_INDENT && state.selection.empty) return shiftIndent(state, view.dispatch, 1);
  // Enter on an empty quote or callout (or a list item at the deepest level) leaves it.
  const exit = template.emptyExit?.[type];
  if (blank && exit && state.selection.empty) return setLineType(state, view.dispatch, exit);
  // Enter on an empty line: cycle its type (character -> direction -> transition -> ...).
  if (blank && template.emptyCycle.length && state.selection.empty) {
    return setLineType(state, view.dispatch, cycleNext(template.emptyCycle, type));
  }

  let at = tr.selection.from;
  const $at = tr.doc.resolve(at);
  const offset = $at.parentOffset;
  const size = $at.parent.content.size;
  // Inside a parenthetical, Enter just before the closing ")" leaves it.
  const atEnd = offset === size || (type === "parenthetical" && $at.parent.textContent.slice(offset) === ")");
  if (atEnd) at = $at.end();

  if (offset === 0 && size > 0) {
    // Cursor at the start: open an empty line of the same type above.
    tr = tr.insert(blockStart, state.schema.nodes.element.create({ type, indent, sim }));
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  let nextType = atEnd ? (template.afterEnter[type] ?? type) : type;
  if (nextType === "todo_done") nextType = "todo";
  if (atEnd) nextType = songAware(tr.doc, $at.index(0) + 1, nextType, template);
  // A simultaneous row carries the column through a cue and its speech. After the last
  // speech of the column, Enter moves on below the row, ready for an ordinary cue.
  if (sim >= 0 && atEnd && type !== "character" && nextType === "character") {
    const lines = topLines(tr.doc);
    const row = simRowAt(lines, $at.index(0));
    if (row) {
      const end = lines[row.end - 1].pos + lines[row.end - 1].size;
      tr.insert(end, state.schema.nodes.element.create({ type: "character" }));
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)).scrollIntoView());
      return true;
    }
  }
  tr = tr.split(at, 1, [{ type: state.schema.nodes.element, attrs: { type: nextType, indent: isListType(nextType) ? indent : 0, sim } }]);
  // The new line's content starts two positions after the split point.
  tr = tr.setSelection(TextSelection.create(tr.doc, at + 2));
  if (nextType === "parenthetical" && atEnd) {
    tr = tr.insertText("()", at + 2).setSelection(TextSelection.create(tr.doc, at + 3));
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

// Notion-style markdown shortcuts, typed at the start of a line.
const SHORTCUTS: [RegExp, ElementType][] = [
  [/^[-*+]$/, "bullet"],
  [/^1[.)]$/, "numbered"],
  [/^\[ ?\]$/, "todo"],
  [/^\[x\]$/i, "todo_done"],
  [/^#$/, "title"],
  [/^##$/, "heading"],
  [/^###$/, "subheading"],
  [/^>$/, "quote"],
  [/^!$/, "callout"],
];

// ------------------------------------------------------------- extension

export const ScriptKeys = Extension.create<ScriptKeysOptions>({
  name: "scriptKeys",
  priority: 1000,
  addOptions() {
    return { getTemplate: () => ({}) as Template, getNames: () => [], getSearch: () => null, pickImage: async () => null, getHint: () => null };
  },
  addKeyboardShortcuts() {
    const t = () => this.options.getTemplate();
    const popup = () => popupInfo(this.editor.state, this.options);
    const move = (step: number) => {
      const info = popup();
      if (!info) return false;
      const n = info.items.length;
      const next = info.index < 0 ? (step > 0 ? 0 : n - 1) : (info.index + step + n) % n;
      this.editor.view.dispatch(this.editor.state.tr.setMeta(popupKey, { ...popupKey.getState(this.editor.state)!, index: next }));
      return true;
    };
    const shortcuts: Record<string, () => boolean> = {
      Enter: () => {
        const info = popup();
        if (info && info.index >= 0) return choose(this.editor.view, info, info.index, this.options);
        return handleEnter(this.editor.view, t());
      },
      "Shift-Enter": () => this.editor.commands.setHardBreak(),
      ArrowDown: () => move(1),
      ArrowUp: () => move(-1),
      Escape: () => {
        const { state, view } = this.editor;
        if (!popup()) return false;
        view.dispatch(state.tr.setMeta(popupKey, { slashFrom: null, index: null, dismissed: state.selection.$from.parent.textContent.toUpperCase().trim() }));
        return true;
      },
      Tab: () => {
        const tmpl = t();
        const { state, view } = this.editor;
        const info = popup();
        // Tab picks from a list of names; with a whole name typed it still changes the line type.
        if (info && (info.kind !== "ext" || info.index >= 0)) return choose(view, info, Math.max(0, info.index), this.options);
        if (!tmpl.tabCycle.length) {
          // List items nest one level deeper; elsewhere Tab inserts spaces.
          if (isListType(state.selection.$from.parent.attrs.type)) return shiftIndent(state, view.dispatch, 1) || true;
          view.dispatch(state.tr.insertText("    ").scrollIntoView());
          return true;
        }
        const cur = state.selection.$from.parent.attrs.type as ElementType;
        return setLineType(state, view.dispatch, cycleNext(tmpl.tabCycle, cur, 1));
      },
      "Shift-Tab": () => {
        const tmpl = t();
        const { state, view } = this.editor;
        if (!tmpl.tabCycle.length) {
          if (isListType(state.selection.$from.parent.attrs.type)) return shiftIndent(state, view.dispatch, -1) || true;
          // Poems and notes: remove up to four spaces of indentation.
          const $from = state.selection.$from;
          const lead = $from.parent.textContent.match(/^ {1,4}/)?.[0].length ?? 0;
          if (lead) view.dispatch(state.tr.delete($from.start(), $from.start() + lead));
          return true;
        }
        const cur = state.selection.$from.parent.attrs.type as ElementType;
        return setLineType(state, view.dispatch, cycleNext(tmpl.tabCycle, cur, -1));
      },
      Backspace: () => {
        // Backspace at the start of a nested list item brings it out one level;
        // at the start of a list item, quote or heading it turns the line back into text.
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parentOffset !== 0 || $from.parent.type.name !== "element") return false;
        const type = $from.parent.attrs.type as ElementType;
        if (isListType(type) && $from.parent.attrs.indent > 0) return shiftIndent(state, view.dispatch, -1);
        const to = t().backspaceTo?.[type] ?? (type === "divider" ? "paragraph" : undefined);
        return to ? setLineType(state, view.dispatch, to) : false;
      },
    };
    for (let i = 1; i <= 9; i++) {
      shortcuts[`Mod-Alt-${i}`] = () => {
        const el = t().elements[i - 1];
        return el ? setLineType(this.editor.state, this.editor.view.dispatch, el.type) : false;
      };
    }
    return shortcuts;
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<DropTarget | null>({
        key: dropKey,
        state: {
          init: () => null,
          apply: (tr, value) => {
            const meta = tr.getMeta(dropKey) as DropTarget | null | undefined;
            return meta === undefined ? (tr.docChanged ? null : value) : meta;
          },
        },
      }),
      new Plugin<PopupState>({
        key: popupKey,
        state: {
          init: () => ({ slashFrom: null, index: null, dismissed: null }),
          apply: (tr, value) => {
            const meta = tr.getMeta(popupKey) as PopupState | undefined;
            if (meta) return meta;
            if (!tr.docChanged && !tr.selectionSet) return value;
            const slashFrom = value.slashFrom === null ? null : tr.mapping.map(value.slashFrom, -1);
            return { slashFrom, index: tr.docChanged ? null : value.index, dismissed: tr.docChanged ? null : value.dismissed };
          },
        },
        view: (view) => {
          imagePicker = () => options.pickImage();
          return new PopupView(view, options);
        },
        props: {
          handleDOMEvents: {
            blur: (view) => {
              // Close the menu when focus leaves the editor (but not when clicking it).
              window.setTimeout(() => {
                if (!view.hasFocus()) view.dispatch(view.state.tr.setMeta(popupKey, { slashFrom: null, index: null, dismissed: null }));
              }, 120);
              return false;
            },
            click: (_view, event) => {
              // A click on a web address opens it in the browser; Alt-click places the cursor to edit it.
              const link = (event.target as HTMLElement).closest?.(".mw-link") as HTMLElement | null;
              if (!link || event.altKey || event.button !== 0) return false;
              const href = link.dataset.href;
              if (!href) return false;
              event.preventDefault();
              void openUrl(href);
              return true;
            },
            mousedown: (view, event) => {
              // A line's grip starts a drag: up or down to move the block, to the side of
              // another name to speak together.
              const grip = (event.target as HTMLElement).closest?.(".mw-grip") as HTMLElement | null;
              if (grip && event.button === 0) {
                event.preventDefault();
                const pos = Number(grip.dataset.pos);
                if (Number.isFinite(pos)) beginBlockDrag(view, pos, options.getTemplate().mode === "script", options.notify);
                return true;
              }
              // Clicking a to-do's box ticks it.
              const p = (event.target as HTMLElement).closest?.("p.el-todo, p.el-todo_done") as HTMLElement | null;
              if (!p || event.clientX > p.getBoundingClientRect().left + 26) return false;
              const pos = view.posAtDOM(p, 0) - 1;
              const node = view.state.doc.nodeAt(pos);
              if (!node) return false;
              event.preventDefault();
              view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, type: node.attrs.type === "todo" ? "todo_done" : "todo" }));
              return true;
            },
          },
          decorations(state) {
            const decos: Decoration[] = [];
            const { $from } = state.selection;
            const tmpl = options.getTemplate();
            // An empty document shows its hint in grey, whether or not the cursor is in it.
            const first = state.doc.firstChild;
            const hint = state.doc.childCount === 1 && first?.type.name === "element" && first.content.size === 0 ? options.getHint() : null;
            if (hint) {
              decos.push(Decoration.node(0, first!.nodeSize, { class: "is-empty is-hint", "data-placeholder": hint.text }));
            } else if ($from.parent.type.name === "element" && $from.parent.content.size === 0 && $from.parent.attrs.type !== "divider") {
              // Placeholder on the current empty line, naming its element type.
              const type = $from.parent.attrs.type as ElementType;
              const label = tmpl.elements.find((e) => e.type === type)?.placeholder ?? elementLabel(tmpl, type);
              decos.push(Decoration.node($from.before(), $from.after(), { class: "is-empty", "data-placeholder": label }));
            }
            // Numbered lists: each item shows its number (counted from the first item of the list).
            // Nested lists count on their own.
            const lines: { type: string; indent: number; pos: number; size: number }[] = [];
            state.doc.forEach((node, pos) =>
              lines.push({ type: node.type.name === "element" ? node.attrs.type : node.type.name, indent: node.attrs.indent ?? 0, pos, size: node.nodeSize }),
            );
            listNumbers(lines).forEach((n, i) => {
              if (n) decos.push(Decoration.node(lines[i].pos, lines[i].pos + lines[i].size, { "data-num": `${n}.` }));
            });
            // Scripts: simultaneous speakers share a line, split across a grid; a grip on each
            // character name lets it be dragged up, or to the side of another speaker.
            if (tmpl.mode === "script") {
              const simLines = topLines(state.doc);
              gridCells(simLines).forEach((cell, i) =>
                decos.push(Decoration.node(simLines[i].pos, simLines[i].pos + simLines[i].size, { style: gridStyle(cell) })),
              );
            }
            // Where a dragged line would land.
            const drop = dropKey.getState(state);
            const dropped = drop && state.doc.nodeAt(drop.pos);
            if (drop && dropped) decos.push(Decoration.node(drop.pos, drop.pos + dropped.nodeSize, { class: `mw-drop-${drop.mode}` }));
            // Every line carries a grip in the margin: drag it up or down to move the block, or
            // onto another name (in a script) to have the two speak at once.
            const canJoin = tmpl.mode === "script";
            state.doc.forEach((node, pos) => {
              if (node.type.name === "element") decos.push(Decoration.widget(pos + 1, gripFor(pos, canJoin), { side: -1 }));
            });
            // Web addresses: underlined and clickable.
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              URL_RE.lastIndex = 0;
              for (let m: RegExpExecArray | null; (m = URL_RE.exec(node.text)); ) {
                decos.push(
                  Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                    class: "mw-link",
                    "data-href": linkTarget(m[0]),
                    title: `${linkTarget(m[0])}\nClick to open · ${navigator.platform.includes("Mac") ? "⌥" : "Alt"}-click to edit`,
                  }),
                );
              }
            });
            // Find & replace matches.
            const search = options.getSearch();
            if (search) {
              state.doc.forEach((node, pos, index) => {
                if (node.type.name !== "element") return;
                const text = lineText(node);
                search.re.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = search.re.exec(text)) && m[0].length) {
                  const current = search.current?.index === index && search.current.from === m.index;
                  decos.push(Decoration.inline(pos + 1 + m.index, pos + 1 + m.index + m[0].length, { class: current ? "search-hit current" : "search-hit" }));
                }
              });
            }
            return DecorationSet.create(state.doc, decos);
          },
          handleTextInput(view, from, to, text) {
            const { state } = view;
            const { $from } = state.selection;
            if (from !== to || $from.parent.type.name !== "element") return false;
            const tmpl = options.getTemplate();
            const type = $from.parent.attrs.type as ElementType;
            const before = $from.parent.textContent.slice(0, $from.parentOffset);
            // Typing into a divider starts a new line under it.
            if (type === "divider") {
              const end = $from.after();
              const tr = state.tr.insert(end, state.schema.nodes.element.create({ type: "paragraph" }, state.schema.text(text)));
              view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1 + text.length)));
              return true;
            }
            // "^" at the end of a cue speaks together with the speaker above (Fountain's dual dialogue).
            if (text === "^" && type === "character" && $from.pos === $from.end()) {
              const lines = topLines(state.doc);
              const idx = lines.findIndex((l) => l.pos === $from.before());
              if (idx >= 0 && joinColumn(lines, idx)) {
                joinCue(view, $from.before(), options.notify);
                return true;
              }
            }
            // "/" opens the block menu at the start of a line or after a space.
            if (text === "/" && (before === "" || /\s$/.test(before))) {
              view.dispatch(state.tr.insertText("/", from, to).setMeta(popupKey, { slashFrom: from, index: null, dismissed: null }));
              return true;
            }
            // "(" on an empty dialogue line starts a parenthetical.
            if (text === "(" && (type === "dialogue" || type === "lyric") && $from.parent.content.size === 0) {
              return setLineType(state, view.dispatch, "parenthetical");
            }
            // Notion-style markdown shortcuts in notes and prose.
            if (tmpl.mode === "notes" || tmpl.mode === "prose") {
              if (text === "-" && before === "--" && hasType(tmpl, "divider")) {
                const tr = state.tr.delete($from.start(), from);
                view.dispatch(retype(tr, "divider"));
                return true;
              }
              if (text === " " && type === tmpl.firstElement) {
                for (const [re, target] of SHORTCUTS) {
                  if (re.test(before) && hasType(tmpl, target)) {
                    const tr = state.tr.delete($from.start(), from);
                    view.dispatch(retype(tr, target));
                    return true;
                  }
                }
              }
            }
            return false;
          },
          clipboardTextParser(text, _ctx, _plain, view) {
            // Pasted plain text is read with the same convention as the files.
            const tmpl = options.getTemplate();
            const blocks = parseBlocksForTemplate(text, tmpl);
            return sliceFromBlocks(view.state.schema, blocks, tmpl);
          },
          clipboardTextSerializer(slice) {
            const tmpl = options.getTemplate();
            const blocks: Block[] = [];
            slice.content.forEach((n) => {
              if (n.type.name === "element") blocks.push(...docToBlocks(n.type.schema.nodes.doc.create(null, [n])));
            });
            if (!blocks.length) return slice.content.textBetween(0, slice.content.size, "\n");
            return serializeDoc({ blocks, frontMatter: null }, tmpl.mode).trimEnd();
          },
        },
        // Keep every line's type valid for the template (e.g. after pasting HTML).
        appendTransaction(trs, _old, state) {
          if (!trs.some((t) => t.docChanged)) return null;
          const tmpl = options.getTemplate();
          const fallback: ElementType = tmpl.mode === "poem" ? "line" : tmpl.mode === "script" ? (hasType(tmpl, "action") ? "action" : "direction") : "paragraph";
          let tr: Transaction | null = null;
          state.doc.forEach((node, pos, index) => {
            if (node.type.name === "image" && hasType(tmpl, "image")) return;
            if (node.type.name === "image") {
              // This format has no pictures (scripts): drop it.
              tr ??= state.tr;
              tr.delete(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize));
              return;
            }
            if (node.attrs.indent && !isListType(node.attrs.type) && hasType(tmpl, node.attrs.type)) {
              tr ??= state.tr;
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: 0 });
              return;
            }
            if (!hasType(tmpl, node.attrs.type)) {
              tr ??= state.tr;
              // A document replaced wholesale (select all + type) starts like a new one.
              const type = index === 0 && state.doc.childCount === 1 ? tmpl.firstElement : fallback;
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, type, indent: isListType(type) ? node.attrs.indent : 0 });
            }
          });
          // Keep simultaneous rows whole and numbered from the left after lines come and go.
          const fixSim = (tx: Transaction | null): Transaction | null => {
            const lines = topLines(tx ? tx.doc : state.doc);
            const want = normalizeSim(lines);
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].sim === want[i]) continue;
              tx ??= state.tr;
              tx.setNodeMarkup(lines[i].pos, undefined, { ...lines[i].node.attrs, sim: want[i] });
            }
            return tx;
          };
          return fixSim(tr);
        },
      }),
    ];
  },
});

export function parseBlocksForTemplate(text: string, tmpl: Template): Block[] {
  const doc = parseDoc(text, tmpl.mode, hasType(tmpl, "title"), hasType(tmpl, "citation"));
  if (tmpl.mode === "script") return adaptScriptTypes(doc, hasType(tmpl, "action") ? "action" : "direction").blocks;
  return doc.blocks;
}

function sliceFromBlocks(schema: Schema, blocks: Block[], tmpl: Template): Slice {
  if (blocks.length <= 1 && blocks[0]) {
    // A single line pastes inline, keeping the current line's type.
    const content = blocksToContent(blocks, tmpl).content![0].content ?? [];
    return new Slice(Fragment.fromJSON(schema, content), 0, 0);
  }
  const json = blocksToContent(blocks, tmpl);
  const nodes = (json.content ?? []).map((c) => schema.nodeFromJSON(c));
  return new Slice(Fragment.fromArray(nodes), 1, 1);
}
