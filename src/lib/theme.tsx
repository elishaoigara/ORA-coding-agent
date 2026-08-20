"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/** ORA intentionally uses one visual system: cyberpunk dark mode. */
export type Theme = "dark";

interface ThemeContextValue {
  theme: Theme;
  /** Kept as a no-op for keyboard shortcut compatibility. */
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "codeagent:theme";

function enforceCyberpunkTheme() {
  if (typeof document !== "undefined") {
    document.documentElement.classList.remove("light");
    document.documentElement.style.colorScheme = "dark";
  }
  try { localStorage.setItem(STORAGE_KEY, "dark"); } catch { /* storage is optional */ }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme] = useState<Theme>("dark");

  useEffect(() => {
    enforceCyberpunkTheme();
  }, []);

  const applyTheme = useCallback(() => {
    enforceCyberpunkTheme();
  }, []);

  const toggleTheme = useCallback(() => {
    // Deliberately locked: ORA's components are designed around the dark cyberpunk palette.
    enforceCyberpunkTheme();
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme: applyTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) return { theme: "dark", toggleTheme: () => {}, setTheme: () => {} };
  return ctx;
}

/** Retained for compatibility with isolated consumers; the control is visibly locked. */
export function ThemeToggleButton({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      disabled
      className={`touch-target rounded-lg text-zinc-500 opacity-80 cursor-not-allowed ${className}`}
      aria-label="Cyberpunk dark mode is locked"
      title="ORA uses cyberpunk dark mode"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
      </svg>
    </button>
  );
}
