import { useEffect, useState } from "react";
import { appPaths, join, pickFolder } from "../lib/backend";
import { TEMPLATE_ORDER, TEMPLATES, type TemplateId } from "../formats/templates";
import { createProject, forgetRecent, readRecent, type RecentProject } from "../project/store";
import { Close } from "./icons";

interface Props {
  onOpen: (root: string) => void;
  error: string | null;
}

export function Welcome({ onOpen, error }: Props) {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [creating, setCreating] = useState(false);
  const [template, setTemplate] = useState<TemplateId>("stage-play");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void readRecent().then(setRecent);
    void appPaths().then((p) => setLocation(join(p.documents, "Many Write")));
  }, []);

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const root = await createProject(location, title.trim() || "Untitled", template, author.trim());
      onOpen(root);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    const p = await pickFolder("Open a project folder", location);
    if (p) onOpen(p);
  };

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <h1 className="wordmark">Many Write</h1>
        <p className="tagline">Plays, screenplays, books, articles and poems. Plain files on your computer.</p>
        {(error || err) && <div className="banner error">{error || err}</div>}
        {!creating ? (
          <>
            <div className="welcome-actions">
              <button className="btn primary" onClick={() => setCreating(true)} data-testid="new-project">
                New project
              </button>
              <button className="btn" onClick={() => void open()} data-testid="open-project">
                Open folder…
              </button>
            </div>
            {recent.length > 0 && (
              <div className="recent">
                <div className="recent-title">Recent</div>
                {recent.map((r) => (
                  <div key={r.root} className="recent-row">
                    <button className="recent-open" onClick={() => onOpen(r.root)}>
                      <span className="recent-name">{r.title}</span>
                      <span className="recent-meta">
                        {TEMPLATES[r.template]?.name ?? ""} · {r.root}
                      </span>
                    </button>
                    <button
                      className="row-action"
                      title="Remove from list"
                      onClick={() => void forgetRecent(r.root).then(() => readRecent().then(setRecent))}
                    >
                      <Close />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="new-project">
            <div className="template-grid">
              {TEMPLATE_ORDER.map((id) => (
                <button key={id} className={template === id ? "template-card on" : "template-card"} onClick={() => setTemplate(id)} data-testid={`tmpl-${id}`}>
                  <span className="template-name">{TEMPLATES[id].name}</span>
                  <span className="template-desc">{TEMPLATES[id].description}</span>
                </button>
              ))}
            </div>
            <label className="field">
              <span>Title</span>
              <input autoFocus value={title} placeholder="My Play" onChange={(e) => setTitle(e.target.value)} data-testid="new-title" />
            </label>
            <label className="field">
              <span>Author</span>
              <input value={author} onChange={(e) => setAuthor(e.target.value)} />
            </label>
            <label className="field">
              <span>Save in</span>
              <div className="path-row">
                <input value={location} onChange={(e) => setLocation(e.target.value)} data-testid="new-location" />
                <button className="btn" onClick={() => void pickFolder("Choose where to save", location).then((p) => p && setLocation(p))}>
                  Choose…
                </button>
              </div>
            </label>
            <p className="muted small-text">
              Creates <code>{join(location, (title.trim() || "Untitled").replace(/[\\/:*?"<>|]+/g, "-"))}</code> with one markdown file per{" "}
              {TEMPLATES[template].docNoun.toLowerCase()}.
            </p>
            <div className="welcome-actions">
              <button className="btn ghost" onClick={() => setCreating(false)}>
                Back
              </button>
              <button className="btn primary" disabled={busy || !location} onClick={() => void create()} data-testid="create-project">
                Create project
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
