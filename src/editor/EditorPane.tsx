import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Underline from "@tiptap/extension-underline";
import HardBreak from "@tiptap/extension-hard-break";
import { UndoRedo } from "@tiptap/extensions";
import { ElementNode, ImageNode, ScriptDocument, ScriptKeys, blocksToContent, docToBlocks, insertCitation, setLineType, type SearchHighlight } from "./extensions";
import { CitationDialog } from "../components/CitationDialog";
import { roleOf } from "../project/model";
import { elementLabel, hasType, type ElementType, type Template } from "../formats/templates";
import { parseDoc, serializeDoc, type Block } from "../formats/markdown";
import type { ProjectStore } from "../project/store";
import { imageUrl, pickImage } from "../lib/backend";
import { ChevronDown } from "../components/icons";
import { sceneBreakText } from "../formats/typst";

/** Books: the scene break divider the writer chose, shown in the editor as on the page. */
function useSceneBreakStyle(store: ProjectStore, template: Template): React.CSSProperties | undefined {
  const s = store.data.settings;
  const style = template.id === "book" ? (s.sceneBreak ?? "asterisks") : undefined;
  const img = style === "image" ? s.sceneBreakImage : undefined;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (img) void imageUrl(store.abs(img)).then(setUrl, () => setUrl(null));
  }, [store, img]);
  if (!style) return undefined;
  if (url) return { ["--break-img" as string]: `url("${url}")` };
  return { ["--break" as string]: JSON.stringify(sceneBreakText(style)) };
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘⌥" : "Ctrl+Alt+";

/** The editor extensions every editor in the app shares. */
/** Formats whose manuscript can cite sources with "/cite". */
const CITING = ["essay", "book", "article", "document"];

function extensions(
  store: ProjectStore,
  opts: {
    template: () => Template;
    names: () => string[];
    search: () => SearchHighlight | null;
    hint?: () => { text: string; type?: ElementType } | null;
    citations?: () => boolean;
    requestCitation?: () => void;
  },
) {
  return [
    ScriptDocument,
    Text,
    ElementNode,
    ImageNode.configure({ getRoot: () => store.root, loadUrl: imageUrl }),
    Bold,
    Italic,
    Underline,
    HardBreak,
    UndoRedo,
    ScriptKeys.configure({
      getTemplate: opts.template,
      getNames: opts.names,
      getSearch: opts.search,
      getHint: opts.hint ?? (() => null),
      getCitations: () => (opts.citations?.() ? { sources: store.sources, style: store.citationStyle } : null),
      requestCitation: opts.requestCitation,
      onCite: (id) => store.touchSource(id),
      pickImage: async () => {
        const f = await pickImage();
        if (!f) return null;
        try {
          return await store.addImage(f.name, f);
        } catch (e) {
          store.toast(`Could not add the image: ${(e as Error).message}`, "error");
          return null;
        }
      },
    }),
  ];
}

interface Props {
  store: ProjectStore;
  docId: string;
  template: Template;
  onCursor: (docId: string, index: number) => void;
  header?: React.ReactNode;
  /** Put the cursor on this line (jump to a layout issue or a search result). */
  focusReq?: { index: number; n: number; from?: number; to?: number } | null;
  search?: SearchHighlight | null;
  spellcheck: boolean;
}

export function EditorPane({ store, docId, template, onCursor, header, focusReq, search, spellcheck }: Props) {
  const doc = store.docState(docId)!;
  const templateRef = useRef(template);
  templateRef.current = template;
  const namesRef = useRef<string[]>([]);
  const searchRef = useRef<SearchHighlight | null>(null);
  searchRef.current = search ?? null;
  const [lineType, setType] = useState<ElementType>(template.firstElement);
  const [menuOpen, setMenuOpen] = useState(false);
  const [citing, setCiting] = useState(false);
  const citable = () => CITING.includes(templateRef.current.id) && ["manuscript", "archive"].includes(roleOf(store.data, docId) ?? "");
  const extRev = useRef(doc.externalRev);
  const breakStyle = useSceneBreakStyle(store, template);
  const hint = () => {
    const h = store.hintFor(docId);
    return h && (!h.type || hasType(templateRef.current, h.type)) ? h : h ? { text: h.text } : null;
  };
  /** An empty document starts on the line type its hint is for (a dedication is centred…). */
  const initial = (blocks: Block[]) => {
    const h = hint();
    return blocksToContent(blocks.length || !h?.type ? blocks : [{ type: h.type, runs: [] }], template);
  };

  const editor = useEditor({
    extensions: extensions(store, { template: () => templateRef.current, names: () => namesRef.current, search: () => searchRef.current, hint, citations: citable, requestCitation: () => setCiting(true) }),
    content: initial(doc.blocks),
    autofocus: "end",
    editorProps: {
      attributes: {
        class: `mw-editor mode-${template.mode} tmpl-${template.id}`,
        spellcheck: String(spellcheck),
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

  // Character names for the picker, refreshed as the manuscript changes.
  namesRef.current = template.mode === "script" ? store.characterNames(docId) : [];

  useEffect(() => {
    editor?.view.dom.setAttribute("spellcheck", String(spellcheck));
  }, [editor, spellcheck]);

  // Redraw search highlights when the search changes.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta("mw-search", true));
  }, [editor, search]);

  // Reload when the file changed on disk, or after find & replace.
  useEffect(() => {
    if (!editor || doc.externalRev === extRev.current) return;
    extRev.current = doc.externalRev;
    const { from } = editor.state.selection;
    editor.commands.setContent(initial(doc.blocks), { emitUpdate: false });
    const max = editor.state.doc.content.size - 1;
    editor.commands.setTextSelection(Math.max(1, Math.min(from, max)));
  }, [editor, doc.externalRev, doc.blocks, template]);

  useEffect(() => {
    if (!editor || !focusReq) return;
    let pos = 1;
    editor.state.doc.forEach((_n, offset, i) => {
      if (i === focusReq.index) pos = offset + 1;
    });
    const from = pos + (focusReq.from ?? 0);
    const to = focusReq.to !== undefined ? pos + focusReq.to : from;
    editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run();
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
          <button className="type-pill" data-testid="type-pill" onClick={() => setMenuOpen((v) => !v)} title="Line type: Tab cycles, Enter moves on, / opens the block menu">
            {elementLabel(template, lineType)} <ChevronDown width={13} height={13} />
          </button>
          {menuOpen && (
            <div className="menu" onMouseLeave={() => setMenuOpen(false)}>
              {template.elements.map((el, i) => (
                <button key={el.type} className={el.type === lineType ? "menu-item active" : "menu-item"} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(el.type)}>
                  <span>{el.label}</span>
                  {i < 9 && <kbd>{MOD}{i + 1}</kbd>}
                </button>
              ))}
              <div className="menu-hint">
                {template.tabCycle.length ? "Tab cycles types · Enter on an empty line switches type · / for the menu" : "Type / for blocks · Tab indents"}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="editor-scroll">
        <div className={breakStyle && "--break-img" in breakStyle ? "editor-column break-img" : "editor-column"} style={breakStyle}>
          {header}
          <EditorContent editor={editor} />
        </div>
      </div>
      {citing && (
        <CitationDialog
          style={store.citationStyle}
          fixedStyle={store.data.template === "essay"}
          onCancel={() => {
            setCiting(false);
            editor?.commands.focus();
          }}
          onDone={(src, page, style) => {
            setCiting(false);
            if (editor) insertCitation(editor.view, src, style, page);
            void store.addSource(src, style);
          }}
        />
      )}
    </div>
  );
}

/** A compact Notion-style editor for the notes panel under the binder. */
export function NotesEditor({ store, nodeId, markdown, template, spellcheck, onChange }: { store: ProjectStore; nodeId: string; markdown: string; template: Template; spellcheck: boolean; onChange: (md: string) => void }) {
  const templateRef = useRef(template);
  const last = useRef(markdown);
  const editor = useEditor({
    extensions: extensions(store, { template: () => templateRef.current, names: () => [], search: () => null }),
    content: blocksToContent(parseDoc(markdown, "notes").blocks, template),
    editorProps: { attributes: { class: "mw-editor mode-notes notes-editor", spellcheck: String(spellcheck), "data-testid": "notes" } },
    onUpdate: ({ editor }) => {
      const md = serializeDoc({ blocks: docToBlocks(editor.state.doc), frontMatter: null }, "notes");
      last.current = md;
      onChange(md);
    },
  });
  // Outside edits to the notes file.
  useEffect(() => {
    if (!editor || markdown === last.current) return;
    last.current = markdown;
    editor.commands.setContent(blocksToContent(parseDoc(markdown, "notes").blocks, template), { emitUpdate: false });
  }, [editor, markdown, template]);
  void nodeId;
  return <EditorContent editor={editor} className="notes-scroll" />;
}
