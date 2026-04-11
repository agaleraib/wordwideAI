/**
 * Light/dark theme hook.
 *
 * Toggles a `data-theme="light"` attribute on <html>. The CSS design
 * system uses `:root[data-theme="light"]` to swap the variable palette.
 * Defaults to "dark" (the existing theme). Persists choice in
 * localStorage so it survives reloads.
 */

import { useCallback, useSyncExternalStore } from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "finflow-theme";

function getSnapshot(): Theme {
  return (localStorage.getItem(STORAGE_KEY) as Theme) || "dark";
}

function getServerSnapshot(): Theme {
  return "dark";
}

const listeners = new Set<() => void>();
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function applyTheme(theme: Theme): void {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

// Apply on module load so initial render matches stored preference
if (typeof window !== "undefined") {
  applyTheme(getSnapshot());
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next: Theme = getSnapshot() === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    for (const cb of listeners) cb();
  }, []);

  return { theme, toggle };
}
