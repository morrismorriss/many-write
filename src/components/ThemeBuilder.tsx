import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { applyTheme, checkContrast, FONT_STACKS, parseHex, type Theme, type WritingFont } from "../themes/themes";
import { Check, Close, Warning } from "./icons";

interface Props {
  initial: Theme;
  onSave: (t: Theme) => void;
  onCancel: () => void;
  themeFolder: string;
}

const FIELDS: { key: keyof Theme["colors"]; label: string; hint: string }[] = [
  { key: "background", label: "Background", hint: "Editor and page surround" },
  { key: "sidebar", label: "Sidebar", hint: "Binder and notes" },
  { key: "text", label: "Text", hint: "Everything you read" },
  { key: "accent", label: "Accent", hint: "Selection, buttons, highlights" },
];

export function ThemeBuilder({ initial, onSave, onCancel, themeFolder }: Props) {
  const [t, setT] = useState<Theme>(() => ({
    ...initial,
    colors: { ...initial.colors },
    name: initial.builtIn ? `My ${initial.name.toLowerCase()} theme` : initial.name,
  }));
  // Live preview: the whole app takes the theme while the builder is open,
  // but the dialog keeps the theme it opened with so it stays readable.
  useEffect(() => applyTheme(t), [t]);
  const dialog = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (dialog.current) applyTheme(initial, dialog.current);
  }, [initial]);

  const checks = checkContrast(t);
  const setColor = (key: keyof Theme["colors"], v: string) => setT((x) => ({ ...x, colors: { ...x.colors, [key]: v } }));
  const valid = Object.values(t.colors).every((c) => parseHex(c)) && t.name.trim().length > 0;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={dialog} className="modal theme-builder" role="dialog" aria-label="Theme builder">
        <div className="modal-head">
          <h2>Theme builder</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Close">
            <Close />
          </button>
        </div>
        <div className="tb-grid">
          <div className="tb-controls">
            <label className="field">
              <span>Name</span>
              <input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} data-testid="theme-name" />
            </label>
            {FIELDS.map((f) => (
              <div className="color-row" key={f.key}>
                <input type="color" value={parseHex(t.colors[f.key]) ? normHex(t.colors[f.key]) : "#000000"} onChange={(e) => setColor(f.key, e.target.value)} aria-label={f.label} />
                <div className="color-meta">
                  <span className="color-label">{f.label}</span>
                  <span className="color-hint">{f.hint}</span>
                </div>
                <input className="hex" value={t.colors[f.key]} onChange={(e) => setColor(f.key, e.target.value)} spellCheck={false} data-testid={`hex-${f.key}`} />
              </div>
            ))}
            <div className="field">
              <span>Writing font</span>
              <div className="segmented">
                {(["serif", "sans", "mono"] as WritingFont[]).map((f) => (
                  <button key={f} className={t.writingFont === f ? "on" : ""} onClick={() => setT({ ...t, writingFont: f })} style={{ fontFamily: FONT_STACKS[f] }}>
                    {f === "serif" ? "Serif" : f === "sans" ? "Sans" : "Mono"}
                  </button>
                ))}
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={t.previewMatchesTheme} onChange={(e) => setT({ ...t, previewMatchesTheme: e.target.checked })} />
              <span>Preview page matches the theme (otherwise it stays white). PDFs are always printed on white.</span>
            </label>
          </div>
          <div className="tb-side">
            <div className="tb-sample" style={{ background: t.colors.background, color: t.colors.text }}>
              <div className="tb-sample-side" style={{ background: t.colors.sidebar }}>
                <div className="tb-sample-item" style={{ background: mixAccent(t) }}>Scene 1</div>
                <div className="tb-sample-item">Scene 2</div>
              </div>
              <div className="tb-sample-main" style={{ fontFamily: FONT_STACKS[t.writingFont] }}>
                <div style={{ textAlign: "center", letterSpacing: "0.04em" }}>ANNA</div>
                <div>I told you already. Twice.</div>
                <div style={{ color: t.colors.accent, marginTop: 8, fontFamily: "Inter, sans-serif", fontSize: 12 }}>Accent colour</div>
              </div>
            </div>
            <div className="contrast" data-testid="contrast">
              <div className="contrast-title">Contrast check</div>
              {checks.map((c) => (
                <div key={c.label} className={`contrast-row ${c.level}`}>
                  {c.level === "good" ? <Check /> : <Warning />}
                  <span>{c.label}</span>
                  <span className="ratio">{c.ratio.toFixed(1)}:1</span>
                </div>
              ))}
              {checks.some((c) => c.level !== "good") && (
                <p className="contrast-warn" role="alert">
                  {checks.find((c) => c.level !== "good")!.label} is hard to read (needs {checks.find((c) => c.level !== "good")!.min}:1). Try a darker or lighter colour.
                </p>
              )}
            </div>
            <p className="tb-folder">
              Saved as a small file in <code>{themeFolder}</code>, so you can share it.
            </p>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={() => onSave(t)} data-testid="save-theme">
            Save theme
          </button>
        </div>
      </div>
    </div>
  );
}

function normHex(h: string) {
  const rgb = parseHex(h)!;
  return "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
}

function mixAccent(t: Theme) {
  return `color-mix(in srgb, ${t.colors.accent} 16%, ${t.colors.sidebar})`;
}
