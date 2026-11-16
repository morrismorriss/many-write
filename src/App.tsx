import { useCallback, useEffect, useState } from "react";
import { ProjectStore } from "./project/store";
import { Welcome } from "./components/Welcome";
import { Workspace } from "./components/Workspace";
import { ThemeBuilder } from "./components/ThemeBuilder";
import { appPaths, fsApi, isTauri, openWindow, pickFile, pickFolder, pickSavePath } from "./lib/backend";
import { ImportDialog } from "./components/ImportDialog";
import { DonateDialog, donateOnLaunch } from "./components/Donate";
import {
  applyTheme,
  BUILT_IN_THEMES,
  DEFAULT_SETTINGS,
  deleteCustomTheme,
  loadCustomThemes,
  loadSettings,
  saveCustomTheme,
  saveSettings,
  type AppSettings,
  type Theme,
} from "./themes/themes";

export function App() {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [custom, setCustom] = useState<Theme[]>([]);
  const [store, setStore] = useState<ProjectStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState<Theme | null>(null);
  const [themeFolder, setThemeFolder] = useState("");
  const [ready, setReady] = useState(false);
  const [startNew, setStartNew] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [donating, setDonating] = useState(false);

  const themes = [...BUILT_IN_THEMES, ...custom];
  const theme = themes.find((t) => t.id === settings.theme) ?? BUILT_IN_THEMES[0];

  useEffect(() => {
    void (async () => {
      const [s, c, paths] = await Promise.all([loadSettings(), loadCustomThemes(), appPaths()]);
      // Count launches of the first window for the occasional donate popup (not windows opened from it).
      const opened = new URLSearchParams(window.location.search).has("project") || new URLSearchParams(window.location.search).has("window");
      if (!opened) {
        const d = donateOnLaunch(s.donate);
        s.donate = d.next;
        saveSettings(s);
        if (d.show) setDonating(true);
      }
      setSettingsState(s);
      setCustom(c);
      setThemeFolder(`${paths.config}/themes`);
      setReady(true);
      const last = new URLSearchParams(window.location.search).get("project");
      if (last) void openProject(last);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!building) applyTheme(theme);
  }, [theme, building]);

  const setSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettingsState((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  /** Save and close the open project. False if a save failed and the writer chose to stay. */
  const leaveCurrent = async () => {
    if (!store) return true;
    await store.flushAll().catch(() => {});
    if (store.isDirty() && !window.confirm("Some changes could not be saved. Close this project anyway and lose them?")) return false;
    await store.close().catch(() => {});
    return true;
  };

  const openProject = async (root: string) => {
    setError(null);
    if (!(await leaveCurrent())) return;
    try {
      // A single markdown/text/Fountain file opens on its own; anything else is a project folder.
      const s = /\.(md|markdown|txt|fountain|spmd)$/i.test(root) ? await ProjectStore.openSingle(root) : await ProjectStore.open(root);
      setStore(s);
      // A project remembers the theme it was last written in.
      if (s.data.theme) setSettings({ theme: s.data.theme });
    } catch (e) {
      setStore(null);
      setError((e as Error).message);
    }
  };

  const docsDir = async () => (store ? store.root : (await appPaths()).documents);
  const openDocument = async () => {
    const p = await pickFile("Open a document", ["md", "markdown", "txt", "fountain"], await docsDir());
    if (p) void openProject(p);
  };
  const newDocument = async () => {
    const p = await pickSavePath("New document", `${await docsDir()}/Untitled.md`, "md");
    if (!p) return;
    try {
      if (!(await fsApi.exists(p))) await fsApi.write(p, "", null);
      void openProject(p);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const importFile = async () => {
    const p = await pickFile("Import a document", ["docx", "fdx", "fountain", "pdf", "rtf", "md", "txt"], await docsDir());
    if (p) setImporting(p);
  };

  const closeProject = async () => {
    if (!(await leaveCurrent())) return;
    setStore(null);
  };

  // Save before the window closes.
  useEffect(() => {
    if (!store) return;
    const onUnload = () => void store.flushAll();
    window.addEventListener("beforeunload", onUnload);
    let unlisten: (() => void) | undefined;
    let gone = false;
    if (isTauri) {
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow()
          .onCloseRequested(async (event) => {
            try {
              await store.flushAll();
            } catch {
              /* reported below */
            }
            // A failed save or an unsettled outside edit: don't lose the typing without asking.
            if (store.isDirty() && !window.confirm("Some changes could not be saved. Close Many Write anyway and lose them?")) event.preventDefault();
          })
          .then((u) => {
            // The effect may have been cleaned up while the listener was being registered.
            if (gone) u();
            else unlisten = u;
          }),
      );
    }
    return () => {
      gone = true;
      window.removeEventListener("beforeunload", onUnload);
      unlisten?.();
    };
  }, [store]);

  const pickTheme = (t: Theme) => {
    setSettings({ theme: t.id });
    if (store) void store.updateMeta({ theme: t.id });
  };

  const saveTheme = async (t: Theme) => {
    const saved = await saveCustomTheme(t);
    setCustom(await loadCustomThemes());
    setBuilding(null);
    pickTheme(saved);
  };

  const deleteTheme = async (t: Theme) => {
    if (!window.confirm(`Delete the theme “${t.name}”?`)) return;
    await deleteCustomTheme(t.id);
    setCustom(await loadCustomThemes());
    if (settings.theme === t.id) pickTheme(BUILT_IN_THEMES[0]);
  };

  if (!ready) return null;

  return (
    <>
      {store ? (
        <Workspace
          key={store.root}
          store={store}
          settings={settings}
          setSettings={setSettings}
          themes={themes}
          theme={theme}
          onPickTheme={pickTheme}
          onBuildTheme={(base) => setBuilding(base)}
          onDeleteTheme={(t) => void deleteTheme(t)}
          onClose={() => void closeProject()}
          onNewProject={() => {
            setStartNew(true);
            void closeProject();
          }}
          onOpenFolder={() => void pickFolder("Open a project folder", store.root.replace(/\/[^/]*$/, "")).then((r) => { if (r) void openProject(r); })}
          onOpenProject={(r) => void openProject(r)}
          onNewDocument={() => void newDocument()}
          onOpenDocument={() => void openDocument()}
          onImport={() => void importFile()}
          onNewWindow={() => void openWindow().catch((e) => store.toast(`Could not open a window: ${(e as Error).message}`, "error"))}
          onOpenInWindow={(r) => void openWindow(r).catch((e) => store.toast(`Could not open a window: ${(e as Error).message}`, "error"))}
          onDonate={() => setDonating(true)}
        />
      ) : (
        <Welcome key={String(startNew)} onOpen={(r) => {
          setStartNew(false);
          void openProject(r);
        }} error={error} startNew={startNew} onOpenDocument={() => void openDocument()} onImport={() => void importFile()} />
      )}
      {importing && (
        <ImportDialog
          path={importing}
          onCancel={() => setImporting(null)}
          onDone={(root) => {
            setImporting(null);
            void openProject(root);
          }}
        />
      )}
      {donating && (
        <DonateDialog
          onClose={() => setDonating(false)}
          onNever={() => {
            setDonating(false);
            setSettings({ donate: { launches: settings.donate?.launches ?? 0, ...settings.donate, never: true } });
          }}
        />
      )}
      {building && (
        <ThemeBuilder
          initial={building}
          themeFolder={themeFolder}
          onSave={(t) => void saveTheme(t)}
          onCancel={() => {
            setBuilding(null);
            applyTheme(theme);
          }}
        />
      )}
    </>
  );
}
