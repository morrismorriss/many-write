import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Underline from "@tiptap/extension-underline";
import HardBreak from "@tiptap/extension-hard-break";
import History from "@tiptap/extension-history";
import { ElementNode, ScriptDocument, ScriptKeys, blocksToContent, docToBlocks, setLineType } from "./extensions";
import { elementLabel, type ElementType, type Template } from "../formats/templates";
import type { ProjectStore } from "../project/store";
import { ChevronDown } from "../components/icons";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘⌥" : "Ctrl+Alt+";

interface Props {
  store: ProjectStore;
  docId: string;
  template: Template;
  onCursor: (docId: string, index: number) => void;
  header?: React.ReactNode;
  /** Put the cursor at the start of this line (used to jump to layout issues). */
  focusReq?: { index: number; n: number } | null;
}

export function EditorPane({ store, docId, template, onCursor, header, focusReq }: Props) {
  const doc = store.docState(docId)!;
  const templateRef = useRef(template);
  templateRef.current = template;
  const namesRef = useRef<string[]>([]);
  const [lineType, setType] = useState<ElementType>(template.firstElement);
  const [menuOpen, setMenuOpen] = useState(false);
  const extRev = useRef(doc.externalRev);

  const editor = useEditor({
    extensions: [
      ScriptDocument,
      Text,
      ElementNode,
      Bold,
      Italic,
      Underline,
      HardBreak,
      History,
      ScriptKeys.configure({ getTemplate: () => templateRef.current, getNames: () => namesRef.current }),
    ],
    content: blocksToContent(doc.blocks, template),
    autofocus: "end",
    editorProps: {
      attributes: {
        class: `mw-editor mode-${template.mode} tmpl-${template.id}`,
        spellcheck: "true",
        "data-testid": "editor",
      },
    },
    onUpdate: ({ editor }) => {
      store.updateDoc(docId, docToBlocks(editor.state.doc));
    },
    onTransaction: ({ editor }) => {
      const $from = editor.state.selection.$from;
      setType($from.node(1)?.attrs.type ?? template.firstElement);
      onCursor(docId, $from.index(0));
    },
    onCreate: ({ editor }) => {
      const $from = editor.state.selection.$from;
      setType($from.node(1)?.attrs.type ?? template.firstElement);
      onCursor(docId, $from.index(0));
    },
  });

  // Character names for autocomplete, refreshed as the manuscript changes.
  namesRef.current = template.mode === "script" ? store.characterNames() : [];

  // Reload when the file changed on disk (outside edit, or "use disk version").
  useEffect(() => {
    if (!editor || doc.externalRev === extRev.current) return;
    extRev.current = doc.externalRev;
    const { from } = editor.state.selection;
    editor.commands.setContent(blocksToContent(doc.blocks, template), false);
    const max = editor.state.doc.content.size - 1;
    editor.commands.setTextSelection(Math.max(1, Math.min(from, max)));
  }, [editor, doc.externalRev, doc.blocks, template]);

  useEffect(() => {
    if (!editor || !focusReq) return;
    const doc = editor.state.doc;
    let pos = 1;
    doc.forEach((_n, offset, i) => {
      if (i === focusReq.index) pos = offset + 1;
    });
    editor.chain().focus().setTextSelection(pos).scrollIntoView().run();
  }, [editor, focusReq?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (type: ElementType) => {
    setMenuOpen(false);
    if (!editor) return;
    setLineType(editor.state, editor.view.dispatch, type);
    editor.commands.focus();
  };

  return (
    <div className="editor-wrap">
      <div className="editor-toolbar">
        <div className="type-menu">
          <button className="type-pill" data-testid="type-pill" onClick={() => setMenuOpen((v) => !v)} title="Element type (Tab cycles, Enter moves on)">
            {elementLabel(template, lineType)} <ChevronDown width={13} height={13} />
          </button>
          {menuOpen && (
            <div className="menu" onMouseLeave={() => setMenuOpen(false)}>
              {template.elements.map((el, i) => (
                <button key={el.type} className={el.type === lineType ? "menu-item active" : "menu-item"} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(el.type)}>
                  <span>{el.label}</span>
                  <kbd>{MOD}{i + 1}</kbd>
                </button>
              ))}
              <div className="menu-hint">
                {template.tabCycle.length ? "Tab cycles types · Enter on an empty line switches type" : "Tab indents · Shift-Tab outdents"}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="editor-scroll">
        <div className="editor-column">
          {header}
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
