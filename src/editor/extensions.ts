import { Extension, Node, type JSONContent } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { Fragment, Slice, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { cycleNext, elementLabel, type ElementType, type Template } from "../formats/templates";
import { parseDoc, serializeDoc, adaptScriptTypes, type Block, type Run } from "../formats/markdown";

// --------------------------------------------------------------- schema

export const ScriptDocument = Document.extend({ content: "element+" });

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
  const list = blocks.length ? blocks : [{ type: template.firstElement, runs: [] }];
  return {
    type: "doc",
    content: list.map((b) => ({ type: "element", attrs: { type: b.type }, content: runsToInline(b.runs) })),
  };
}

export function docToBlocks(doc: PMNode): Block[] {
  const blocks: Block[] = [];
  doc.forEach((node) => {
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

// ------------------------------------------------------------- commands

/** Change the element type of the line holding the cursor. */
export function setLineType(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, type: ElementType): boolean {
  const { $from } = state.selection;
  const node = $from.parent;
  if (node.type.name !== "element") return false;
  if (!dispatch) return true;
  const pos = $from.before();
  let tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, type });
  const text = node.textContent;
  if (type === "parenthetical" && text === "") {
    // Final Draft habit: a new parenthetical opens with the cursor inside "()".
    tr = tr.insertText("()", pos + 1);
    tr = tr.setSelection(TextSelection.create(tr.doc, pos + 2));
  } else if (node.attrs.type === "parenthetical" && text === "()") {
    tr = tr.delete(pos + 1, pos + 3);
  }
  dispatch(tr.scrollIntoView());
  return true;
}

export interface ScriptKeysOptions {
  getTemplate: () => Template;
  getNames: () => string[];
}

const suggestKey = new PluginKey<{ dismissed: string | null }>("mw-suggest");

/** The completion for a character cue being typed, if any. */
function suggestion(state: EditorState, names: string[]): string | null {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.attrs.type !== "character") return null;
  if ($from.parentOffset !== $from.parent.content.size) return null;
  const typed = $from.parent.textContent.toUpperCase();
  if (!typed.trim()) return null;
  if (suggestKey.getState(state)?.dismissed === typed) return null;
  const hit = names.find((n) => n.startsWith(typed) && n !== typed);
  return hit ? hit.slice(typed.length) : null;
}

function handleEnter(view: EditorView, template: Template, names: string[]): boolean {
  const { state } = view;
  let tr = state.tr;
  if (!state.selection.empty) tr = tr.deleteSelection();
  const $pos = tr.selection.$from;
  const node = $pos.parent;
  if (node.type.name !== "element") return false;
  const type = node.attrs.type as ElementType;
  const text = node.textContent;
  const blockStart = $pos.before();

  // Accept a character-name completion, then carry on as a normal Enter.
  const sug = state.selection.empty ? suggestion(state, names) : null;
  if (sug) tr = tr.insertText(sug, tr.selection.from);

  // Enter on an empty line: cycle its type (character -> direction -> transition -> ...).
  const blank = !text.trim() || (type === "parenthetical" && text.trim() === "()");
  if (blank && template.emptyCycle.length && !sug && state.selection.empty) {
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
  const nextType = atEnd ? (template.afterEnter[type] ?? type) : type;
  tr = tr.split(at, 1, [{ type: state.schema.nodes.element, attrs: { type: nextType } }]);
  // The new line's content starts two positions after the split point.
  tr = tr.setSelection(TextSelection.create(tr.doc, at + 2));
  if (nextType === "parenthetical" && atEnd) {
    tr = tr.insertText("()", at + 2).setSelection(TextSelection.create(tr.doc, at + 3));
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const ScriptKeys = Extension.create<ScriptKeysOptions>({
  name: "scriptKeys",
  priority: 1000,
  addOptions() {
    return { getTemplate: () => ({}) as Template, getNames: () => [] };
  },
  addKeyboardShortcuts() {
    const t = () => this.options.getTemplate();
    const shortcuts: Record<string, () => boolean> = {
      Enter: () => handleEnter(this.editor.view, t(), this.options.getNames()),
      "Shift-Enter": () => this.editor.commands.setHardBreak(),
      Tab: () => {
        const tmpl = t();
        const { state, view } = this.editor;
        if (!tmpl.tabCycle.length) {
          view.dispatch(state.tr.insertText("    ").scrollIntoView());
          return true;
        }
        if (suggestion(state, this.options.getNames())) {
          view.dispatch(state.tr.insertText(suggestion(state, this.options.getNames())!));
          return true;
        }
        const cur = state.selection.$from.parent.attrs.type as ElementType;
        return setLineType(state, view.dispatch, cycleNext(tmpl.tabCycle, cur, 1));
      },
      "Shift-Tab": () => {
        const tmpl = t();
        const { state, view } = this.editor;
        if (!tmpl.tabCycle.length) {
          // Poems: remove up to four spaces of indentation.
          const $from = state.selection.$from;
          const lead = $from.parent.textContent.match(/^ {1,4}/)?.[0].length ?? 0;
          if (lead) view.dispatch(state.tr.delete($from.start(), $from.start() + lead));
          return true;
        }
        const cur = state.selection.$from.parent.attrs.type as ElementType;
        return setLineType(state, view.dispatch, cycleNext(tmpl.tabCycle, cur, -1));
      },
      ArrowRight: () => {
        const sug = suggestion(this.editor.state, this.options.getNames());
        if (!sug) return false;
        this.editor.view.dispatch(this.editor.state.tr.insertText(sug));
        return true;
      },
      Escape: () => {
        const { state, view } = this.editor;
        if (!suggestion(state, this.options.getNames())) return false;
        view.dispatch(state.tr.setMeta(suggestKey, { dismissed: state.selection.$from.parent.textContent.toUpperCase() }));
        return true;
      },
    };
    for (let i = 1; i <= 7; i++) {
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
      new Plugin({
        key: suggestKey,
        state: {
          init: () => ({ dismissed: null as string | null }),
          apply: (tr, value) => {
            const meta = tr.getMeta(suggestKey);
            if (meta) return meta;
            return tr.docChanged ? { dismissed: null } : value;
          },
        },
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            const { $from } = state.selection;
            const tmpl = options.getTemplate();
            // Placeholder on the current empty line, naming its element type.
            if ($from.parent.type.name === "element" && $from.parent.content.size === 0) {
              const type = $from.parent.attrs.type as ElementType;
              const label = tmpl.elements.find((e) => e.type === type)?.placeholder ?? elementLabel(tmpl, type);
              decos.push(Decoration.node($from.before(), $from.after(), { class: "is-empty", "data-placeholder": label }));
            }
            const sug = suggestion(state, options.getNames());
            if (sug) {
              decos.push(
                Decoration.widget(state.selection.from, () => {
                  const s = document.createElement("span");
                  s.className = "mw-suggest";
                  s.textContent = sug;
                  return s;
                }),
              );
            }
            return DecorationSet.create(state.doc, decos);
          },
          handleTextInput(view, from, to, text) {
            // "(" on an empty dialogue line starts a parenthetical.
            const { $from } = view.state.selection;
            if (text === "(" && from === to && $from.parent.attrs.type === "dialogue" && $from.parent.content.size === 0) {
              return setLineType(view.state, view.dispatch, "parenthetical");
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
            const doc = slice.content;
            const blocks: Block[] = [];
            doc.forEach((n) => {
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
          const valid = new Set(tmpl.elements.map((e) => e.type));
          const fallback: ElementType = tmpl.mode === "poem" ? "line" : tmpl.mode === "script" ? (valid.has("action") ? "action" : "direction") : "paragraph";
          let tr: Transaction | null = null;
          state.doc.forEach((node, pos, index) => {
            if (!valid.has(node.attrs.type)) {
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
  if (tmpl.mode === "script") return adaptScriptTypes(doc, tmpl.elements.some((e) => e.type === "action") ? "action" : "direction").blocks;
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
