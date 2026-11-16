import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectStore, RecentProject } from "../project/store";
import { readRecent } from "../project/store";
import { calendarWeek, perDayToDeadline, wordsToday } from "../project/goals";
import { REVISION_COLORS } from "../project/production";
import { manuscriptOrder, type Role } from "../project/model";
import { wordCount } from "../formats/exporters";
import { blockText } from "../formats/markdown";
import { findInBlocks, replaceInBlocks, searchRegex, type Match } from "../formats/search";
import type { SearchHighlight } from "../editor/extensions";
import { TEMPLATES, type ExportFormat } from "../formats/templates";
import { FORMAT_INFO } from "./Menus";
import { Popover } from "./Popover";
import type { CompileReport } from "./Preview";
import { ArrowDown, ArrowUp, BarChart, Check, Close, FileIcon, Lock, Search, TargetIcon, Tomato } from "./icons";

/** A small popover that closes on outside click or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // The panel is rendered in a portal, outside `ref`, so clicks inside it count as inside too.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  return { open, setOpen, ref, panelRef };
}

// ------------------------------------------------------------------- File

interface FileMenuProps {
  onNew: () => void;
  onNewDocument: () => void;
  onOpenDocument: () => void;
  onImport: () => void;
  onOpenFolder: () => void;
  onOpen: (root: string) => void;
  onClose: () => void;
  onSettings: () => void;
  spellcheck: boolean;
  onToggleSpellcheck: () => void;
  currentRoot: string;
  single?: boolean;
  exports: ExportFormat[];
  onExport: (f: ExportFormat) => void;
}

export function FileMenu(p: FileMenuProps) {
  const { open, setOpen, ref, panelRef } = usePopover();
  const [recent, setRecent] = useState<RecentProject[]>([]);
  useEffect(() => {
    if (open) void readRecent().then(setRecent);
  }, [open]);
  const run = (f: () => void) => () => {
    setOpen(false);
    f();
  };
  return (
    <div className="menu-anchor" ref={ref}>
      <button className="btn ghost small" onClick={() => setOpen((v) => !v)} data-testid="file-btn">
        <FileIcon /> File
      </button>
      {open && (
        <Popover anchor={ref} panelRef={panelRef} className="file-menu">
          <button className="menu-item" onClick={run(p.onNew)} data-testid="file-new">
            New project…
          </button>
          <button className="menu-item" onClick={run(p.onOpenFolder)} data-testid="file-open">
            Open project folder…
          </button>
          <button className="menu-item" onClick={run(p.onNewDocument)} data-testid="file-new-doc">
            New document…
          </button>
          <button className="menu-item" onClick={run(p.onOpenDocument)} data-testid="file-open-doc">
            Open document…
          </button>
          <button className="menu-item two-line" onClick={run(p.onImport)} data-testid="file-import">
            <span>Import…</span>
            <small>Word, Final Draft, Fountain, PDF, RTF</small>
          </button>
          <div className="menu-sep" />
          <div className="menu-label">Recent projects</div>
          {recent.filter((r) => r.root !== p.currentRoot).length === 0 && <div className="menu-empty">No other recent projects</div>}
          {recent
            .filter((r) => r.root !== p.currentRoot)
            .slice(0, 8)
            .map((r) => (
              <button key={r.root} className="menu-item two-line" onClick={run(() => p.onOpen(r.root))} title={r.root}>
                <span>{r.title}</span>
                <small>{r.single ? "Document" : (TEMPLATES[r.template]?.name ?? "")}</small>
              </button>
            ))}
          <div className="menu-sep" />
          {!p.single && (
            <button className="menu-item" onClick={run(p.onSettings)}>
              Project settings…
            </button>
          )}
          <button className="menu-item" onClick={p.onToggleSpellcheck} data-testid="toggle-spellcheck">
            <span>Check spelling as you type</span>
            {p.spellcheck && <Check />}
          </button>
          <div className="menu-sep" />
          <div className="menu-label">Export</div>
          {p.exports.map((f) => (
            <button key={f} className="menu-item" onClick={run(() => p.onExport(f))} data-testid={`file-export-${f}`}>
              {FORMAT_INFO[f].label}
            </button>
          ))}
          <div className="menu-sep" />
          <button className="menu-item" onClick={run(p.onClose)}>
            Close project
          </button>
        </Popover>
      )}
    </div>
  );
}

// -------------------------------------------------------------- Production

interface ProductionProps {
  store: ProjectStore;
  /** Lock the pages as currently typeset. */
  onLock: (revision: string) => void;
}

export function ProductionMenu({ store, onLock }: ProductionProps) {
  const { open, setOpen, ref, panelRef } = usePopover();
  const prod = store.production;
  const active = store.inProduction;
  const script = store.template.mode === "script";
  const nextColor = REVISION_COLORS[(REVISION_COLORS.indexOf(prod?.revision ?? "White") + 1) % REVISION_COLORS.length];
  const [color, setColor] = useState(prod && !prod.active ? nextColor : "White");
  return (
    <div className="menu-anchor" ref={ref}>
      <button className={active ? "btn small production on" : "btn ghost small"} onClick={() => setOpen((v) => !v)} data-testid="production-btn" title="Production mode: lock page numbers for revisions">
        <Lock /> {active ? `${prod!.revision} revision` : "Production"}
      </button>
      {open && (
        <Popover anchor={ref} panelRef={panelRef} className="panel production-panel">
          <div className="panel-title">Production mode</div>
          {!script ? (
            <p className="panel-text">Production mode is for stage plays and screenplays, where page numbers must not move between drafts.</p>
          ) : !active ? (
            <>
              <p className="panel-text">
                Locks every page number as it is now. After that, a rewrite that runs long goes onto added pages (12A, 12B), a cut leaves white space, page 13 stays page 13, and changed lines get an <b>*</b> in the margin.
              </p>
              <label className="field">
                <span>Revision colour</span>
                <select value={color} onChange={(e) => setColor(e.target.value)} data-testid="revision-color">
                  {REVISION_COLORS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <button
                className="btn primary"
                data-testid="lock-pages"
                onClick={() => {
                  setOpen(false);
                  onLock(color);
                }}
              >
                Lock pages
              </button>
            </>
          ) : (
            <>
              <p className="panel-text">
                <b>{prod!.pageCount} pages locked.</b> {prod!.revision} revision, {prod!.revisionDate}. An edited page gets a letter (3A), changed lines a *, and its old version goes to the Archive.
              </p>
              <RevisedPages store={store} onClose={() => setOpen(false)} />
              <button
                className="btn"
                data-testid="next-revision"
                onClick={() => {
                  void store.nextRevision(nextColor);
                  setOpen(false);
                }}
              >
                Start {nextColor} revision
              </button>
              <p className="panel-hint">Clears the * marks: today's script becomes the baseline. Page numbers stay locked.</p>
              <button
                className="btn ghost"
                data-testid="unlock-pages"
                onClick={() => {
                  if (window.confirm("Leave production mode? Page numbers will flow freely again (A-pages disappear).")) void store.unlockPages();
                  setOpen(false);
                }}
              >
                Leave production mode
              </button>
            </>
          )}
        </Popover>
      )}
    </div>
  );
}

/** The pages edited in this revision, with a letter picker and a link to each old version. */
function RevisedPages({ store, onClose }: { store: ProjectStore; onClose: () => void }) {
  const prod = store.production!;
  const { edited } = store.productionPages();
  if (!edited.length) return <p className="panel-hint">No pages have been edited in this revision yet.</p>;
  return (
    <div className="revised-pages" data-testid="revised-pages">
      <div className="menu-label">Revised pages</div>
      {edited.map((page) => {
        const current = prod.currentLetters?.[page] ?? (prod.pageLetters?.[page] ?? 0) + 1;
        const archived = prod.archived?.[`${prod.revision}:${page}`];
        return (
          <div key={page} className="revised-row">
            <span>Page {page}</span>
            <select
              value={current}
              onChange={(e) => void store.setPageLetter(page, Number(e.target.value))}
              data-testid={`page-letter-${page}`}
              title="The number this page prints with"
            >
              {Array.from({ length: 27 }, (_, i) => (
                <option key={i} value={i}>
                  {page}
                  {i ? String.fromCharCode(64 + i) : ""}
                </option>
              ))}
            </select>
            {archived && store.node(archived) ? (
              <button
                className="btn ghost small"
                onClick={() => {
                  onClose();
                  void store.select(archived);
                }}
                data-testid={`old-version-${page}`}
              >
                Old version
              </button>
            ) : (
              <span className="muted small-text">Archiving…</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Goals

export function GoalsWidget({ store }: { store: ProjectStore }) {
  const { open, setOpen, ref, panelRef } = usePopover();
  const total = store.manuscriptWords();
  const g = store.goals;
  const today = wordsToday(g, total);
  const pct = g.daily ? Math.min(1, today / g.daily) : 0;
  const week = calendarWeek(g);
  const max = Math.max(g.daily, ...week.map((h) => h.words), 1);
  const need = perDayToDeadline(g, total);
  return (
    <div className="menu-anchor" ref={ref}>
      <button className="btn ghost small goal-btn" onClick={() => setOpen((v) => !v)} data-testid="goals-btn" title="Writing goals">
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="8" fill="none" stroke="var(--border)" strokeWidth="3" />
          <circle cx="10" cy="10" r="8" fill="none" stroke={pct >= 1 ? "#2e8b57" : "var(--accent)"} strokeWidth="3" strokeDasharray={`${pct * 50.3} 60`} transform="rotate(-90 10 10)" strokeLinecap="round" />
        </svg>
        <span data-testid="goal-today">
          {today.toLocaleString()}
          {g.daily ? ` / ${g.daily.toLocaleString()}` : ""}
        </span>
      </button>
      {open && (
        <Popover anchor={ref} panelRef={panelRef} align="right" className="panel goals-panel">
          <div className="panel-title">
            <TargetIcon /> Writing goals
          </div>
          <div className="goal-big">
            {today.toLocaleString()} <small>words today{pct >= 1 ? " — goal reached!" : ""}</small>
          </div>
          <div className="goal-bar">
            <span style={{ width: `${pct * 100}%` }} />
          </div>
          <label className="field inline">
            <span>Daily goal</span>
            <input type="number" min={0} step={100} value={g.daily} onChange={(e) => store.setGoals({ daily: Math.max(0, Number(e.target.value) || 0) })} data-testid="goal-daily" />
          </label>
          <label className="field inline">
            <span>Project goal</span>
            <input type="number" min={0} step={1000} value={g.project || ""} placeholder="e.g. 20000" onChange={(e) => store.setGoals({ project: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
          <label className="field inline">
            <span>Deadline</span>
            <input type="date" value={g.deadline ?? ""} onChange={(e) => store.setGoals({ deadline: e.target.value || null })} />
          </label>
          {g.project > 0 && (
            <p className="panel-hint">
              {total.toLocaleString()} of {g.project.toLocaleString()} words ({Math.round((total / g.project) * 100)}%).
              {need !== null && ` ${need.toLocaleString()} words a day to finish by the deadline.`}
            </p>
          )}
          <div className="goal-history" aria-label="This week" data-testid="goal-week">
            {week.map((d) => (
              <div
                key={d.key}
                className={`goal-day${d.today ? " today" : ""}${d.future ? " future" : ""}`}
                title={`${d.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}: ${d.words.toLocaleString()} words`}
              >
                <span className={g.daily && d.words >= g.daily ? "met" : ""} style={{ height: `${d.future ? 0 : Math.max(3, (d.words / max) * 100)}%` }} />
                <small>{d.date.toLocaleDateString(undefined, { weekday: "short" })}</small>
              </div>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

// --------------------------------------------------------------- Pomodoro

export interface PomodoroSettings {
  focus: number;
  short: number;
  long: number;
  every: number;
}

type Phase = "focus" | "short" | "long";
const PHASE_LABEL: Record<Phase, string> = { focus: "Focus", short: "Short break", long: "Long break" };

/**
 * A happy "ding": a rising C–E–G bell arpeggio. Each note is a few sine
 * partials (like a small bell) with a quick strike and a long, soft ring.
 * Synthesised on the spot, so no sound files are needed.
 */
export function chime() {
  try {
    const ctx = new AudioContext();
    const out = ctx.createGain();
    out.gain.value = 0.22;
    out.connect(ctx.destination);
    const notes = [1046.5, 1318.5, 1568.0]; // C6, E6, G6
    notes.forEach((f, n) => {
      const t0 = ctx.currentTime + n * 0.14;
      const ring = n === notes.length - 1 ? 1.8 : 1.1;
      // Partials of a bell: fundamental, octave, a bright twelfth and a faint shimmer.
      for (const [mult, level] of [
        [1, 1],
        [2, 0.35],
        [3, 0.12],
        [4.17, 0.06],
      ]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = f * mult;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(level, t0 + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + ring / mult ** 0.3);
        o.connect(g).connect(out);
        o.start(t0);
        o.stop(t0 + ring + 0.05);
      }
    });
    window.setTimeout(() => void ctx.close(), 2600);
  } catch {
    /* no audio */
  }
}

export function Pomodoro({ settings, onChange, notify }: { settings: PomodoroSettings; onChange: (s: PomodoroSettings) => void; notify: (text: string) => void }) {
  const { open, setOpen, ref, panelRef } = usePopover();
  const [phase, setPhase] = useState<Phase>("focus");
  const [left, setLeft] = useState(settings.focus * 60);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const endAt = useRef(0);

  const length = (ph: Phase) => (ph === "focus" ? settings.focus : ph === "short" ? settings.short : settings.long) * 60;

  useEffect(() => {
    if (!running) return;
    endAt.current = Date.now() + left * 1000;
    const t = window.setInterval(() => {
      const s = Math.max(0, Math.round((endAt.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) {
        window.clearInterval(t);
        chime();
        const finished = phase === "focus" ? done + 1 : done;
        if (phase === "focus") setDone(finished);
        const next: Phase = phase === "focus" ? (finished % settings.every === 0 ? "long" : "short") : "focus";
        notify(phase === "focus" ? `Focus session done. Time for a ${next === "long" ? "long " : ""}break.` : "Break over. Back to the page.");
        setPhase(next);
        setLeft(length(next));
        setRunning(false);
      }
    }, 500);
    return () => window.clearInterval(t);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = (ph: Phase = phase) => {
    setRunning(false);
    setPhase(ph);
    setLeft(length(ph));
  };
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  const num = (key: keyof PomodoroSettings, label: string) => (
    <label className="field inline">
      <span>{label}</span>
      <input
        type="number"
        min={1}
        max={key === "every" ? 12 : 120}
        value={settings[key]}
        onChange={(e) => {
          const v = Math.max(1, Number(e.target.value) || 1);
          onChange({ ...settings, [key]: v });
          // Changing the length of the phase on screen (while stopped) updates the clock.
          if (!running && key === phase) setLeft(v * 60);
        }}
      />
    </label>
  );
  return (
    <div className="menu-anchor" ref={ref}>
      <button className={running ? "btn ghost small timer-btn running" : "btn ghost small timer-btn"} onClick={() => setOpen((v) => !v)} data-testid="pomodoro-btn" title="Pomodoro timer">
        <Tomato /> {running || left !== length(phase) ? mmss : "Focus"}
      </button>
      {open && (
        <Popover anchor={ref} panelRef={panelRef} align="right" className="panel pomodoro-panel">
          <div className="panel-title">
            <Tomato /> {PHASE_LABEL[phase]}
          </div>
          <button className="btn ghost small hear" onClick={chime} title="Play the ding">
            Hear the ding
          </button>
          <div className="pomo-time" data-testid="pomodoro-time">
            {mmss}
          </div>
          <div className="pomo-actions">
            <button className="btn primary" onClick={() => setRunning((r) => !r)} data-testid="pomodoro-start">
              {running ? "Pause" : left === length(phase) ? "Start" : "Resume"}
            </button>
            <button className="btn" onClick={() => reset()}>
              Reset
            </button>
            <button className="btn ghost" onClick={() => reset(phase === "focus" ? "short" : "focus")}>
              Skip
            </button>
          </div>
          <p className="panel-hint">{done} focus session{done === 1 ? "" : "s"} done this sitting.</p>
          <div className="pomo-settings">
            {num("focus", "Focus (min)")}
            {num("short", "Short break")}
            {num("long", "Long break")}
            {num("every", "Long break every")}
          </div>
        </Popover>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Stats

export function StatsPanel({ store, report, ids }: { store: ProjectStore; report: CompileReport | null; ids: string[] }) {
  const { open, setOpen, ref, panelRef } = usePopover();
  const rows = useMemo(() => {
    if (!open) return [];
    // Page span of every document from where its lines landed.
    const span = new Map<string, [number, number]>();
    if (report?.ok) {
      ids.forEach((id, i) => {
        const doc = id.split("#")[0];
        const a = report.elementPages[i];
        const b = report.elementLastPages?.[i] ?? a;
        if (!a) return;
        const cur = span.get(doc);
        span.set(doc, cur ? [Math.min(cur[0], a), Math.max(cur[1], b)] : [a, b]);
      });
    }
    const roles: [Role, string][] = [
      ["front", "Front matter"],
      ["manuscript", store.template.name],
      ["back", "Back matter"],
    ];
    return roles.map(([role, label]) => ({
      label,
      docs: manuscriptOrder(store.data, role).map(({ node, depth }) => {
        const blocks = store.docState(node.id)?.blocks ?? [];
        const s = span.get(node.id);
        return { id: node.id, title: node.title, depth, folder: node.kind === "folder", words: node.kind === "doc" ? wordCount(blocks) : 0, pages: s ? s[1] - s[0] + 1 : 0, range: s ? (s[0] === s[1] ? `p. ${s[0]}` : `pp. ${s[0]}–${s[1]}`) : "" };
      }),
    }));
  }, [open, report, ids, store, store.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = rows.reduce((n, g) => n + g.docs.reduce((m, d) => m + d.words, 0), 0);
  const scriptPages = report?.ok ? report.pageCount - (store.data.settings.titlePage && store.template.titlePageDefault ? 1 : 0) : 0;
  return (
    <div className="menu-anchor" ref={ref}>
      <button className={open ? "icon-btn on" : "icon-btn"} onClick={() => setOpen((v) => !v)} title="Words and pages per scene" data-testid="stats-btn">
        <BarChart />
      </button>
      {open && (
        <Popover anchor={ref} panelRef={panelRef} align="right" className="panel stats-panel" data-testid="stats-panel">
          <div className="panel-title">
            <BarChart /> Words and pages
          </div>
          <div className="stats-total">
            <div>
              <b>{total.toLocaleString()}</b>
              <small>words</small>
            </div>
            <div>
              <b>{report?.ok ? report.pageCount : "—"}</b>
              <small>pages</small>
            </div>
            {store.template.mode === "script" && (
              <div>
                <b>~{Math.max(0, scriptPages)}</b>
                <small>minutes</small>
              </div>
            )}
          </div>
          <div className="stats-scroll">
            {rows
              .filter((g) => g.docs.length)
              .map((g) => (
                <div key={g.label}>
                  <div className="menu-label">{g.label}</div>
                  <table className="stats-table">
                    <tbody>
                      {g.docs.map((d) => (
                        <tr key={d.id} className={d.folder ? "folder" : ""} onClick={() => !d.folder && void store.select(d.id)}>
                          <td style={{ paddingLeft: 4 + (d.depth - 1) * 12 }}>{d.title}</td>
                          <td className="num">{d.folder ? "" : d.words.toLocaleString()}</td>
                          <td className="num" title={d.range}>
                            {d.folder || !d.pages ? "" : `${d.pages} ${d.pages === 1 ? "page" : "pages"}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </div>
          <p className="panel-hint">A page is counted for every scene that has a line on it. Script running time is roughly a minute a page.</p>
        </Popover>
      )}
    </div>
  );
}

// ------------------------------------------------------------ Find bar

export type FindScope = "doc" | "script" | "all";

interface FindProps {
  store: ProjectStore;
  docId: string | null;
  initialScope: FindScope;
  onClose: () => void;
  onJump: (m: Match) => void;
  onHighlight: (h: SearchHighlight | null) => void;
}

export function FindBar({ store, docId, initialScope, onClose, onJump, onHighlight }: FindProps) {
  const [query, setQuery] = useState(() => window.getSelection()?.toString().slice(0, 80) ?? "");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [scope, setScope] = useState<FindScope>(initialScope);
  const [cur, setCur] = useState(0);
  const [showList, setShowList] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  useEffect(() => setScope(initialScope), [initialScope]);
  useEffect(() => {
    if (scope === "all") void store.loadAllDocs();
  }, [scope, store]);

  const re = useMemo(() => searchRegex({ query, matchCase, wholeWord }), [query, matchCase, wholeWord]);
  const docIds = useMemo(() => {
    if (scope === "doc") return docId ? [docId] : [];
    if (scope === "script") return store.typesetDocs().map((n) => n.id);
    const all: string[] = [];
    const walk = (ns: typeof store.data.binder) => ns.forEach((n) => (n.kind === "doc" ? all.push(n.id) : walk(n.children ?? [])));
    walk(store.data.binder);
    return all;
  }, [scope, docId, store, store.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const matches = useMemo(
    () => (re ? docIds.flatMap((id) => findInBlocks(id, store.docState(id)?.blocks ?? [], re)) : []),
    [re, docIds, store, store.version], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const current = matches.length ? matches[Math.min(cur, matches.length - 1)] : null;

  useEffect(() => {
    onHighlight(re ? { re, current: current && current.docId === docId ? { index: current.index, from: current.from } : null } : null);
  }, [re, current?.docId, current?.index, current?.from, docId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onHighlight(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (step: number) => {
    if (!matches.length) return;
    const i = (Math.min(cur, matches.length - 1) + step + matches.length) % matches.length;
    setCur(i);
    onJump(matches[i]);
  };
  const replaceOne = () => {
    if (!current || !re) return;
    const d = store.docState(current.docId);
    if (!d) return;
    store.replaceBlocks(current.docId, replaceInBlocks(d.blocks, re, replace, { index: current.index, from: current.from }).blocks);
  };
  const replaceAll = () => {
    if (!re || !matches.length) return;
    const docs = [...new Set(matches.map((m) => m.docId))];
    let n = 0;
    for (const id of docs) {
      const r = replaceInBlocks(store.docState(id)!.blocks, re, replace);
      n += r.count;
      if (r.count) store.replaceBlocks(id, r.blocks);
    }
    store.toast(`Replaced ${n} ${n === 1 ? "match" : "matches"} in ${docs.length} ${docs.length === 1 ? "document" : "documents"}.`);
  };
  const title = (id: string) => store.node(id)?.title ?? "";

  return (
    <div className="find-bar" role="search" data-testid="find-bar">
      <div className="find-row">
        <Search />
        <input
          ref={input}
          value={query}
          placeholder="Find"
          data-testid="find-input"
          onChange={(e) => {
            setQuery(e.target.value);
            setCur(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") go(e.shiftKey ? -1 : 1);
            if (e.key === "Escape") onClose();
          }}
        />
        <button className={matchCase ? "toggle on" : "toggle"} onClick={() => setMatchCase((v) => !v)} title="Match case" aria-pressed={matchCase}>
          Aa
        </button>
        <button className={wholeWord ? "toggle on" : "toggle"} onClick={() => setWholeWord((v) => !v)} title="Whole words" aria-pressed={wholeWord}>
          W
        </button>
        <select value={scope} onChange={(e) => setScope(e.target.value as FindScope)} data-testid="find-scope" title="Where to search">
          <option value="doc">This document</option>
          <option value="script">Whole script</option>
          <option value="all">Everything</option>
        </select>
        <button className="find-count" onClick={() => setShowList((v) => !v)} data-testid="find-count" title="Show all results">
          {query ? (matches.length ? `${Math.min(cur, matches.length - 1) + 1} of ${matches.length}` : "No results") : ""}
        </button>
        <button className="icon-btn" onClick={() => go(-1)} disabled={!matches.length} aria-label="Previous match">
          <ArrowUp />
        </button>
        <button className="icon-btn" onClick={() => go(1)} disabled={!matches.length} aria-label="Next match" data-testid="find-next">
          <ArrowDown />
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="Close find">
          <Close />
        </button>
      </div>
      <div className="find-row">
        <span className="find-spacer" />
        <input value={replace} placeholder="Replace with" data-testid="replace-input" onChange={(e) => setReplace(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onClose()} />
        <button className="btn small" onClick={replaceOne} disabled={!current} data-testid="replace-one">
          Replace
        </button>
        <button className="btn small" onClick={replaceAll} disabled={!matches.length} data-testid="replace-all">
          Replace all
        </button>
      </div>
      {showList && matches.length > 0 && (
        <div className="find-results">
          {matches.slice(0, 300).map((m, i) => (
            <button
              key={`${m.docId}-${m.index}-${m.from}`}
              className={i === cur ? "find-result active" : "find-result"}
              onClick={() => {
                setCur(i);
                onJump(m);
              }}
            >
              <span className="find-doc">{title(m.docId)}</span>
              <span className="find-snippet">
                {m.before}
                <mark>{m.text}</mark>
                {m.after}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export { blockText };
