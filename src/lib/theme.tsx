"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "codeagent:theme";

function readInitialTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  // The inline script in layout.tsx already set the `light` class on <html>
  // (or left it off) before hydration, based on localStorage / system
  // preference. Reading it back here keeps this component in sync with
  // whatever was decided pre-paint, instead of re-deciding independently
  // and risking a mismatch.
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  // Sync from the DOM on mount (see readInitialTheme note above).
  useEffect(() => {
    setThemeState(readInitialTheme());
  }, []);

  const applyTheme = useCallback((next: Theme) => {
    setThemeState(next);
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("light", next === "light");
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch { /* storage unavailable — theme just won't persist */ }
  }, []);

  const toggleTheme = useCallback(() => {
    applyTheme(theme === "dark" ? "light" : "dark");
  }, [theme, applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme: applyTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Sensible fallback rather than throwing — lets components that render
    // outside the provider (e.g. in isolation/tests) degrade to dark mode
    // instead of crashing the whole tree.
    return { theme: "dark", toggleTheme: () => {}, setTheme: () => {} };
  }
  return ctx;
}

const IconSun = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="4" strokeWidth={2} />
    <path strokeLinecap="round" strokeWidth={2} d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);
const IconMoon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
  </svg>
);

/** Compact icon-only toggle button — matches the other top-bar icon buttons. */
export function ThemeToggleButton({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      className={`touch-target rounded-lg text-zinc-500 hover:text-zinc-200 light:text-zinc-500 light:hover:text-zinc-900 transition-colors ${className}`}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      {theme === "dark" ? <IconSun /> : <IconMoon />}
    </button>
  );
}
