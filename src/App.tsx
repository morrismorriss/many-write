import { useCallback, useEffect, useState } from "react";
import { ProjectStore } from "./project/store";
import { Welcome } from "./components/Welcome";
import { Workspace } from "./components/Workspace";
import { ThemeBuilder } from "./components/ThemeBuilder";
import { appPaths, isTauri } from "./lib/backend";
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

  const themes = [...BUILT_IN_THEMES, ...custom];
  const theme = themes.find((t) => t.id === settings.theme) ?? BUILT_IN_THEMES[0];

  useEffect(() => {
    void (async () => {
      const [s, c, paths] = await Promise.all([loadSettings(), loadCustomThemes(), appPaths()]);
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

  const openProject = async (root: string) => {
    setError(null);
    try {
      if (store) await store.close();
      const s = await ProjectStore.open(root);
      setStore(s);
      // A project remembers the theme it was last written in.
      if (s.data.theme) setSettings({ theme: s.data.theme });
    } catch (e) {
      setStore(null);
      setError((e as Error).message);
    }
  };

  const closeProject = async () => {
    if (store) await store.close();
    setStore(null);
  };

  // Save before the window closes.
  useEffect(() => {
    if (!store) return;
    const onUnload = () => void store.flushAll();
    window.addEventListener("beforeunload", onUnload);
    let unlisten: (() => void) | undefined;
    if (isTauri) {
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow()
          .onCloseRequested(async () => {
            await store.flushAll();
          })
          .then((u) => (unlisten = u)),
      );
    }
    return () => {
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
        />
      ) : (
        <Welcome onOpen={(r) => void openProject(r)} error={error} />
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
