import { useEffect, useState } from "react";
import { appPaths, join, pickFolder } from "../lib/backend";
import { ESSAY_STYLES, TEMPLATE_ORDER, TEMPLATES, type EssayStyle, type TemplateId } from "../formats/templates";
import { createProject, forgetRecent, readRecent, type RecentProject } from "../project/store";
import { Close } from "./icons";

interface Props {
  onOpen: (root: string) => void;
  error: string | null;
  /** Open straight onto the new-project form (File > New project). */
  startNew?: boolean;
  onOpenDocument: () => void;
  onImport: () => void;
}

export function Welcome({ onOpen, error, startNew, onOpenDocument, onImport }: Props) {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [creating, setCreating] = useState(!!startNew);
  const [template, setTemplate] = useState<TemplateId>("stage-play");
  const [essayStyle, setEssayStyle] = useState<EssayStyle>("mla");
  /** A stage play project holding several plays (a trilogy…), each with its own title page and front matter. */
  const [collection, setCollection] = useState(false);
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
      const root = await createProject(location, title.trim() || "Untitled", template, author.trim(), { essayStyle, collection: template === "stage-play" && collection });
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
        <p className="tagline">Plays, screenplays, essays, books, articles and poems. Plain files on your computer.</p>
        {(error || err) && <div className="banner error">{error || err}</div>}
        {!creating ? (
          <>
            <div className="welcome-actions">
              <button className="btn primary" onClick={() => setCreating(true)} data-testid="new-project">
                New project
              </button>
              <button className="btn" onClick={() => void open()} data-testid="open-project">
                Open project…
              </button>
              <button className="btn" onClick={onOpenDocument} data-testid="open-document">
                Open document…
              </button>
              <button className="btn" onClick={onImport} data-testid="import">
                Import…
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
                        {r.single ? "Document" : (TEMPLATES[r.template]?.name ?? "")} · {r.root}
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
              {TEMPLATE_ORDER.flatMap((id) => {
                const card = (
                  <button
                    key={id}
                    className={template === id && !(id === "stage-play" && collection) ? "template-card on" : "template-card"}
                    onClick={() => {
                      setTemplate(id);
                      setCollection(false);
                    }}
                    data-testid={`tmpl-${id}`}
                  >
                    <span className="template-name">{TEMPLATES[id].name}</span>
                    <span className="template-desc">{TEMPLATES[id].description}</span>
                  </button>
                );
                if (id !== "stage-play") return [card];
                // A collection of plays is a stage play project with a folder per play.
                return [
                  card,
                  <button
                    key="play-collection"
                    className={template === "stage-play" && collection ? "template-card on" : "template-card"}
                    onClick={() => {
                      setTemplate("stage-play");
                      setCollection(true);
                    }}
                    data-testid="tmpl-play-collection"
                  >
                    <span className="template-name">Play collection</span>
                    <span className="template-desc">Several plays in one book, like a trilogy: each with its own title page, front matter and acts. Import a Final Draft file into each.</span>
                  </button>,
                ];
              })}
            </div>
            {template === "essay" && (
              <div className="field" data-testid="essay-style">
                <span>Style</span>
                <div className="style-cards">
                  {ESSAY_STYLES.map((s) => (
                    <button key={s.id} className={essayStyle === s.id ? "style-card on" : "style-card"} onClick={() => setEssayStyle(s.id)} data-testid={`style-${s.id}`} aria-pressed={essayStyle === s.id}>
                      <span className="template-name">{s.name}</span>
                      <span className="template-desc">{s.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="field">
              <span>Title</span>
              <input autoFocus value={title} placeholder={template === "essay" ? "My Essay" : "My Play"} onChange={(e) => setTitle(e.target.value)} data-testid="new-title" />
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
              {TEMPLATES[template].docNoun.toLowerCase()}
              {template === "stage-play" && collection && <>, and three plays to start with (add more with the masks button above the manuscript)</>}
              {template === "essay" && <>, and a {ESSAY_STYLES.find((s) => s.id === essayStyle)!.sources} page in the back matter</>}.
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
