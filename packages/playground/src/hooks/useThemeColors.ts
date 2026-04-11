/**
 * Reads resolved CSS variable values from the document root.
 *
 * Recharts and other charting libs need concrete color strings (hex/rgba),
 * not CSS `var()` references. This hook re-reads the computed values
 * whenever the theme changes, so chart components automatically pick up
 * light/dark palette swaps without hardcoding either set.
 */

import { useSyncExternalStore } from "react";

interface ThemeColors {
  bgApp: string;
  bgRaised: string;
  border: string;
  borderFocus: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  distinct: string;
  reskinned: string;
  fabrication: string;
}

function readColors(): ThemeColors {
  if (typeof document === "undefined") return FALLBACK;
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    bgApp: v("--bg-app") || FALLBACK.bgApp,
    bgRaised: v("--bg-raised") || FALLBACK.bgRaised,
    border: v("--border") || FALLBACK.border,
    borderFocus: v("--border-focus") || FALLBACK.borderFocus,
    textPrimary: v("--text-primary") || FALLBACK.textPrimary,
    textSecondary: v("--text-secondary") || FALLBACK.textSecondary,
    textMuted: v("--text-muted") || FALLBACK.textMuted,
    accent: v("--accent") || FALLBACK.accent,
    distinct: v("--distinct") || FALLBACK.distinct,
    reskinned: v("--reskinned") || FALLBACK.reskinned,
    fabrication: v("--fabrication") || FALLBACK.fabrication,
  };
}

const FALLBACK: ThemeColors = {
  bgApp: "#0a0a0f",
  bgRaised: "#14141a",
  border: "rgba(255,255,255,0.06)",
  borderFocus: "rgba(255,255,255,0.15)",
  textPrimary: "#e8e6e3",
  textSecondary: "#8a8a8e",
  textMuted: "#4a4a50",
  accent: "#5ba8a0",
  distinct: "#4a9a6a",
  reskinned: "#c9a85b",
  fabrication: "#c96b6b",
};

// Invalidate whenever theme toggles — useTheme dispatches a storage event
// which we don't use, but the toggle also mutates data-theme on <html>,
// so we observe that via MutationObserver.

let cached: ThemeColors = readColors();

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  // Start the observer on first subscriber
  if (listeners.size === 0 && typeof MutationObserver !== "undefined") {
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) observer.disconnect();
  };
}

const observer =
  typeof MutationObserver !== "undefined"
    ? new MutationObserver(() => {
        cached = readColors();
        for (const cb of listeners) cb();
      })
    : ({ observe() {}, disconnect() {} } as Pick<
        MutationObserver,
        "observe" | "disconnect"
      >);

function getSnapshot(): ThemeColors {
  return cached;
}

function getServerSnapshot(): ThemeColors {
  return FALLBACK;
}

export function useThemeColors(): ThemeColors {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
