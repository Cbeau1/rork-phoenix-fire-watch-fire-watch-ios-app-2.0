import createContextHook from "@nkzw/create-context-hook";
import { useCallback, useEffect, useState } from "react";

import { THEME_CHROME, THEME_STORAGE_KEY, type ResolvedTheme, type ThemePreference } from "@/lib/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

const readPreference = (): ThemePreference => {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    // Storage blocked (private mode) — fall back to System.
  }
  return "system";
};

const systemTheme = (): ResolvedTheme => (window.matchMedia(DARK_QUERY).matches ? "dark" : "light");

/** Applies the theme to <html> (class + color-scheme) and the browser chrome color. */
const applyTheme = (theme: ResolvedTheme): void => {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  root.style.colorScheme = theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", THEME_CHROME[theme]));
};

/** Appearance preference (Light / Dark / System), persisted per browser; System follows the OS live. */
export const [ThemeProvider, useTheme] = createContextHook(() => {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    // Keep other open tabs in sync with a change made here.
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) setPreferenceState(readPreference());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const resolved: ResolvedTheme = preference === "system" ? system : preference;

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      console.warn("[Theme] could not persist appearance preference");
    }
  }, []);

  return { preference, resolved, setPreference };
});
