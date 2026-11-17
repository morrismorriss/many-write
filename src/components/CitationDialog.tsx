import { useState } from "react";
import { createPortal } from "react-dom";
import { inTextCitation, referenceEntry, SOURCE_KINDS, sourcesPageTitle, type CitationStyle, type Source, type SourceAuthor, type SourceKind } from "../formats/citations";
import type { Run } from "../formats/markdown";
import { newId } from "../project/model";
import { Close, Plus, Trash } from "./icons";

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((r, i) => (r.italic ? <em key={i}>{r.text}</em> : <span key={i}>{r.text}</span>))}
    </>
  );
}

type Field = { key: keyof Source; label: string; placeholder: string; only?: CitationStyle };

const FIELDS: Record<SourceKind, Field[]> = {
  book: [
    { key: "publisher", label: "Publisher", placeholder: "Penguin" },
    { key: "city", label: "City", placeholder: "New York", only: "chicago" },
    { key: "year", label: "Year", placeholder: "2020" },
  ],
  article: [
    { key: "container", label: "Journal or magazine", placeholder: "The Atlantic" },
    { key: "volume", label: "Volume", placeholder: "12" },
    { key: "issue", label: "Issue", placeholder: "3" },
    { key: "year", label: "Year", placeholder: "2020" },
    { key: "pages", label: "Pages", placeholder: "10–20" },
    { key: "url", label: "DOI or web address", placeholder: "Optional" },
  ],
  website: [
    { key: "container", label: "Website", placeholder: "BBC News" },
    { key: "date", label: "Published", placeholder: "4 May 2024" },
    { key: "year", label: "Year", placeholder: "2024", only: "chicago" },
    { key: "url", label: "Web address", placeholder: "www.example.com/page" },
    { key: "accessed", label: "Accessed", placeholder: "Optional: the day you read it" },
  ],
};

/**
 * "/cite" › Citation…: enter a source once. Its entry goes on the Works Cited
 * or Bibliography page, an in-text citation goes at the cursor, and the source
 * is remembered so the next "/cite" offers it with one click.
 */
export function CitationDialog({
  style: initialStyle,
  fixedStyle,
  onDone,
  onCancel,
}: {
  style: CitationStyle;
  /** Essays: the style is set by the essay itself. */
  fixedStyle: boolean;
  onDone: (src: Source, page: string, style: CitationStyle) => void;
  onCancel: () => void;
}) {
  const [style, setStyle] = useState<CitationStyle>(initialStyle);
  const [kind, setKind] = useState<SourceKind>("book");
  const [authors, setAuthors] = useState<SourceAuthor[]>([{ first: "", last: "" }]);
  const [fields, setFields] = useState<Partial<Record<keyof Source, string>>>({});
  const [page, setPage] = useState("");
  const set = (k: keyof Source, v: string) => setFields((f) => ({ ...f, [k]: v }));
  const source = (): Source => {
    const s: Source = { id: newId(), kind, authors: authors.filter((a) => a.first.trim() || a.last.trim()), title: (fields.title ?? "").trim() };
    for (const f of FIELDS[kind]) if (fields[f.key]?.trim() && (!f.only || f.only === style)) (s as unknown as Record<string, string>)[f.key] = fields[f.key]!.trim();
    return s;
  };
  const src = source();
  const ready = !!src.title;
  const done = () => ready && onDone(src, page, style);
  // Over the whole window, above the preview, like the app's other dialogs.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="modal small citation-dialog"
        role="dialog"
        aria-label="Citation"
        data-testid="citation-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) done();
        }}
      >
        <div className="modal-head">
          <h2>Citation</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Close">
            <Close />
          </button>
        </div>
        <div className="field">
          <span>Style</span>
          {fixedStyle ? (
            <span className="muted small-text">{style === "mla" ? "MLA" : "Chicago (author–date)"}, as set for this essay</span>
          ) : (
            <div className="segmented" data-testid="cite-style">
              <button className={style === "mla" ? "on" : ""} onClick={() => setStyle("mla")}>
                MLA
              </button>
              <button className={style === "chicago" ? "on" : ""} onClick={() => setStyle("chicago")}>
                Chicago
              </button>
            </div>
          )}
        </div>
        <div className="field">
          <span>Source</span>
          <div className="segmented" data-testid="cite-kind">
            {SOURCE_KINDS.map((k) => (
              <button key={k.id} className={kind === k.id ? "on" : ""} onClick={() => setKind(k.id)}>
                {k.name}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Author{authors.length > 1 ? "s" : ""}</span>
          <div className="cite-authors">
            {authors.map((a, i) => (
              <div key={i} className="cite-author">
                <input
                  value={a.first}
                  placeholder="First name"
                  aria-label={`Author ${i + 1} first name`}
                  autoFocus={i === 0}
                  data-testid={`cite-first-${i}`}
                  onChange={(e) => setAuthors((as) => as.map((x, j) => (j === i ? { ...x, first: e.target.value } : x)))}
                />
                <input
                  value={a.last}
                  placeholder="Surname"
                  aria-label={`Author ${i + 1} surname`}
                  data-testid={`cite-last-${i}`}
                  onChange={(e) => setAuthors((as) => as.map((x, j) => (j === i ? { ...x, last: e.target.value } : x)))}
                />
                {authors.length > 1 && (
                  <button className="icon-btn" aria-label="Remove author" onClick={() => setAuthors((as) => as.filter((_, j) => j !== i))}>
                    <Trash />
                  </button>
                )}
              </div>
            ))}
            {authors.length < 6 && (
              <button className="btn ghost small" onClick={() => setAuthors((as) => [...as, { first: "", last: "" }])}>
                <Plus /> Another author
              </button>
            )}
          </div>
        </div>
        <label className="field">
          <span>Title</span>
          <input value={fields.title ?? ""} placeholder={kind === "book" ? "The title of the book" : kind === "article" ? "The title of the article" : "The title of the page"} onChange={(e) => set("title", e.target.value)} data-testid="cite-title" />
        </label>
        <div className="cite-grid">
          {FIELDS[kind]
            .filter((f) => !f.only || f.only === style)
            .map((f) => (
              <label key={f.key} className="field">
                <span>{f.label}</span>
                <input value={fields[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} data-testid={`cite-${f.key}`} />
              </label>
            ))}
          <label className="field">
            <span>Page cited</span>
            <input value={page} placeholder="Optional, e.g. 23" onChange={(e) => setPage(e.target.value)} data-testid="cite-page" />
          </label>
        </div>
        <div className="cite-preview" aria-live="polite">
          <div className="cite-preview-label">In the text</div>
          <div data-testid="cite-preview-intext">
            <Runs runs={inTextCitation(src, style, page).runs} />
          </div>
          <div className="cite-preview-label">{sourcesPageTitle(style)}</div>
          <div className="cite-entry" data-testid="cite-preview-entry">
            <Runs runs={referenceEntry(src, style)} />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ready} onClick={done} data-testid="cite-insert">
            Insert citation
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
