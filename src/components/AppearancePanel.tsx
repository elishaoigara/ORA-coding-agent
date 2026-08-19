"use client";

import { useEffect, useState } from "react";
import { useTheme, type Theme } from "@/lib/theme";

export type AccentId = "cyan" | "magenta" | "lime" | "amber";
export type Density = "comfortable" | "compact";

export interface AppearanceSettings {
  accent: AccentId;
  density: Density;
}

export const ACCENTS: { id: AccentId; label: string; cyan: string; violet: string; line: string }[] = [
  { id: "cyan", label: "Neon cyan", cyan: "#48e6d1", violet: "#9b8cff", line: "rgba(72, 230, 209, .28)" },
  { id: "magenta", label: "Hot magenta", cyan: "#ff6bb5", violet: "#b691ff", line: "rgba(255, 107, 181, .28)" },
  { id: "lime", label: "Toxic lime", cyan: "#b7f34a", violet: "#55e6c1", line: "rgba(183, 243, 74, .28)" },
  { id: "amber", label: "Laser amber", cyan: "#ffc857", violet: "#ff7a9c", line: "rgba(255, 200, 87, .28)" },
];

const DEFAULTS: AppearanceSettings = { accent: "cyan", density: "comfortable" };

export function readAppearance(): AppearanceSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const parsed = JSON.parse(localStorage.getItem("ora:appearance") || "null") as Partial<AppearanceSettings> | null;
    return { ...DEFAULTS, ...parsed, accent: ACCENTS.some((a) => a.id === parsed?.accent) ? parsed!.accent! : DEFAULTS.accent, density: parsed?.density === "compact" ? "compact" : DEFAULTS.density };
  } catch { return DEFAULTS; }
}

function applyAppearance(settings: AppearanceSettings) {
  const accent = ACCENTS.find((item) => item.id === settings.accent) ?? ACCENTS[0];
  const root = document.documentElement;
  root.style.setProperty("--ora-cyan", accent.cyan);
  root.style.setProperty("--ora-violet", accent.violet);
  root.style.setProperty("--ora-line", accent.line);
  root.dataset.oraAccent = settings.accent;
  root.dataset.oraDensity = settings.density;
  try { localStorage.setItem("ora:appearance", JSON.stringify(settings)); } catch { /* persistence is optional */ }
}

export default function AppearancePanel({ settings, onChange, onClose }: { settings: AppearanceSettings; onChange: (next: AppearanceSettings) => void; onClose: () => void }) {
  const { theme, setTheme } = useTheme();
  const [draft, setDraft] = useState(settings);
  useEffect(() => { setDraft(settings); }, [settings]);

  const update = (next: AppearanceSettings) => { setDraft(next); onChange(next); applyAppearance(next); };

  return (
    <section className="appearance-panel" aria-label="Appearance settings">
      <header className="appearance-panel__header">
        <div><div className="appearance-panel__eyebrow">ORA // APPEARANCE</div><h2>Interface signal</h2><p>Customize the command surface.</p></div>
        <button type="button" className="appearance-panel__close" onClick={onClose} aria-label="Close appearance">×</button>
      </header>
      <div className="appearance-panel__body">
        <div className="appearance-panel__section">
          <span className="appearance-panel__label">Theme mode</span>
          <div className="appearance-segmented">
            {(["dark", "light"] as Theme[]).map((value) => <button key={value} type="button" className={theme === value ? "is-active" : ""} onClick={() => setTheme(value)}>{value === "dark" ? "Night grid" : "Day grid"}</button>)}
          </div>
        </div>
        <div className="appearance-panel__section">
          <span className="appearance-panel__label">Accent channel</span>
          <div className="appearance-swatches">
            {ACCENTS.map((accent) => <button key={accent.id} type="button" className={`appearance-swatch ${draft.accent === accent.id ? "is-active" : ""}`} onClick={() => update({ ...draft, accent: accent.id })} aria-label={accent.label} title={accent.label}><span style={{ background: `linear-gradient(135deg, ${accent.cyan}, ${accent.violet})` }} /></button>)}
          </div>
        </div>
        <div className="appearance-panel__section">
          <span className="appearance-panel__label">Workspace density</span>
          <div className="appearance-segmented">
            {(["comfortable", "compact"] as Density[]).map((value) => <button key={value} type="button" className={draft.density === value ? "is-active" : ""} onClick={() => update({ ...draft, density: value })}>{value}</button>)}
          </div>
        </div>
      </div>
    </section>
  );
}
