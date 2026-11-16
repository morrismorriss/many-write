import { useEffect, useMemo, useRef, useState } from "react";
import { call } from "../lib/backend";
import { generateTypst, elementId } from "../formats/typst";
import type { ProjectStore } from "../project/store";
import type { Theme } from "../themes/themes";
import { useStore } from "../lib/useStore";
import { ChevronLeft, ChevronRight, Warning } from "./icons";
import { StatsPanel } from "./Widgets";
import { ExportMenu } from "./Menus";
import { Popover } from "./Popover";

export interface CompileReport {
  ok: boolean;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  errors: { message: string }[];
  warnings: { message: string }[];
  elementPages: number[];
  elementLastPages: number[];
  issues: { id: string; kind: string; page: number; problem: string; message: string }[];
  compileMs: number;
}

interface Props {
  store: ProjectStore;
  theme: Theme;
  cursor: { docId: string; index: number } | null;
  /** Show the page the cursor is on as you write. */
  follow: boolean;
  onJump: (elementId: string) => void;
  onReport?: (r: CompileReport, ids: string[]) => void;
}

const DEBOUNCE_MS = 250;

export function Preview({ store, theme, cursor, follow, onJump, onReport }: Props) {
  const version = useStore(store);
  const [report, setReport] = useState<CompileReport | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [gen, setGen] = useState(0);
  const [page, setPage] = useState(0);
  const [svgUrl, setSvgUrl] = useState<string | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const pending = useRef(false);
  const latest = useRef<() => Promise<void>>(async () => {});

  const matchTheme = theme.previewMatchesTheme;
  const fills = useMemo(
    () => (matchTheme ? { pageFill: theme.colors.background, textFill: theme.colors.text } : {}),
    [matchTheme, theme.colors.background, theme.colors.text],
  );

  // Compile (debounced, one at a time; the newest request wins).
  latest.current = async () => {
    if (busy.current) {
      pending.current = true;
      return;
    }
    busy.current = true;
    try {
      const g = generateTypst(store.template, store.meta(), store.manuscriptItems(), { ...fills, production: store.productionOptions() });
      const r = await call<CompileReport>("typst.compile", { source: g.source, elements: g.elements, root: store.root });
      setReport(r);
      onReport?.(r, g.elements.map((e) => e.id));
      if (r.ok) {
        setIds(g.elements.map((e) => e.id));
        setGen((x) => x + 1);
      }
    } catch (e) {
      setReport({ ok: false, pageCount: 0, pageWidth: 0, pageHeight: 0, errors: [{ message: String(e) }], warnings: [], elementPages: [], elementLastPages: [], issues: [], compileMs: 0 });
    } finally {
      busy.current = false;
      if (pending.current) {
        pending.current = false;
        void latest.current();
      }
    }
  };

  useEffect(() => {
    const t = window.setTimeout(() => void latest.current(), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [version, fills]);

  const pageCount = report?.ok ? report.pageCount : (report?.pageCount ?? 0);
  const clampedPage = Math.min(page, Math.max(0, (report?.pageCount ?? 1) - 1));

  // Follow the cursor: show the page holding the line being edited.
  useEffect(() => {
    if (!follow || !cursor || !report?.ok || !ids.length) return;
    let best = -1;
    for (let i = 0; i < ids.length; i++) {
      const [doc, idx] = ids[i].split("#");
      if (doc !== cursor.docId) continue;
      if (Number(idx) <= cursor.index || best < 0) best = i;
      if (Number(idx) >= cursor.index) break;
    }
    const p = best >= 0 ? report.elementPages[best] : 0;
    if (p > 0) setPage(p - 1);
  }, [cursor?.docId, cursor?.index, follow, gen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render the current page to SVG.
  useEffect(() => {
    if (!gen) return;
    let cancelled = false;
    let url: string | null = null;
    void call<{ svg: string | null }>("typst.page", { index: clampedPage }).then((r) => {
      if (cancelled || !r.svg) return;
      url = URL.createObjectURL(new Blob([r.svg], { type: "image/svg+xml" }));
      setSvgUrl(url);
    });
    return () => {
      cancelled = true;
      if (url) window.setTimeout(() => URL.revokeObjectURL(url!), 1000);
    };
  }, [gen, clampedPage]);

  const issues = report?.issues ?? [];
  const go = (p: number) => setPage(Math.max(0, Math.min(pageCount - 1, p)));

  return (
    <div className="preview" data-testid="preview">
      <div className="preview-bar">
        <div className="pager">
          <button className="icon-btn" onClick={() => go(clampedPage - 1)} disabled={clampedPage <= 0} aria-label="Previous page">
            <ChevronLeft />
          </button>
          <span className="page-label" data-testid="page-label">
            Page {pageCount ? clampedPage + 1 : 0} of {pageCount}
          </span>
          <button className="icon-btn" onClick={() => go(clampedPage + 1)} disabled={clampedPage >= pageCount - 1} aria-label="Next page">
            <ChevronRight />
          </button>

        </div>
        <div className="layout-status" ref={statusRef}>
          {store.inProduction && <span className="status prod" title="Page numbers are locked">Locked</span>}
          {report && !report.ok ? (
            <span className="status warn" title={report.errors.map((e) => e.message).join("\n")}>
              <Warning /> Typesetting error
            </span>
          ) : issues.length === 0 ? null : (
            <button className="status warn" data-testid="orphan-status" onClick={() => setIssuesOpen((v) => !v)}>
              <Warning /> {issues.length} layout {issues.length === 1 ? "issue" : "issues"}
            </button>
          )}
          <StatsPanel store={store} report={report} ids={ids} />
          <ExportMenu store={store} />
          {issuesOpen && issues.length > 0 && (
            <Popover anchor={statusRef} align="right" className="issues" onMouseLeave={() => setIssuesOpen(false)}>
              {issues.map((i, k) => (
                <button key={k} className="menu-item" onClick={() => { setPage(i.page - 1); onJump(i.id); setIssuesOpen(false); }}>
                  {i.message}
                </button>
              ))}
            </Popover>
          )}
        </div>
      </div>
      <div className="preview-scroll">
        {svgUrl ? (
          <img className={matchTheme ? "page themed" : "page"} src={svgUrl} alt={`Page ${clampedPage + 1}`} style={report?.pageWidth ? { aspectRatio: `${report.pageWidth} / ${report.pageHeight}` } : undefined} />
        ) : (
          <div className="page placeholder">Typesetting…</div>
        )}
        {report && !report.ok && <div className="preview-error">{report.errors[0]?.message}</div>}
      </div>
    </div>
  );
}

export { elementId };
