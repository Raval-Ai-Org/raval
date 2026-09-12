"use client";

/**
 * Theme state.
 *
 * This used to be plain `useState` inside the hook, which meant every caller
 * held its own independent copy: toggling the theme from the account menu left
 * the chat panel, the shell, and the toaster all still reporting the old value.
 * State now lives in one context (`ThemeProvider`, mounted in
 * `src/app/providers.tsx`) so every consumer agrees.
 *
 * Three preferences, two resolved themes. `preference` is what the user chose
 * and what we persist; `theme` is what is actually on screen after resolving
 * "system" against the OS setting.
 */

import * as React from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

/** Read by the pre-hydration script in `src/app/layout.tsx`. Keep in sync. */
export const THEME_STORAGE_KEY = "mellox:theme";
/** Superseded by THEME_STORAGE_KEY; read once so existing users keep their choice. */
const LEGACY_STORAGE_KEY = "reach-theme";

type ThemeContextValue = {
  /** What the user chose. */
  preference: ThemePreference;
  /** What is on screen — "system" resolved against the OS setting. */
  theme: ResolvedTheme;
  /** False until the client has read storage, so SSR markup is never trusted. */
  mounted: boolean;
  setPreference: (next: ThemePreference) => void;
  /** Pin the opposite of whatever is currently showing. */
  toggle: () => void;
  /** Back-compat with call sites that only know about light/dark. */
  setTheme: (next: ResolvedTheme) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy === "light" || legacy === "dark") return legacy;
  } catch {
    /* private mode, or storage disabled — fall through to the default */
  }
  return "system";
}

function systemTheme(): ResolvedTheme {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function resolve(preference: ThemePreference, system: ResolvedTheme): ResolvedTheme {
  return preference === "system" ? system : preference;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // The server renders with the dark class on <html> and the pre-hydration
  // script corrects it before paint, so starting here matches the markup.
  const [preference, setPreferenceState] = React.useState<ThemePreference>("system");
  const [system, setSystem] = React.useState<ResolvedTheme>("dark");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setPreferenceState(readStoredPreference());
    setSystem(systemTheme());
    setMounted(true);

    const query = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setSystem(query.matches ? "light" : "dark");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const theme = resolve(preference, system);

  React.useEffect(() => {
    if (!mounted) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme, mounted]);

  const setPreference = React.useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* preference is still applied for this session */
    }
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      preference,
      theme,
      mounted,
      setPreference,
      setTheme: setPreference,
      toggle: () => setPreference(theme === "dark" ? "light" : "dark"),
    }),
    [preference, theme, mounted, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (context) return context;
  // Rendered outside the provider (a test, or a tree mounted in isolation).
  // Report the server default rather than throwing — a missing provider should
  // not take down a panel.
  return {
    preference: "system",
    theme: "dark",
    mounted: false,
    setPreference: () => {},
    setTheme: () => {},
    toggle: () => {},
  };
}
