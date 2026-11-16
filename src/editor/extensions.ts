import { Extension, Node, type JSONContent } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { Fragment, Slice, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { cycleNext, elementLabel, hasType, type ElementType, type Template } from "../formats/templates";
import { parseDoc, serializeDoc, adaptScriptTypes, type Block, type Run } from "../formats/markdown";

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
    };
  },
  parseHTML() {
    return [{ tag: "p" }, { tag: "h1" }, { tag: "h2" }, { tag: "h3" }, { tag: "blockquote" }, { tag: "li" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["p", HTMLAttributes, 0];
  },
});

// ---------------------------------------------------- blocks <-> editor

function runsToInline(runs: Run[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const r of runs) {
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
  return {
    type: "doc",
    content: list.map((b) =>
      b.type === "image"
        ? { type: "image", attrs: { src: b.src ?? "", alt: b.runs.map((r) => r.text).join("") } }
        : { type: "element", attrs: { type: b.type }, content: runsToInline(b.runs) },
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
    blocks.push({ type: node.attrs.type as ElementType, runs });
  });
  return blocks;
}

/** A line's text with hard breaks as "\n" — the same offsets search results use. */
export function lineText(node: PMNode): string {
  return node.textBetween(0, node.content.size, undefined, "\n");
}

// ------------------------------------------------------------- commands

/** Change the type of the line holding the cursor, as part of `tr`. */
function retype(tr: Transaction, type: ElementType): Transaction {
  const { $from } = tr.selection;
  const node = $from.parent;
  if (node.type.name !== "element") return tr;
  const pos = $from.before();
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, type });
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

// ------------------------------------------------------------ popup menu
// One small menu serves two jobs: the "/" block menu and, on a character
// line, the list of names already used in the script (as in Scrivener).

export interface MenuItem {
  label: string;
  hint?: string;
  value: string;
}

interface PopupInfo {
  kind: "slash" | "names";
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

export interface ScriptKeysOptions {
  getTemplate: () => Template;
  getNames: () => string[];
  getSearch: () => SearchHighlight | null;
  /** Ask for an image, copy it into the project and return its relative path. */
  pickImage: () => Promise<string | null>;
}

export interface SearchHighlight {
  re: RegExp;
  /** The match to show as current: line index and character offset in that line. */
  current?: { index: number; from: number } | null;
}

function slashItems(t: Template, query: string): MenuItem[] {
  const q = query.toLowerCase();
  return t.elements
    .filter((e) => e.type !== "todo_done")
    .filter((e) => !q || e.label.toLowerCase().includes(q) || e.type.includes(q) || (e.aliases ?? []).some((a) => a.startsWith(q)))
    .map((e) => ({ label: e.label, value: e.type, hint: e.aliases?.[0] }));
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
    const items = slashItems(opts.getTemplate(), query.trim());
    if (!items.length) return null;
    return { kind: "slash", from, to: $from.pos, items, index: Math.min(ps.index ?? 0, items.length - 1) };
  }

  if ($from.parent.attrs.type === "character" && $from.pos === lineEnd) {
    const typed = $from.parent.textContent.toUpperCase().trim();
    if (ps.dismissed === typed) return null;
    const names = opts.getNames().filter((n) => n.startsWith(typed) && n !== typed).slice(0, 8);
    if (!names.length) return null;
    // On an empty line nothing is highlighted, so Enter keeps its usual job.
    const index = ps.index ?? (typed ? 0 : -1);
    return { kind: "names", from: lineStart, to: lineEnd, items: names.map((n) => ({ label: n, value: n })), index: Math.min(index, names.length - 1) };
  }
  return null;
}

function choose(view: EditorView, info: PopupInfo, i: number, template: Template): boolean {
  const item = info.items[i];
  if (!item) return false;
  let tr = view.state.tr.setMeta(popupKey, { slashFrom: null, index: null, dismissed: null });
  if (info.kind === "slash") {
    tr.delete(info.from, info.to);
    if (item.value === "image") {
      view.dispatch(tr);
      void pickImageFor(view);
      return true;
    }
    tr = retype(tr, item.value as ElementType);
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  // A picked name fills the cue and moves on to the dialogue line.
  tr.insertText(item.value, info.from, info.to);
  const at = tr.selection.$from.end();
  tr.split(at, 1, [{ type: view.state.schema.nodes.element, attrs: { type: template.afterEnter.character ?? "dialogue" } }]);
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
      ...(info.kind === "names" ? [Object.assign(document.createElement("div"), { className: "popup-title", textContent: "Characters" })] : []),
      ...info.items.map((it, i) => {
        const b = document.createElement("button");
        b.className = i === info.index ? "menu-item active" : "menu-item";
        b.setAttribute("role", "option");
        b.dataset.value = it.value;
        const l = document.createElement("span");
        l.textContent = it.label;
        b.appendChild(l);
        if (it.hint && info.kind === "slash") {
          const k = document.createElement("kbd");
          k.textContent = it.hint;
          b.appendChild(k);
        }
        b.addEventListener("mousedown", (e) => {
          e.preventDefault();
          choose(this.view, info, i, this.opts.getTemplate());
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
  // Enter on an empty list item leaves the list.
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
    tr = tr.insert(blockStart, state.schema.nodes.element.create({ type }));
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  let nextType = atEnd ? (template.afterEnter[type] ?? type) : type;
  if (nextType === "todo_done") nextType = "todo";
  tr = tr.split(at, 1, [{ type: state.schema.nodes.element, attrs: { type: nextType } }]);
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
    return { getTemplate: () => ({}) as Template, getNames: () => [], getSearch: () => null, pickImage: async () => null };
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
        if (info && info.index >= 0) return choose(this.editor.view, info, info.index, t());
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
        if (info) return choose(view, info, Math.max(0, info.index), tmpl);
        if (!tmpl.tabCycle.length) {
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
        // Backspace at the start of a list item, quote or heading turns it back into text.
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parentOffset !== 0 || $from.parent.type.name !== "element") return false;
        const type = $from.parent.attrs.type as ElementType;
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
            mousedown: (view, event) => {
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
            // Placeholder on the current empty line, naming its element type.
            if ($from.parent.type.name === "element" && $from.parent.content.size === 0 && $from.parent.attrs.type !== "divider") {
              const type = $from.parent.attrs.type as ElementType;
              const label = tmpl.elements.find((e) => e.type === type)?.placeholder ?? elementLabel(tmpl, type);
              decos.push(Decoration.node($from.before(), $from.after(), { class: "is-empty", "data-placeholder": label }));
            }
            // Numbered lists: each item shows its number (counted from the first item of the list).
            let n = 0;
            state.doc.forEach((node, pos) => {
              n = node.type.name === "element" && node.attrs.type === "numbered" ? n + 1 : 0;
              if (n) decos.push(Decoration.node(pos, pos + node.nodeSize, { "data-num": `${n}.` }));
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
            // "/" opens the block menu at the start of a line or after a space.
            if (text === "/" && (before === "" || /\s$/.test(before))) {
              view.dispatch(state.tr.insertText("/", from, to).setMeta(popupKey, { slashFrom: from, index: null, dismissed: null }));
              return true;
            }
            // "(" on an empty dialogue line starts a parenthetical.
            if (text === "(" && type === "dialogue" && $from.parent.content.size === 0) {
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
            if (!hasType(tmpl, node.attrs.type)) {
              tr ??= state.tr;
              // A document replaced wholesale (select all + type) starts like a new one.
              const type = index === 0 && state.doc.childCount === 1 ? tmpl.firstElement : fallback;
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, type });
            }
          });
          return tr;
        },
      }),
    ];
  },
});

export function parseBlocksForTemplate(text: string, tmpl: Template): Block[] {
  const doc = parseDoc(text, tmpl.mode, tmpl.elements.some((e) => e.type === "title"));
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
