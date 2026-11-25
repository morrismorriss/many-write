import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectStore } from "../project/store";
import { useStore } from "../lib/useStore";
import { Binder, NotesPanel } from "./Binder";
import { Preview, type CompileReport } from "./Preview";
import { EditorPane } from "../editor/EditorPane";
import type { SearchHighlight } from "../editor/extensions";
import { exportProject, ProjectSettingsDialog, ThemeMenu } from "./Menus";
import { exportTableRead } from "./TableRead";
import { FileMenu, FindBar, GoalsWidget, Pomodoro, ProductionMenu, type FindScope } from "./Widgets";
import { ChevronLeft, ChevronRight, FileIcon, FolderIcon, Search, Warning } from "./icons";
import type { AppSettings, Theme } from "../themes/themes";
import { roleOf, type BinderNode } from "../project/model";
import { blockText } from "../formats/markdown";
import type { Match } from "../formats/search";

interface Props {
  store: ProjectStore;
  settings: AppSettings;
  setSettings: (patch: Partial<AppSettings>) => void;
  themes: Theme[];
  theme: Theme;
  onPickTheme: (t: Theme) => void;
  onBuildTheme: (base: Theme) => void;
  onDeleteTheme: (t: Theme) => void;
  onClose: () => void;
  onNewProject: () => void;
  onOpenFolder: () => void;
  onOpenProject: (root: string) => void;
  onNewDocument: () => void;
  onOpenDocument: () => void;
  onImport: () => void;
  onNewWindow: () => void;
  onOpenInWindow: (root: string) => void;
  onDonate: () => void;
}

export function Workspace(p: Props) {
  const { store, settings, setSettings } = p;
  useStore(store);
  const [cursor, setCursor] = useState<{ docId: string; index: number } | null>(null);
  const [focusReq, setFocusReq] = useState<{ docId: string; index: number; n: number; from?: number; to?: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [find, setFind] = useState<FindScope | null>(null);
  const [highlight, setHighlight] = useState<SearchHighlight | null>(null);
  const last = useRef<{ report: CompileReport | null; ids: string[] }>({ report: null, ids: [] });
  const dragging = useRef(false);

  const sel = store.selectedId ? store.node(store.selectedId) : null;
  const onCursor = useCallback((docId: string, index: number) => setCursor({ docId, index }), []);
  const onReport = useCallback((r: CompileReport, ids: string[]) => {
    last.current = { report: r, ids };
  }, []);

  // Keyboard: Mod-\ binder, Mod-Shift-\ preview, Mod-F find, Mod-Shift-F find in the whole script.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "\\") {
        e.preventDefault();
        if (e.shiftKey) setSettings({ previewOpen: !settings.previewOpen });
        else setSettings({ binderOpen: !settings.binderOpen });
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void store.flushAll();
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFind(e.shiftKey ? "script" : "doc");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings.binderOpen, settings.previewOpen, setSettings, store]);

  // Resize the preview by dragging its edge.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      const w = Math.max(320, Math.min(window.innerWidth * 0.6, window.innerWidth - e.clientX));
      setSettings({ previewWidth: Math.round(w) });
    };
    const up = () => {
      dragging.current = false;
      document.body.classList.remove("resizing");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [setSettings]);

  const jump = (elementId: string) => {
    const [docId, idx] = elementId.split("#");
    if (Number(idx) < 0) return void store.select(docId);
    void store.select(docId).then(() => setFocusReq({ docId, index: Number(idx), n: Date.now() }));
  };
  const jumpToMatch = (m: Match) => {
    void store.select(m.docId).then(() => setFocusReq({ docId: m.docId, index: m.index, from: m.from, to: m.to, n: Date.now() }));
  };

  const lock = (revision: string) => {
    const { report, ids } = last.current;
    if (!report?.ok) {
      store.toast("Wait for the preview to finish typesetting, then lock again.", "warn");
      return;
    }
    void store.lockPages(ids, report.elementPages, report.elementLastPages, report.pageCount, revision);
  };

  const binderW = settings.binderOpen ? 268 : 0;
  const previewW = settings.previewOpen ? settings.previewWidth : 0;

  return (
    <div className="workspace" style={{ gridTemplateColumns: `${binderW}px minmax(0,1fr) ${previewW}px` }}>
      {/* Binder + notes */}
      <aside className={settings.binderOpen ? "sidebar" : "sidebar collapsed"} aria-hidden={!settings.binderOpen}>
        {settings.binderOpen && (
          <>
            <div className="sidebar-head">
              <span className="project-title" title={store.root}>
                {store.data.title}
              </span>
            </div>
            <div className="binder-scroll">
              <Binder store={store} />
            </div>
            {!store.single && <NotesPanel store={store} spellcheck={settings.spellcheck} />}
          </>
        )}
      </aside>
      <button
        className={`edge-toggle left${settings.binderOpen ? "" : " collapsed"}`}
        style={{ left: binderW }}
        onClick={() => setSettings({ binderOpen: !settings.binderOpen })}
        aria-label={settings.binderOpen ? "Hide binder" : "Show binder"}
        title={settings.binderOpen ? "Hide binder (⌘\\)" : "Show binder (⌘\\)"}
        data-testid="toggle-binder"
      >
        {settings.binderOpen ? <ChevronLeft /> : <ChevronRight />}
      </button>

      {/* Editor */}
      <main className="main">
        <div className="topbar">
          <div className="topbar-left">
            <FileMenu
              onNew={p.onNewProject}
              onNewDocument={p.onNewDocument}
              onOpenDocument={p.onOpenDocument}
              onImport={p.onImport}
              onNewWindow={p.onNewWindow}
              onOpenInWindow={p.onOpenInWindow}
              onDonate={p.onDonate}
              single={store.single}
              exports={store.template.exports}
              onExport={(f) => void exportProject(store, f)}
              onTableRead={store.template.mode === "script" ? () => void exportTableRead(store) : undefined}
              onOpenFolder={p.onOpenFolder}
              onOpen={p.onOpenProject}
              onClose={p.onClose}
              onSettings={() => setShowSettings(true)}
              spellcheck={settings.spellcheck}
              onToggleSpellcheck={() => setSettings({ spellcheck: !settings.spellcheck })}
              currentRoot={store.root}
            />
            {!store.single && <ProductionMenu store={store} onLock={lock} />}
            <div className="crumbs">
              {sel ? (
                breadcrumb(store, sel).map((t, i, a) => (
                  <span key={i} className={i === a.length - 1 ? "crumb last" : "crumb"}>
                    {t}
                  </span>
                ))
              ) : (
                <span className="crumb">{store.data.title}</span>
              )}
            </div>
          </div>
          <div className="topbar-right">
            <span className={`save-status ${store.saveStatus}`} data-testid="save-status">
              {store.saveStatus === "saving" ? "Saving…" : store.saveStatus === "error" ? "Not saved" : store.isDirty() ? "Edited" : "Saved"}
            </span>
            {!store.single && <GoalsWidget store={store} />}
            <Pomodoro settings={settings.pomodoro} onChange={(pomodoro) => setSettings({ pomodoro })} notify={(t) => store.toast(t)} />
            <button className="icon-btn" onClick={() => setFind(find ? null : "doc")} title="Find and replace (⌘F)" data-testid="find-btn">
              <Search />
            </button>
            <ThemeMenu themes={p.themes} current={p.theme} onPick={p.onPickTheme} onBuild={p.onBuildTheme} onDelete={p.onDeleteTheme} />
          </div>
        </div>
        {find && (
          <FindBar store={store} docId={sel?.kind === "doc" ? sel.id : null} initialScope={find} onClose={() => setFind(null)} onJump={jumpToMatch} onHighlight={setHighlight} />
        )}
        {store.conflict && (
          <div className="banner warn conflict" role="alert" data-testid="conflict-banner">
            <Warning />
            <span>
              “{store.conflict.title}” was changed outside Many Write while you were typing. Which version do you want to keep? The other is saved in the project's
              .trash folder.
            </span>
            <button className="btn small" onClick={() => void store.resolveConflict("disk")} data-testid="use-disk">
              Use the version on disk
            </button>
            <button className="btn small primary" onClick={() => void store.resolveConflict("mine")} data-testid="keep-mine">
              Keep mine
            </button>
          </div>
        )}
        {sel?.kind === "doc" && store.docState(sel.id) && !store.missing.has(sel.id) ? (
          <EditorPane
            key={sel.id}
            store={store}
            docId={sel.id}
            template={store.templateFor(sel.id)}
            onCursor={onCursor}
            focusReq={focusReq?.docId === sel.id ? focusReq : null}
            search={highlight}
            spellcheck={settings.spellcheck}
            header={<DocTitle store={store} node={sel} />}
          />
        ) : sel?.kind === "folder" ? (
          <FolderView store={store} node={sel} />
        ) : (
          <div className="empty-main">{sel && store.missing.has(sel.id) ? "This file is missing on disk." : "Select or create a document in the binder."}</div>
        )}
      </main>

      {/* Preview */}
      <aside className={settings.previewOpen ? "preview-pane" : "preview-pane collapsed"} aria-hidden={!settings.previewOpen}>
        {settings.previewOpen && (
          <>
            <div
              className="resizer"
              onMouseDown={() => {
                dragging.current = true;
                document.body.classList.add("resizing");
              }}
            />
            <Preview store={store} theme={p.theme} cursor={cursor} follow={settings.followCursor} onJump={jump} onReport={onReport} />
          </>
        )}
      </aside>
      <button
        className={`edge-toggle right${settings.previewOpen ? "" : " collapsed"}`}
        style={{ right: previewW }}
        onClick={() => setSettings({ previewOpen: !settings.previewOpen })}
        aria-label={settings.previewOpen ? "Hide preview" : "Show preview"}
        title={settings.previewOpen ? "Hide preview (⌘⇧\\)" : "Show preview (⌘⇧\\)"}
        data-testid="toggle-preview"
      >
        {settings.previewOpen ? <ChevronRight /> : <ChevronLeft />}
      </button>

      <div className="toasts" aria-live="polite">
        {store.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => store.dismissToast(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
      {showSettings && <ProjectSettingsDialog store={store} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function breadcrumb(store: ProjectStore, node: BinderNode): string[] {
  const chain: string[] = [];
  const rec = (nodes: BinderNode[], path: string[]): boolean => {
    for (const n of nodes) {
      if (n.id === node.id) {
        chain.push(...path, n.title);
        return true;
      }
      if (n.children && rec(n.children, [...path, n.title])) return true;
    }
    return false;
  };
  rec(store.data.binder, []);
  return chain;
}

function DocTitle({ store, node }: { store: ProjectStore; node: BinderNode }) {
  const [value, setValue] = useState(node.title);
  useEffect(() => setValue(node.title), [node.title]);
  return (
    <input
      className={store.template.id === "book" && roleOf(store.data, node.id) === "manuscript" ? "doc-title chapter" : "doc-title"}
      value={value}
      aria-label="Title"
      data-testid="doc-title"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
          (document.querySelector(".editor-column .ProseMirror") as HTMLElement | null)?.focus();
        }
      }}
      onBlur={() => {
        if (value.trim() && value !== node.title) void store.rename(node.id, value);
        else setValue(node.title);
      }}
    />
  );
}

/** A folder shows its contents as index cards. */
function FolderView({ store, node }: { store: ProjectStore; node: BinderNode }) {
  useEffect(() => {
    for (const c of node.children ?? []) if (c.kind === "doc") void store.ensureDoc(c.id);
  }, [node, store]);
  return (
    <div className="folder-view">
      <h1 className="doc-title static">{node.title}</h1>
      <div className="cards">
        {(node.children ?? []).map((c) => {
          const blocks = store.docState(c.id)?.blocks ?? [];
          const synopsis = blocks.map(blockText).filter((t) => t.trim()).slice(0, 4).join(" · ");
          return (
            <button key={c.id} className="card" onClick={() => void store.select(c.id)}>
              <span className="card-title">
                {c.kind === "folder" ? <FolderIcon /> : <FileIcon />} {c.title}
              </span>
              <span className="card-body">{c.kind === "folder" ? `${c.children?.length ?? 0} items` : synopsis || "Empty"}</span>
            </button>
          );
        })}
        <button className="card add" onClick={() => void store.addDoc(node.id)}>
          + New {node.chapter ? "section" : roleOf(store.data, node.id) === "manuscript" ? store.template.docNoun.toLowerCase() : "document"}
        </button>
      </div>
    </div>
  );
}
