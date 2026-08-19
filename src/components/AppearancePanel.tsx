"use client";

import { useEffect, useState } from "react";
import { useTheme, type Theme } from "@/lib/theme";

export type AccentId = "cyan" | "magenta" | "lime" | "amber" | "blue" | "red";
export type Density = "comfortable" | "compact";
export type PresetId = "neon-grid" | "synthwave" | "toxic-lab" | "solar-flare" | "deep-space" | "blood-moon";

export interface AppearanceSettings {
  accent: AccentId;
  density: Density;
  preset: PresetId;
  soundEnabled: boolean;
}

export interface AppearancePreset {
  id: PresetId;
  label: string;
  description: string;
  accent: AccentId;
  density: Density;
  cyan: string;
  violet: string;
  line: string;
}

export const PRESETS: AppearancePreset[] = [
  { id: "neon-grid", label: "Neon Grid", description: "Classic cyan command surface", accent: "cyan", density: "comfortable", cyan: "#48e6d1", violet: "#9b8cff", line: "rgba(72, 230, 209, .28)" },
  { id: "synthwave", label: "Synthwave", description: "Magenta arcade after-dark", accent: "magenta", density: "comfortable", cyan: "#ff6bb5", violet: "#b691ff", line: "rgba(255, 107, 181, .28)" },
  { id: "toxic-lab", label: "Toxic Lab", description: "Lime signal, compact rhythm", accent: "lime", density: "compact", cyan: "#b7f34a", violet: "#55e6c1", line: "rgba(183, 243, 74, .28)" },
  { id: "solar-flare", label: "Solar Flare", description: "Amber heat and red alert", accent: "amber", density: "comfortable", cyan: "#ffc857", violet: "#ff7a9c", line: "rgba(255, 200, 87, .28)" },
  { id: "deep-space", label: "Deep Space", description: "Electric blue long-haul mode", accent: "blue", density: "compact", cyan: "#66b3ff", violet: "#9b8cff", line: "rgba(102, 179, 255, .28)" },
  { id: "blood-moon", label: "Blood Moon", description: "Red threat-monitoring mode", accent: "red", density: "comfortable", cyan: "#ff5c7c", violet: "#ff9f68", line: "rgba(255, 92, 124, .28)" },
];

export const ACCENTS = PRESETS.map(({ label, accent: id, cyan, violet, line }) => ({ id, label, cyan, violet, line }));
const DEFAULTS: AppearanceSettings = { accent: "cyan", density: "comfortable", preset: "neon-grid", soundEnabled: false };

export function readAppearance(): AppearanceSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const parsed = JSON.parse(localStorage.getItem("ora:appearance") || "null") as Partial<AppearanceSettings> | null;
    const preset = PRESETS.some((item) => item.id === parsed?.preset) ? parsed!.preset! : DEFAULTS.preset;
    const fromPreset = PRESETS.find((item) => item.id === preset) ?? PRESETS[0];
    return {
      ...DEFAULTS,
      ...parsed,
      preset,
      accent: PRESETS.some((item) => item.accent === parsed?.accent) ? parsed!.accent! : fromPreset.accent,
      density: parsed?.density === "compact" ? "compact" : fromPreset.density,
      soundEnabled: parsed?.soundEnabled === true,
    };
  } catch { return DEFAULTS; }
}

function playSignal(enabled: boolean) {
  if (!enabled || typeof window === "undefined") return;
  try {
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(520, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(760, context.currentTime + 0.08);
    gain.gain.setValueAtTime(0.035, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
    window.setTimeout(() => void context.close(), 180);
  } catch { /* audio is optional */ }
}

export default function AppearancePanel({ settings, onChange, onClose }: { settings: AppearanceSettings; onChange: (next: AppearanceSettings) => void; onClose: () => void }) {
  const { theme, setTheme } = useTheme();
  const [draft, setDraft] = useState(settings);
  useEffect(() => { setDraft(settings); }, [settings]);

  const update = (next: AppearanceSettings, signal = true) => {
    setDraft(next);
    onChange(next);
    playSignal(next.soundEnabled && signal);
  };
  const selectPreset = (preset: AppearancePreset) => update({ ...draft, preset: preset.id, accent: preset.accent, density: preset.density });

  return (
    <section className="appearance-panel" aria-labelledby="appearance-title">
      <header className="appearance-panel__header">
        <div><div className="appearance-panel__eyebrow">ORA // APPEARANCE</div><h2 id="appearance-title">Interface signal</h2><p>Customize the command surface.</p></div>
        <button type="button" className="appearance-panel__close touch-target" onClick={onClose} aria-label="Close appearance settings">×</button>
      </header>
      <div className="appearance-panel__body">
        <fieldset className="appearance-panel__section appearance-panel__presets">
          <legend className="appearance-panel__label">Cyberpunk presets</legend>
          <div className="appearance-presets">
            {PRESETS.map((preset) => <button key={preset.id} type="button" className={`appearance-preset ${draft.preset === preset.id ? "is-active" : ""}`} onClick={() => selectPreset(preset)} aria-pressed={draft.preset === preset.id}><span className="appearance-preset__signal" style={{ background: `linear-gradient(135deg, ${preset.cyan}, ${preset.violet})` }} /><span><strong>{preset.label}</strong><small>{preset.description}</small></span></button>)}
          </div>
        </fieldset>
        <fieldset className="appearance-panel__section">
          <legend className="appearance-panel__label">Theme mode</legend>
          <div className="appearance-segmented" role="group" aria-label="Theme mode">
            {(["dark", "light"] as Theme[]).map((value) => <button key={value} type="button" className={theme === value ? "is-active" : ""} onClick={() => setTheme(value)} aria-pressed={theme === value}>{value === "dark" ? "Night grid" : "Day grid"}</button>)}
          </div>
        </fieldset>
        <fieldset className="appearance-panel__section">
          <legend className="appearance-panel__label">Sound effects</legend>
          <button type="button" className={`appearance-sound-toggle ${draft.soundEnabled ? "is-active" : ""}`} onClick={() => update({ ...draft, soundEnabled: !draft.soundEnabled }, false)} aria-pressed={draft.soundEnabled}><span aria-hidden="true">{draft.soundEnabled ? "◉" : "○"}</span><span>{draft.soundEnabled ? "Signal sounds on" : "Signal sounds off"}</span></button>
          <p className="appearance-panel__hint">Optional UI chirps for palette changes and agent events.</p>
        </fieldset>
        <fieldset className="appearance-panel__section">
          <legend className="appearance-panel__label">Workspace density</legend>
          <div className="appearance-segmented" role="group" aria-label="Workspace density">
            {(["comfortable", "compact"] as Density[]).map((value) => <button key={value} type="button" className={draft.density === value ? "is-active" : ""} onClick={() => update({ ...draft, density: value })} aria-pressed={draft.density === value}>{value}</button>)}
          </div>
        </fieldset>
      </div>
    </section>
  );
}
