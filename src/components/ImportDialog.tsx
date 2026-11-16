import { useEffect, useState } from "react";
import { appPaths, join, pickFolder } from "../lib/backend";
import { TEMPLATE_ORDER, TEMPLATES, type TemplateId } from "../formats/templates";
import { createFromImport, FORMAT_NAMES, formatOf, planImport, type ImportPlan } from "../project/importers";
import { Close } from "./icons";

/** Turn a Word, Final Draft, Fountain, PDF, RTF or Scrivener file into a new project. */
export function ImportDialog({ path, onDone, onCancel }: { path: string; onDone: (root: string) => void; onCancel: () => void }) {
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<TemplateId>("book");
  const [author, setAuthor] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const fmt = formatOf(path);

  useEffect(() => {
    void appPaths().then((p) => setLocation(join(p.documents, "Many Write")));
    planImport(path)
      .then((p) => {
        setPlan(p);
        setTitle(p.title);
        setTemplate(p.template);
      })
      .catch((e) => setError((e as Error).message));
  }, [path]);

  const run = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await createFromImport(location, { ...plan, title: title.trim() || plan.title }, template, author.trim()));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal small" role="dialog" aria-label="Import" data-testid="import-dialog">
        <div className="modal-head">
          <h2>Import {fmt ? FORMAT_NAMES[fmt].toLowerCase() : "file"}</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Close">
            <Close />
          </button>
        </div>
        <p className="muted small-text">
          <code>{path}</code>
        </p>
        {error && <div className="banner error">{error}</div>}
        {!plan && !error && <p className="muted">Reading the file…</p>}
        {plan && (
          <>
            <p className="small-text" data-testid="import-summary">
              {plan.summary} A new project is created; the original file is not changed.
            </p>
            <label className="field">
              <span>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="import-title" />
            </label>
            <label className="field">
              <span>Format</span>
              <select value={template} onChange={(e) => setTemplate(e.target.value as TemplateId)} data-testid="import-template">
                {TEMPLATE_ORDER.map((id) => (
                  <option key={id} value={id}>
                    {TEMPLATES[id].name}
                    {id === plan.template ? " (detected)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Author</span>
              <input value={author} onChange={(e) => setAuthor(e.target.value)} />
            </label>
            <label className="field">
              <span>Save in</span>
              <div className="path-row">
                <input value={location} onChange={(e) => setLocation(e.target.value)} data-testid="import-location" />
                <button className="btn" onClick={() => void pickFolder("Choose where to save", location).then((p) => p && setLocation(p))}>
                  Choose…
                </button>
              </div>
            </label>
          </>
        )}
        <div className="modal-foot">
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={!plan || busy || !location} onClick={() => void run()} data-testid="import-go">
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
