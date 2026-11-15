import { useSyncExternalStore } from "react";
import type { ProjectStore } from "../project/store";

/** Re-render whenever the project store changes. */
export function useStore(store: ProjectStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion);
}
