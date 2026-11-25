import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { call, fsApi, join, pickSavePath } from "../lib/backend";
import { buildReport, formatEighths, pageSpan, reportCsv, reportTypst, sceneList, type ProductionReport, type ReportSection } from "../formats/report";
import { itemsForPlay, playsOf } from "../formats/tableread";
import type { ProjectStore } from "../project/store";
import { Close } from "./icons";

/** Open the production report for a stage play, collection or screenplay. */
export async function openProductionReport(store: ProjectStore, onJump?: (elementId: string) => void) {
  if (store.template.mode !== "script") return;
  await store.flushAll();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
  };
  root.render(
    <ProductionReportDialog
      store={store}
      onClose={close}
      onJump={
        onJump &&
        ((id) => {
          close();
          onJump(id);
        })
      }
    />,
  );
}

const TABS: { id: ReportSection; label: string; screenplayOnly?: boolean }[] = [
  { id: "scenes", label: "Scenes" },
  { id: "cast", label: "Cast" },
  { id: "locations", label: "Locations", screenplayOnly: true },
  { id: "plot", label: "Scene plot" },
];

function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Untitled";
}

function ProductionReportDialog({ store, onClose, onJump }: { store: ProjectStore; onClose: () => void; onJump?: (elementId: string) => void }) {
  const screenplay = store.data.template === "screenplay";
  const all = useMemo(() => store.manuscriptItems(), [store]);
  const plays = useMemo(() => playsOf(all), [all]);
  const [playId, setPlayId] = useState<string | null>(null);
  const [tab, setTab] = useState<ReportSection>("scenes");
  const report = useMemo<ProductionReport>(() => {
    const t = store.lastTypeset;
    const layout = t ? store.reportLayout(t.report, t.ids) : undefined;
    return buildReport(playId ? itemsForPlay(all, playId) : all, screenplay, layout);
  }, [store, all, playId, screenplay]);
  const play = plays.find((p) => p.id === playId);
  const title = play?.title || store.data.title || "Untitled";
  const multi = new Set(report.scenes.map((s) => s.play)).size > 1;

  const exportCsv = async () => {
    const path = await pickSavePath("Export CSV", join(store.root, "exports", `${safeName(title)} - ${TABS.find((t) => t.id === tab)!.label}.csv`), "csv");
    if (!path) return;
    try {
      // A byte-order mark so spreadsheet apps read accented names and dashes as UTF-8.
      await fsApi.write(path, "\uFEFF" + reportCsv(report, tab), null, true);
      store.toast(`Exported to ${path}.`);
    } catch (e) {
      store.toast(`Export failed: ${(e as Error).message}`, "error");
    }
  };
  const exportPdf = async () => {
    const path = await pickSavePath("Export production report", join(store.root, "exports", `${safeName(title)} - Production report.pdf`), "pdf");
    if (!path) return;
    const prod = store.inProduction ? store.production : null;
    const source = reportTypst(
      report,
      { title, author: store.data.author, paper: store.data.settings.paper, revision: prod ? `${prod.revision} Rev. ${prod.revisionDate}` : undefined },
      new Date().toLocaleDateString(),
    );
    try {
      const r = await call<{ pageCount: number }>("export.pdf", { source, elements: [], path, root: store.root, pages: null });
      store.toast(`Exported the production report (${r.pageCount} page${r.pageCount === 1 ? "" : "s"}) to ${path}.`);
    } catch (e) {
      store.toast(`Export failed: ${(e as Error).message}`, "error");
    }
  };

  const jump = (docId: string, index: number) => onJump?.(`${docId}#${index}`);
  const len = (e: number | undefined) => (e ? formatEighths(e) : "—");
  const speaking = report.cast.filter((c) => c.speeches).length;
  const silent = report.cast.length - speaking;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal report-dialog" role="dialog" aria-label="Production report" data-testid="production-report" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="modal-head">
          <h2>Production report</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </div>

        {plays.length > 0 && (
          <label className="field inline report-play">
            <span>Play</span>
            <select value={playId ?? ""} onChange={(e) => setPlayId(e.target.value || null)} data-testid="report-play">
              <option value="">The whole collection</option>
              {plays.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="stats-total report-summary" data-testid="report-summary">
          <div>
            <b>{report.scenes.length}</b>
            <small>scenes</small>
          </div>
          <div>
            <b>{report.measured ? formatEighths(report.eighths) : "—"}</b>
            <small>pages</small>
          </div>
          <div>
            <b>{speaking}</b>
            <small>speaking roles</small>
          </div>
          {silent > 0 && (
            <div>
              <b>{silent}</b>
              <small>non-speaking</small>
            </div>
          )}
          {screenplay && (
            <>
              <div>
                <b>{report.locations.length}</b>
                <small>locations</small>
              </div>
              <div>
                <b>
                  {report.split.int}/{report.split.ext}
                  {report.split.both > 0 && <span className="muted"> +{report.split.both}</span>}
                </b>
                <small>int / ext{report.split.both > 0 ? " / both" : ""}</small>
              </div>
              <div>
                <b>
                  {report.split.day}/{report.split.night}
                </b>
                <small>day / night</small>
              </div>
            </>
          )}
        </div>

        <div className="segmented report-tabs" role="tablist">
          {TABS.filter((t) => screenplay || !t.screenplayOnly).map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)} data-testid={`report-tab-${t.id}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="report-scroll">
          {!report.scenes.length ? (
            <p className="panel-text">There are no scenes in this script yet.</p>
          ) : tab === "scenes" ? (
            <table className="report-table" data-testid="report-scenes">
              <thead>
                <tr>
                  <th className="num">#</th>
                  {multi && <th>Play</th>}
                  {screenplay ? (
                    <>
                      <th>I/E</th>
                      <th>Location</th>
                      <th>Time</th>
                    </>
                  ) : (
                    <>
                      <th>Act</th>
                      <th>Scene</th>
                    </>
                  )}
                  <th className="num">Page</th>
                  <th className="num">Length</th>
                  <th>Cast</th>
                </tr>
              </thead>
              <tbody>
                {report.scenes.map((s, i) => (
                  <tr key={i} className={onJump ? "clickable" : ""} onClick={() => jump(s.docId, s.start)} title={onJump ? "Go to this scene" : undefined}>
                    <td className="num">{s.number}</td>
                    {multi && <td>{s.play}</td>}
                    {screenplay ? (
                      <>
                        <td>{s.slug.ie}</td>
                        <td>{s.slug.location || s.heading}</td>
                        <td>{s.slug.time}</td>
                      </>
                    ) : (
                      <>
                        <td>{s.act}</td>
                        <td>{s.heading}</td>
                      </>
                    )}
                    <td className="num">{pageSpan(s) || "—"}</td>
                    <td className="num">{len(s.pages?.eighths)}</td>
                    <td className="report-cast">
                      {[...s.speakers.keys()].join(", ")}
                      {s.silent.size > 0 && <span className="muted">{(s.speakers.size ? ", " : "") + [...s.silent].map((n) => `(${n})`).join(", ")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : tab === "cast" ? (
            <table className="report-table" data-testid="report-cast">
              <thead>
                <tr>
                  <th>Character</th>
                  <th className="num">Speeches</th>
                  <th className="num">Words</th>
                  <th className="num">Scenes</th>
                  <th className="num">Pages</th>
                  <th className="num">First</th>
                  <th>Scenes in</th>
                </tr>
              </thead>
              <tbody>
                {report.cast.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td className="num">{c.speeches}</td>
                    <td className="num">{c.words.toLocaleString()}</td>
                    <td className="num" title={c.silent ? `${c.speaking} speaking, ${c.silent} without speaking` : undefined}>
                      {c.speaking}
                      {c.silent > 0 && <span className="muted"> +{c.silent}</span>}
                    </td>
                    <td className="num">{report.measured ? len(c.eighths) : "—"}</td>
                    <td className="num">{c.firstPage || "—"}</td>
                    <td>{sceneList(c.scenes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : tab === "locations" ? (
            report.locations.length ? (
              <table className="report-table" data-testid="report-locations">
                <thead>
                  <tr>
                    <th>Location</th>
                    <th>I/E</th>
                    <th>Time</th>
                    <th className="num">Scenes</th>
                    <th className="num">Pages</th>
                    <th>Scene numbers</th>
                  </tr>
                </thead>
                <tbody>
                  {report.locations.map((l) => (
                    <tr key={l.location}>
                      <td>{l.location}</td>
                      <td>{l.ie.join(", ")}</td>
                      <td>{l.times.join(", ")}</td>
                      <td className="num">{l.scenes.length}</td>
                      <td className="num">{report.measured ? len(l.eighths) : "—"}</td>
                      <td>{sceneList(l.scenes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="panel-text">No scene headings with a location yet. Write them as INT. KITCHEN - NIGHT.</p>
            )
          ) : (
            <table className="report-table report-plot" data-testid="report-plot">
              <thead>
                <tr>
                  <th />
                  {report.scenes.map((s, i) => (
                    <th key={i} className="plot-cell" title={`${multi && s.play ? `${s.play}: ` : ""}${s.act ? `${s.act}, ` : ""}${s.heading}`}>
                      {s.number}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.cast.map((c) => (
                  <tr key={c.name}>
                    <td className="plot-name">{c.name}</td>
                    {report.scenes.map((s, i) => (
                      <td key={i} className="plot-cell">
                        {s.speakers.has(c.name) ? <span title="Speaks">●</span> : s.silent.has(c.name) ? <span className="muted" title="In the scene without speaking">○</span> : ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="panel-hint">
          {report.measured ? "Lengths are in eighths of a page, measured from the typeset script." : "Page counts appear once the preview has typeset the script."}{" "}
          Names in brackets, and ○ in the plot, are characters named in capitals in a {screenplay ? "scene's action" : "stage direction"} who do not speak there.
        </p>

        <div className="modal-foot">
          <button className="btn" onClick={() => void exportCsv()} data-testid="report-export-csv" disabled={!report.scenes.length}>
            Export {TABS.find((t) => t.id === tab)!.label.toLowerCase()} as CSV…
          </button>
          <button className="btn primary" onClick={() => void exportPdf()} data-testid="report-export-pdf" disabled={!report.scenes.length}>
            Export PDF…
          </button>
        </div>
      </div>
    </div>
  );
}
