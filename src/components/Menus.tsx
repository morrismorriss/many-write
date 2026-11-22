import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Popover } from "./Popover";
import { sceneNewPageDefault, type SceneBreakStyle } from "../project/model";
import { call, fsApi, imageUrl, join, pickImage, pickSavePath } from "../lib/backend";
import { essayDate, generateTypst } from "../formats/typst";
import { toExportDoc, toFdx, toFountain } from "../formats/exporters";
import { ESSAY_STYLES, type EssayStyle, type ExportFormat, type NotePlacement } from "../formats/templates";
import { describeRanges, parsePageRanges, type PageRange } from "../formats/pages";
import type { ProjectStore } from "../project/store";
import type { Theme } from "../themes/themes";
import type { CompileReport } from "./Preview";
import { Close, Download, Palette, Plus, Trash } from "./icons";

export const FORMAT_INFO: Record<ExportFormat, { label: string; ext: string; note: string }> = {
  pdf: { label: "PDF", ext: "pdf", note: "Exactly as the preview; all pages or the ones you choose" },
  docx: { label: "Word (.docx)", ext: "docx", note: "Keep-with-next and widow control set; Word repaginates" },
  epub: { label: "EPUB", ext: "epub", note: "Reflowable e-book" },
  fdx: { label: "Final Draft (.fdx)", ext: "fdx", note: "Opens in Final Draft and compatible apps" },
  fountain: { label: "Fountain", ext: "fountain", note: "Plain-text screenplay format" },
};

function safeName(title: string) {
  return title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Untitled";
}

/** Ask which pages of the PDF to export. Resolves to null for every page, or undefined if cancelled. */
function askPdfPages(): Promise<PageRange[] | null | undefined> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: PageRange[] | null | undefined) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(<PdfPagesDialog onDone={done} />);
  });
}

function PdfPagesDialog({ onDone }: { onDone: (v: PageRange[] | null | undefined) => void }) {
  const [some, setSome] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (some) input.current?.focus();
  }, [some]);
  const go = () => {
    if (!some) return onDone(null);
    const r = parsePageRanges(text);
    if (!r.ok) return setError(r.error);
    onDone(r.ranges);
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onDone(undefined)}>
      <div
        className="modal small"
        role="dialog"
        aria-label="Export PDF"
        data-testid="pdf-pages-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone(undefined);
          if (e.key === "Enter") go();
        }}
      >
        <div className="modal-head">
          <h2>Export PDF</h2>
          <button className="icon-btn" onClick={() => onDone(undefined)} aria-label="Close">
            <Close />
          </button>
        </div>
        <div className="field">
          <span>Pages</span>
          <div className="segmented">
            <button className={some ? "" : "on"} onClick={() => setSome(false)} data-testid="pdf-pages-all">
              All pages
            </button>
            <button className={some ? "on" : ""} onClick={() => setSome(true)} data-testid="pdf-pages-some">
              Some pages
            </button>
          </div>
        </div>
        {some && (
          <label className="field">
            <span>Page numbers, as counted in the preview</span>
            <input
              ref={input}
              value={text}
              placeholder="For example 1-3, 5, 8-"
              onChange={(e) => {
                setText(e.target.value);
                setError("");
              }}
              data-testid="pdf-pages-input"
            />
            {error && <small className="field-error">{error}</small>}
          </label>
        )}
        <div className="modal-foot">
          <button className="btn" onClick={() => onDone(undefined)}>
            Cancel
          </button>
          <button className="btn primary" onClick={go} data-testid="pdf-pages-export">
            Export…
          </button>
        </div>
      </div>
    </div>
  );
}

export async function exportProject(store: ProjectStore, fmt: ExportFormat) {
  await store.flushAll();
  const info = FORMAT_INFO[fmt];
  let pages: PageRange[] | null = null;
  if (fmt === "pdf") {
    const picked = await askPdfPages();
    if (picked === undefined) return;
    pages = picked;
  }
  const path = await pickSavePath(`Export ${info.label}`, join(store.root, "exports", `${safeName(store.data.title)}.${info.ext}`), info.ext);
  if (!path) return;
  const t = store.template;
  const meta = store.meta();
  const items = store.manuscriptItems();
  try {
    if (fmt === "pdf") {
      const g = generateTypst(t, meta, items, { production: store.productionOptions() });
      const r = await call<CompileReport & { exportedPages?: number }>("export.pdf", { source: g.source, elements: g.elements, path, root: store.root, pages });
      const extra = r.issues.length ? ` (${r.issues.length} layout issue${r.issues.length === 1 ? "" : "s"})` : ", no orphan lines";
      const which = pages ? `page${r.exportedPages === 1 ? "" : "s"} ${describeRanges(pages)} (${r.exportedPages ?? "?"} of ${r.pageCount})` : `${r.pageCount} pages`;
      store.toast(`Exported ${which} to ${path}${extra}.`, r.issues.length ? "warn" : "info");
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
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <div className="menu-anchor" ref={anchor}>
      <button className="btn ghost small" onClick={() => setOpen((v) => !v)} data-testid="export-btn">
        <Download /> Export
      </button>
      {open && (
        <Popover anchor={anchor} align="right" onMouseLeave={() => setOpen(false)}>
          {store.template.exports.map((f) => (
            <button key={f} className="menu-item two-line" data-testid={`export-${f}`} onClick={() => { setOpen(false); void exportProject(store, f); }}>
              <span>{FORMAT_INFO[f].label}</span>
              <small>{FORMAT_INFO[f].note}</small>
            </button>
          ))}
        </Popover>
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
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <div className="menu-anchor" ref={anchor}>
      <button className="icon-btn" onClick={() => setOpen((v) => !v)} data-testid="theme-btn" title={`Theme: ${current.name}`}>
        <Palette />
      </button>
      {open && (
        <Popover anchor={anchor} align="right" onMouseLeave={() => setOpen(false)}>
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
        </Popover>
      )}
    </div>
  );
}

export function ProjectSettingsDialog({ store, onClose }: { store: ProjectStore; onClose: () => void }) {
  const d = store.data;
  const [title, setTitle] = useState(d.title);
  const [subtitle, setSubtitle] = useState(d.subtitle ?? "");
  const [author, setAuthor] = useState(d.author);
  const [contact, setContact] = useState(d.contact);
  const [titlePage, setTitlePage] = useState(d.settings.titlePage);
  const [paper, setPaper] = useState(d.settings.paper);
  const script = store.template.mode === "script";
  const [sceneNewPage, setSceneNewPage] = useState(sceneNewPageDefault(d.template, d.settings.sceneNewPage));
  const [autoContd, setAutoContd] = useState(d.settings.autoContd ?? store.template.id === "screenplay");
  const essay = store.template.id === "essay";
  const book = store.template.id === "book";
  const [sceneBreak, setSceneBreak] = useState<SceneBreakStyle>(d.settings.sceneBreak ?? "asterisks");
  const [breakImage, setBreakImage] = useState<string | undefined>(d.settings.sceneBreakImage);
  const [breakPreview, setBreakPreview] = useState<string | null>(null);
  useEffect(() => {
    setBreakPreview(null);
    if (breakImage) void imageUrl(store.abs(breakImage)).then(setBreakPreview, () => setBreakPreview(null));
  }, [store, breakImage]);
  const chooseBreakImage = async () => {
    const f = await pickImage();
    if (!f) return;
    try {
      setBreakImage(await store.addImage(`scene-break-${f.name}`, f));
      setSceneBreak("image");
    } catch (e) {
      store.toast(`Could not add the picture: ${(e as Error).message}`, "error");
    }
  };
  const [essayStyle, setEssayStyle] = useState<EssayStyle | "chicago">(d.settings.essayStyle ?? "mla");
  const [notePlacement, setNotePlacement] = useState<NotePlacement>(d.settings.notePlacement ?? "footnotes");
  const [instructor, setInstructor] = useState(d.settings.instructor ?? "");
  const [course, setCourse] = useState(d.settings.course ?? "");
  const [date, setDate] = useState(d.settings.date ?? "");
  const save = async () => {
    const essaySettings = essay ? { essayStyle, notePlacement, instructor, course, date } : {};
    const bookSettings = book ? { sceneBreak: sceneBreak === "image" && !breakImage ? ("asterisks" as const) : sceneBreak, sceneBreakImage: breakImage } : {};
    const scriptSettings = script ? { sceneNewPage, autoContd } : {};
    await store.updateMeta({ title: title.trim() || "Untitled", subtitle: subtitle.trim(), author, contact, settings: { titlePage, paper, ...essaySettings, ...bookSettings, ...scriptSettings } });
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
          <span>Subtitle</span>
          <input value={subtitle} placeholder="Optional: printed under the title" onChange={(e) => setSubtitle(e.target.value)} data-testid="settings-subtitle" />
        </label>
        <label className="field">
          <span>Author</span>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </label>
        {essay ? (
          <>
            <div className="field">
              <span>Style</span>
              <div className="segmented" data-testid="settings-essay-style">
                {ESSAY_STYLES.map((s) => (
                  <button key={s.id} className={essayStyle === s.id ? "on" : ""} onClick={() => setEssayStyle(s.id)}>
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
            {essayStyle === "chicago" && (
              <p className="muted small-text">This project still uses the older Chicago author–date style. Choosing Chicago switches it to notes–bibliography.</p>
            )}
            {essayStyle === "chicago-notes" && (
              <div className="field">
                <span>Notes</span>
                <div className="segmented" data-testid="settings-note-placement">
                  <button className={notePlacement === "footnotes" ? "on" : ""} onClick={() => setNotePlacement("footnotes")}>
                    Footnotes
                  </button>
                  <button className={notePlacement === "endnotes" ? "on" : ""} onClick={() => setNotePlacement("endnotes")}>
                    Endnotes
                  </button>
                </div>
              </div>
            )}
            <label className="field">
              <span>Instructor</span>
              <input value={instructor} placeholder="Professor Surname" onChange={(e) => setInstructor(e.target.value)} data-testid="essay-instructor" />
            </label>
            <label className="field">
              <span>Course</span>
              <input value={course} placeholder="English 101" onChange={(e) => setCourse(e.target.value)} data-testid="essay-course" />
            </label>
            <label className="field">
              <span>Date</span>
              <input value={date} placeholder={`Today: ${essayDate(essayStyle)}`} onChange={(e) => setDate(e.target.value)} />
            </label>
            {(essayStyle === "chicago" || essayStyle === "chicago-notes") && (
              <label className="check">
                <input type="checkbox" checked={titlePage} onChange={(e) => setTitlePage(e.target.checked)} />
                <span>Title page</span>
              </label>
            )}
          </>
        ) : (
          <>
            <label className="field">
              <span>Contact (title page)</span>
              <textarea rows={3} value={contact} onChange={(e) => setContact(e.target.value)} />
            </label>
            <label className="check">
              <input type="checkbox" checked={titlePage} onChange={(e) => setTitlePage(e.target.checked)} />
              <span>Title page</span>
            </label>
          </>
        )}
        {script && (
          <>
            <label className="check">
              <input type="checkbox" checked={sceneNewPage} onChange={(e) => setSceneNewPage(e.target.checked)} data-testid="scene-new-page" />
              <span>Start each scene on a new page</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={autoContd} onChange={(e) => setAutoContd(e.target.checked)} data-testid="auto-contd" />
              <span>
                Add (CONT'D) when a character speaks again after a direction
                <span className="clause-text">On the page and in exports; your files are not changed. Type “(” after a name for (V.O.), (O.S.) or (CONT'D) yourself.</span>
              </span>
            </label>
          </>
        )}
        {book && (
          <div className="field">
            <span>Scene break</span>
            <div className="segmented" data-testid="scene-break">
              {(
                [
                  ["asterisks", "* * *"],
                  ["line", "——"],
                  ["hearts", "♥ ♥ ♥"],
                  ["image", "Picture"],
                ] as [SceneBreakStyle, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={sceneBreak === id ? "on" : ""}
                  data-testid={`break-${id}`}
                  onClick={() => (id === "image" && !breakImage ? void chooseBreakImage() : setSceneBreak(id))}
                >
                  {label}
                </button>
              ))}
            </div>
            {sceneBreak === "image" && breakImage && (
              <div className="bg-picker" style={{ marginTop: 6 }}>
                {breakPreview ? <img className="bg-thumb" style={{ objectFit: "contain" }} src={breakPreview} alt="" /> : <div className="bg-thumb empty" />}
                <button className="btn small" onClick={() => void chooseBreakImage()} data-testid="break-choose">
                  Change picture…
                </button>
              </div>
            )}
          </div>
        )}
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
