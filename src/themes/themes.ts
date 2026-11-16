// Themes are small JSON files: four colours, a writing font, whether the
// preview page follows the theme and, optionally, a background picture
// (embedded in the file, so the theme is still one file to share). Custom
// ones live in the app's config folder under themes/, so they can be shared
// by copying the file.

import { call, configApi } from "../lib/backend";

export type WritingFont = "serif" | "sans" | "mono";

export interface Theme {
  id: string;
  name: string;
  colors: { background: string; sidebar: string; text: string; accent: string };
  writingFont: WritingFont;
  previewMatchesTheme: boolean;
  /** A picture behind the editor, as a data: URL. */
  backgroundImage?: string;
  /** How strongly the picture shows through the background colour, 0.05 to 1. */
  backgroundStrength?: number;
  builtIn?: boolean;
}

export const DEFAULT_BACKGROUND_STRENGTH = 0.35;
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;

export function isBackgroundImage(v: unknown): v is string {
  return typeof v === "string" && IMAGE_DATA_URL.test(v);
}

function clampStrength(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0.05, v)) : DEFAULT_BACKGROUND_STRENGTH;
}

export const BUILT_IN_THEMES: Theme[] = [
  {
    id: "light",
    name: "Light",
    colors: { background: "#ffffff", sidebar: "#f7f7f5", text: "#37352f", accent: "#2f6fdf" },
    writingFont: "serif",
    previewMatchesTheme: false,
    builtIn: true,
  },
  {
    id: "dark",
    name: "Dark",
    colors: { background: "#191919", sidebar: "#202020", text: "#e6e6e3", accent: "#6ea8ff" },
    writingFont: "serif",
    previewMatchesTheme: false,
    builtIn: true,
  },
  {
    id: "pink",
    name: "Pink",
    colors: { background: "#fff7fa", sidebar: "#fdebf2", text: "#4a2b38", accent: "#d63f7f" },
    writingFont: "serif",
    previewMatchesTheme: false,
    builtIn: true,
  },
];

export const FONT_STACKS: Record<WritingFont, string> = {
  serif: `"Literata", "Iowan Old Style", Georgia, serif`,
  sans: `"Inter", system-ui, sans-serif`,
  mono: `"Courier Prime", "Courier New", monospace`,
};

// ------------------------------------------------------------ colour maths

export function parseHex(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface ContrastCheck {
  label: string;
  ratio: number;
  level: "good" | "low" | "poor";
  min: number;
}

/** Text must reach 4.5:1 (WCAG AA); the accent, used for icons and highlights, 3:1. */
export function checkContrast(t: Theme): ContrastCheck[] {
  const c = t.colors;
  const rate = (label: string, ratio: number, min: number): ContrastCheck => ({
    label,
    ratio,
    min,
    level: ratio >= min ? "good" : ratio >= min * 0.66 ? "low" : "poor",
  });
  return [
    rate("Text on background", contrastRatio(c.text, c.background), 4.5),
    rate("Text on sidebar", contrastRatio(c.text, c.sidebar), 4.5),
    rate("Accent on background", contrastRatio(c.accent, c.background), 3),
  ];
}

export function isDark(t: Theme) {
  return luminance(t.colors.background) < 0.2;
}

function mix(a: string, b: string, amount: number): string {
  const x = parseHex(a) ?? [0, 0, 0];
  const y = parseHex(b) ?? [255, 255, 255];
  const m = x.map((v, i) => Math.round(v * amount + y[i] * (1 - amount)));
  return "#" + m.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** Text on the sidebar: the theme's text colour, or near-black / near-white when that is too faint there. */
export function sideText(text: string, sidebar: string): string {
  if (contrastRatio(text, sidebar) >= 4.5) return text;
  const dark = "#1f1f1d";
  const light = "#f2f2ef";
  return contrastRatio(dark, sidebar) >= contrastRatio(light, sidebar) ? dark : light;
}

/** Apply a theme to the whole UI through CSS variables. */
export function applyTheme(t: Theme, el: HTMLElement = document.documentElement) {
  const c = t.colors;
  const s = el.style;
  s.setProperty("--bg", c.background);
  s.setProperty("--sidebar", c.sidebar);
  s.setProperty("--text", c.text);
  s.setProperty("--accent", c.accent);
  s.setProperty("--muted", mix(c.text, c.background, 0.58));
  s.setProperty("--faint", mix(c.text, c.background, 0.35));
  s.setProperty("--border", mix(c.text, c.background, 0.12));
  s.setProperty("--hover", mix(c.text, c.background, 0.06));
  s.setProperty("--active", mix(c.text, c.background, 0.1));
  // The side panels (binder and notes on the left, preview on the right) get their own
  // shades, mixed from the sidebar colour rather than the page background, and their
  // own text colour when the theme's text would be hard to read on the sidebar.
  const side = sideText(c.text, c.sidebar);
  s.setProperty("--side-text", side);
  s.setProperty("--side-muted", mix(side, c.sidebar, 0.58));
  s.setProperty("--side-faint", mix(side, c.sidebar, 0.35));
  s.setProperty("--side-border", mix(side, c.sidebar, 0.12));
  s.setProperty("--side-hover", mix(side, c.sidebar, 0.06));
  s.setProperty("--side-active", mix(side, c.sidebar, 0.1));
  // The selected binder item: the accent over the sidebar, as the theme builder shows it.
  s.setProperty("--side-selected", mix(c.accent, c.sidebar, 0.16));
  s.setProperty("--accent-soft", mix(c.accent, c.background, 0.14));
  // Copies of the main colours, for menus and dialogs opened from inside a side panel.
  for (const v of ["text", "muted", "faint", "border", "hover", "active"]) s.setProperty(`--main-${v}`, s.getPropertyValue(`--${v}`));
  s.setProperty("--writing-font", FONT_STACKS[t.writingFont]);
  // Both side panels (binder on the left, preview on the right) use the sidebar colour.
  s.setProperty("--pane", c.sidebar);
  // The background picture sits behind the editor, faded into the background colour.
  if (isBackgroundImage(t.backgroundImage)) {
    s.setProperty("--bg-image", `url("${t.backgroundImage}")`);
    s.setProperty("--bg-image-strength", String(clampStrength(t.backgroundStrength)));
  } else {
    s.setProperty("--bg-image", "none");
    s.setProperty("--bg-image-strength", "0");
  }
  el.dataset.scheme = isDark(t) ? "dark" : "light";
  if (el === document.documentElement) s.colorScheme = isDark(t) ? "dark" : "light";
}

// ------------------------------------------------------------- storage

export async function loadCustomThemes(): Promise<Theme[]> {
  const out: Theme[] = [];
  try {
    for (const name of await configApi.list("themes")) {
      if (!name.endsWith(".json")) continue;
      try {
        const r = await configApi.read(`themes/${name}`);
        const t = validateTheme(JSON.parse(r.content), name.replace(/\.json$/, ""));
        if (t) out.push(t);
      } catch {
        /* skip unreadable theme files */
      }
    }
  } catch {
    /* no themes folder yet */
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function validateTheme(raw: unknown, id: string): Theme | null {
  const r = raw as Partial<Theme>;
  if (!r || typeof r !== "object" || !r.colors) return null;
  const c = r.colors;
  if (![c.background, c.sidebar, c.text, c.accent].every((v) => typeof v === "string" && parseHex(v))) return null;
  return {
    id,
    name: typeof r.name === "string" && r.name ? r.name : id,
    colors: { background: c.background, sidebar: c.sidebar, text: c.text, accent: c.accent },
    writingFont: r.writingFont === "sans" || r.writingFont === "mono" ? r.writingFont : "serif",
    previewMatchesTheme: !!r.previewMatchesTheme,
    ...(isBackgroundImage(r.backgroundImage) ? { backgroundImage: r.backgroundImage, backgroundStrength: clampStrength(r.backgroundStrength) } : {}),
  };
}

const MAX_SIDE = 2400;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

/**
 * Turn a picked image (a path on disk, or data from a file input) into a data
 * URL for a theme. Large photos are scaled down to at most 2400px and stored
 * as JPEG, so the theme file stays a reasonable size; SVGs are kept as they are.
 */
export async function backgroundFromPick(pick: { name: string; path?: string; data?: string }): Promise<string> {
  let url = pick.data ?? "";
  if (!url && pick.path) {
    const ext = pick.path.split(".").pop()?.toLowerCase() ?? "png";
    if (!MIME[ext]) throw new Error("That file is not a picture Many Write can use (PNG, JPEG, GIF, WebP or SVG).");
    url = `data:${MIME[ext]};base64,${await call<string>("fs.readBase64", { path: pick.path })}`;
  }
  if (!isBackgroundImage(url)) throw new Error("That file is not a picture Many Write can use (PNG, JPEG, GIF, WebP or SVG).");
  if (url.startsWith("data:image/svg+xml")) return url;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("The picture could not be read."));
    el.src = url;
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  // Small pictures that are already compact are kept exactly.
  if (scale === 1 && url.length < 1_500_000) return url;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return url;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.86);
}

export function themeFileId(name: string): string {
  return (
    "custom-" +
    (name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "theme")
  );
}

export async function saveCustomTheme(t: Theme): Promise<Theme> {
  const id = t.builtIn || !t.id.startsWith("custom-") ? themeFileId(t.name) : t.id;
  const { builtIn: _b, id: _i, ...file } = t;
  void _b;
  void _i;
  await configApi.write(`themes/${id}.json`, JSON.stringify(file, null, 2) + "\n");
  return { ...t, id, builtIn: false };
}

export async function deleteCustomTheme(id: string) {
  await configApi.remove(`themes/${id}.json`);
}

export interface AppSettings {
  theme: string;
  binderOpen: boolean;
  previewOpen: boolean;
  previewWidth: number;
  followCursor: boolean;
  spellcheck: boolean;
  pomodoro: { focus: number; short: number; long: number; every: number };
  /** The donate popup: launches counted, when it last showed itself, and "Don't ask again". */
  donate?: { launches: number; lastShown?: number; never?: boolean };
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "light",
  binderOpen: true,
  previewOpen: true,
  previewWidth: 520,
  followCursor: true,
  spellcheck: true,
  pomodoro: { focus: 25, short: 5, long: 15, every: 4 },
};

export async function loadSettings(): Promise<AppSettings> {
  try {
    const r = await configApi.read("settings.json");
    if (r.exists) return { ...DEFAULT_SETTINGS, ...JSON.parse(r.content) };
  } catch {
    /* defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

let settingsTimer: number | undefined;
export function saveSettings(s: AppSettings) {
  window.clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(() => void configApi.write("settings.json", JSON.stringify(s, null, 2)).catch(() => {}), 400);
}
