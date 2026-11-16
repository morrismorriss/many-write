import { useState } from "react";
import { call, fsApi, join, pickSavePath } from "../lib/backend";
import { generateTypst } from "../formats/typst";
import { toExportDoc, toFdx, toFountain } from "../formats/exporters";
import type { ExportFormat } from "../formats/templates";
import type { ProjectStore } from "../project/store";
import type { Theme } from "../themes/themes";
import type { CompileReport } from "./Preview";
import { Close, Download, Palette, Plus, Trash } from "./icons";

const FORMAT_INFO: Record<ExportFormat, { label: string; ext: string; note: string }> = {
  pdf: { label: "PDF", ext: "pdf", note: "Exactly as the preview, orphan rules applied" },
  docx: { label: "Word (.docx)", ext: "docx", note: "Keep-with-next and widow control set; Word repaginates" },
  epub: { label: "EPUB", ext: "epub", note: "Reflowable e-book" },
  fdx: { label: "Final Draft (.fdx)", ext: "fdx", note: "Opens in Final Draft and compatible apps" },
  fountain: { label: "Fountain", ext: "fountain", note: "Plain-text screenplay format" },
};

function safeName(title: string) {
  return title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Untitled";
}

export async function exportProject(store: ProjectStore, fmt: ExportFormat) {
  await store.flushAll();
  const info = FORMAT_INFO[fmt];
  const path = await pickSavePath(`Export ${info.label}`, join(store.root, "exports", `${safeName(store.data.title)}.${info.ext}`), info.ext);
  if (!path) return;
  const t = store.template;
  const meta = store.meta();
  const items = store.manuscriptItems();
  try {
    if (fmt === "pdf") {
      const g = generateTypst(t, meta, items, { production: store.productionOptions() });
      const r = await call<CompileReport>("export.pdf", { source: g.source, elements: g.elements, path, root: store.root });
      const extra = r.issues.length ? ` (${r.issues.length} layout issue${r.issues.length === 1 ? "" : "s"})` : ", no orphan lines";
      store.toast(`Exported ${r.pageCount} pages to ${path}${extra}.`, r.issues.length ? "warn" : "info");
      return;
    }
    if (fmt === "docx" || fmt === "epub") {
      await call(`export.${fmt}`, { doc: toExportDoc(t, meta, items, store.data.id), path });
    } else if (fmt === "fdx") {
      await fsApi.write(path, toFdx(meta, items), null, true);
    } else {
      await fsApi.write(path, toFountain(t, meta, items), null, true);
    }
    store.toast(`Exported to ${path}.`);
  } catch (e) {
    store.toast(`Export failed: ${(e as Error).message}`, "error");
  }
}

export function ExportMenu({ store }: { store: ProjectStore }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu-anchor">
      <button className="btn ghost small" onClick={() => setOpen((v) => !v)} data-testid="export-btn">
        <Download /> Export
      </button>
      {open && (
        <div className="menu right" onMouseLeave={() => setOpen(false)}>
          {store.template.exports.map((f) => (
            <button key={f} className="menu-item two-line" data-testid={`export-${f}`} onClick={() => { setOpen(false); void exportProject(store, f); }}>
              <span>{FORMAT_INFO[f].label}</span>
              <small>{FORMAT_INFO[f].note}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ThemeMenuProps {
  themes: Theme[];
  current: Theme;
  onPick: (t: Theme) => void;
  onBuild: (base: Theme) => void;
  onDelete: (t: Theme) => void;
}

export function ThemeMenu({ themes, current, onPick, onBuild, onDelete }: ThemeMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu-anchor">
      <button className="btn ghost small" onClick={() => setOpen((v) => !v)} data-testid="theme-btn" title="Theme">
        <Palette /> {current.name}
      </button>
      {open && (
        <div className="menu right" onMouseLeave={() => setOpen(false)}>
          {themes.map((t) => (
            <div key={t.id} className={t.id === current.id ? "menu-item theme-item active" : "menu-item theme-item"}>
              <button className="theme-pick" onClick={() => { onPick(t); setOpen(false); }} data-testid={`theme-${t.id}`}>
                <span className="swatch" style={{ background: t.colors.background, borderColor: t.colors.sidebar }}>
                  <span style={{ background: t.colors.accent }} />
                </span>
                {t.name}
              </button>
              {!t.builtIn && (
                <button className="row-action" title="Delete theme" onClick={() => onDelete(t)}>
                  <Trash />
                </button>
              )}
            </div>
          ))}
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => { setOpen(false); onBuild(current); }} data-testid="theme-build">
            <Plus /> {current.builtIn ? "Build your own…" : `Edit “${current.name}”…`}
          </button>
        </div>
      )}
    </div>
  );
}

export function ProjectSettingsDialog({ store, onClose }: { store: ProjectStore; onClose: () => void }) {
  const d = store.data;
  const [title, setTitle] = useState(d.title);
  const [author, setAuthor] = useState(d.author);
  const [contact, setContact] = useState(d.contact);
  const [titlePage, setTitlePage] = useState(d.settings.titlePage);
  const [paper, setPaper] = useState(d.settings.paper);
  const save = async () => {
    await store.updateMeta({ title: title.trim() || "Untitled", author, contact, settings: { titlePage, paper } });
    onClose();
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small" role="dialog" aria-label="Project settings">
        <div className="modal-head">
          <h2>Project</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </div>
        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>Author</span>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </label>
        <label className="field">
          <span>Contact (title page)</span>
          <textarea rows={3} value={contact} onChange={(e) => setContact(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={titlePage} onChange={(e) => setTitlePage(e.target.checked)} />
          <span>Title page</span>
        </label>
        {store.template.id !== "book" && (
          <div className="field">
            <span>Paper</span>
            <div className="segmented">
              <button className={paper === "us-letter" ? "on" : ""} onClick={() => setPaper("us-letter")}>US Letter</button>
              <button className={paper === "a4" ? "on" : ""} onClick={() => setPaper("a4")}>A4</button>
            </div>
          </div>
        )}
        <p className="muted small-text">
          Format: {store.template.name}. Folder: <code>{store.root}</code>
        </p>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => void save()}>Save</button>
        </div>
      </div>
    </div>
  );
}
