import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { call, join, pickFolder } from "../lib/backend";
import { generateTypst } from "../formats/typst";
import { castOf, HIGHLIGHTS, itemsForPlay, playsOf, tableReadFileName } from "../formats/tableread";
import type { ProjectStore } from "../project/store";
import type { CompileReport } from "./Preview";
import { Close } from "./icons";

interface Choice {
  names: string[];
  playId: string | null;
  fill: string;
}

/** Export one PDF per character, each with that character's lines highlighted. */
export async function exportTableRead(store: ProjectStore) {
  await store.flushAll();
  const all = store.manuscriptItems();
  if (!castOf(all).length) {
    store.toast("There are no character cues in this script yet, so there is nobody to highlight.", "warn");
    return;
  }
  const choice = await new Promise<Choice | null>((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: Choice | null) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(<TableReadDialog store={store} onDone={done} />);
  });
  if (!choice) return;
  const folder = await pickFolder("Save the table read PDFs in…", join(store.root, "exports"));
  if (!folder) return;

  const plays = playsOf(all);
  const play = choice.playId ? plays.find((p) => p.id === choice.playId) : undefined;
  const items = play ? itemsForPlay(all, play.id) : all;
  const title = play?.title || store.data.title;
  const meta = store.meta();
  const production = store.productionOptions();
  let done = 0;
  try {
    for (const name of choice.names) {
      store.toast(`Typesetting ${name}'s copy (${done + 1} of ${choice.names.length})…`);
      const g = generateTypst(store.template, meta, items, { production, highlight: { name, fill: choice.fill } });
      const path = join(folder, tableReadFileName(title, name));
      await call<CompileReport>("export.pdf", { source: g.source, elements: g.elements, path, root: store.root, pages: null });
      done++;
    }
    store.toast(`Exported ${done} table read ${done === 1 ? "copy" : "copies"} to ${folder}.`);
  } catch (e) {
    store.toast(`Table read export stopped after ${done} of ${choice.names.length}: ${(e as Error).message}`, "error");
  }
}

function TableReadDialog({ store, onDone }: { store: ProjectStore; onDone: (v: Choice | null) => void }) {
  const all = useMemo(() => store.manuscriptItems(), [store]);
  const plays = useMemo(() => playsOf(all), [all]);
  const [playId, setPlayId] = useState<string | null>(null);
  const cast = useMemo(() => castOf(playId ? itemsForPlay(all, playId) : all), [all, playId]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [fill, setFill] = useState<string>(HIGHLIGHTS[0].fill);
  const picked = cast.filter((c) => !off.has(c.name)).map((c) => c.name);
  const toggle = (name: string) =>
    setOff((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  const go = () => picked.length && onDone({ names: picked, playId, fill });
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onDone(null)}>
      <div
        className="modal small"
        role="dialog"
        aria-label="Table read"
        data-testid="table-read-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone(null);
        }}
      >
        <div className="modal-head">
          <h2>Table read</h2>
          <button className="icon-btn" onClick={() => onDone(null)} aria-label="Close">
            <Close />
          </button>
        </div>
        <p className="clause-text">One PDF for each character you tick, with their cues and lines highlighted and their name at the top of every page.</p>
        {plays.length > 0 && (
          <label className="field">
            <span>Play</span>
            <select value={playId ?? ""} onChange={(e) => setPlayId(e.target.value || null)} data-testid="table-read-play">
              <option value="">The whole collection</option>
              {plays.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="field">
          <span>Highlighter</span>
          <div className="segmented">
            {HIGHLIGHTS.map((h) => (
              <button key={h.id} className={fill === h.fill ? "on" : ""} onClick={() => setFill(h.fill)} data-testid={`table-read-colour-${h.id}`}>
                <span style={{ background: h.fill, color: "#222", padding: "0 6px", borderRadius: 3 }}>{h.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>
            Characters{" "}
            <button className="btn ghost small" onClick={() => setOff(new Set())} data-testid="table-read-all">
              All
            </button>
            <button className="btn ghost small" onClick={() => setOff(new Set(cast.map((c) => c.name)))} data-testid="table-read-none">
              None
            </button>
          </span>
          <div className="clause-list">
            {cast.map((c) => (
              <label key={c.name} className="check clause">
                <input type="checkbox" checked={!off.has(c.name)} onChange={() => toggle(c.name)} data-testid={`table-read-char-${c.name}`} />
                <span>
                  <span className="clause-title">{c.name}</span>
                  <span className="clause-text">
                    {c.speeches} speech{c.speeches === 1 ? "" : "es"}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button className="btn primary" onClick={go} disabled={!picked.length} data-testid="table-read-export">
            Export {picked.length} PDF{picked.length === 1 ? "" : "s"}…
          </button>
        </div>
      </div>
    </div>
  );
}
