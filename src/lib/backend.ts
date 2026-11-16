// The single bridge to the Rust core. In the desktop app this goes through a
// Tauri command; in a browser (development, tests) it goes to the dev server.
// Both run the same `manywrite_core::Core::call`.

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export class BackendError extends Error {
  get isConflict() {
    return this.message.startsWith("CONFLICT");
  }
}

export async function call<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      return await invoke<T>("mw_call", { cmd, args });
    } catch (e) {
      throw new BackendError(String(e));
    }
  }
  const res = await fetch(`/api/${cmd}`, { method: "POST", body: JSON.stringify(args) });
  const json = await res.json();
  if (!json.ok) throw new BackendError(json.error);
  return json.value as T;
}

export interface ReadResult {
  exists: boolean;
  content: string;
  hash: string | null;
}

export const fsApi = {
  read: (path: string) => call<ReadResult>("fs.read", { path }),
  write: (path: string, content: string, expectedHash: string | null, force = false) =>
    call<{ hash: string }>("fs.write", { path, content, expectedHash, force }),
  hashes: (paths: string[]) => call<(string | null)[]>("fs.hashes", { paths }),
  exists: (path: string) => call<boolean>("fs.exists", { path }),
  walk: (path: string) => call<{ path: string; isDir: boolean }[]>("fs.walk", { path }),
  mkdir: (path: string) => call<null>("fs.mkdir", { path }),
  rename: (from: string, to: string) => call<null>("fs.rename", { from, to }),
  trash: (path: string, root: string) => call<string>("fs.trash", { path, root }),
};

export const configApi = {
  read: (name: string) => call<ReadResult>("config.read", { name }),
  write: (name: string, content: string) => call<null>("config.write", { name, content }),
  list: (dir: string) => call<string[]>("config.list", { dir }),
  remove: (name: string) => call<null>("config.delete", { name }),
};

export interface AppPaths {
  home: string;
  documents: string;
  config: string;
  sep: string;
}

let pathsCache: AppPaths | null = null;
export async function appPaths(): Promise<AppPaths> {
  if (!pathsCache) {
    pathsCache = await call<AppPaths>("app.paths");
    pathsCache.documents = normalize(pathsCache.documents);
    pathsCache.config = normalize(pathsCache.config);
  }
  return pathsCache;
}

/** Paths use "/" everywhere in the UI; Windows accepts them too. */
export function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function join(...parts: string[]): string {
  return normalize(parts.filter(Boolean).join("/").replace(/\/{2,}/g, "/"));
}

export async function pickFolder(title: string, defaultPath?: string): Promise<string | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ directory: true, title, defaultPath });
    return typeof r === "string" ? normalize(r) : null;
  }
  const r = window.prompt(`${title}\n(Type a folder path on this computer.)`, defaultPath ?? "");
  return r ? normalize(r) : null;
}

export async function pickSavePath(title: string, defaultPath: string, ext: string): Promise<string | null> {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const r = await save({ title, defaultPath, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    return r ? normalize(r) : null;
  }
  const r = window.prompt(`${title}\n(Type where to save the file.)`, defaultPath);
  return r ? normalize(r) : null;
}

export async function revealInFolder(path: string): Promise<void> {
  if (isTauri) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("reveal", { path });
    } catch {
      /* not critical */
    }
  }
}

/** Ask for an image file. Desktop: a native dialog (returns its path). Browser: a file input (returns its data). */
export async function pickImage(): Promise<{ name: string; path?: string; data?: string } | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ title: "Add an image", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }] });
    if (typeof r !== "string") return null;
    return { name: r.split(/[\\/]/).pop() ?? "image.png", path: r };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
    input.dataset.testid = "image-input";
    input.style.display = "none";
    input.onchange = () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ name: f.name, data: String(reader.result) });
      reader.readAsDataURL(f);
    };
    document.body.appendChild(input);
    input.click();
  });
}

const imageCache = new Map<string, Promise<string>>();
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

/** A data: URL for an image in a project, for showing it in the editor. */
export function imageUrl(absPath: string): Promise<string> {
  let p = imageCache.get(absPath);
  if (!p) {
    const ext = absPath.split(".").pop()?.toLowerCase() ?? "png";
    p = call<string>("fs.readBase64", { path: absPath }).then((b64) => `data:${MIME[ext] ?? "image/png"};base64,${b64}`);
    p.catch(() => imageCache.delete(absPath));
    imageCache.set(absPath, p);
  }
  return p;
}

/** Ask for a file to open (with a type filter) or, for packages such as .scriv, a folder. */
export async function pickFile(title: string, extensions: string[], defaultPath?: string): Promise<string | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ title, defaultPath, filters: [{ name: "Documents", extensions }] });
    return typeof r === "string" ? normalize(r) : null;
  }
  const r = window.prompt(`${title}\n(Type the path of a file on this computer.)`, defaultPath ?? "");
  return r ? normalize(r) : null;
}
