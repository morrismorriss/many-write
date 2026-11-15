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
