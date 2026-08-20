"use client";

import { useEffect, useRef, useState } from "react";
export type AccentId = "cyan" | "magenta" | "lime" | "amber" | "blue" | "red";
export type Density = "comfortable" | "compact";
export type PresetId = "neon-grid" | "synthwave" | "toxic-lab" | "solar-flare" | "deep-space" | "blood-moon";
export type SoundMime = "audio/wav" | "audio/mpeg" | "audio/ogg" | "audio/webm";

export interface SoundPack { id: string; name: string; mime: SoundMime; dataUrl: string; }
export interface AppearanceSettings { accent: AccentId; density: Density; preset: PresetId; soundEnabled: boolean; }
export interface AppearancePreset { id: PresetId; label: string; description: string; accent: AccentId; density: Density; cyan: string; violet: string; line: string; }

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
    return { ...DEFAULTS, ...parsed, preset, accent: PRESETS.some((item) => item.accent === parsed?.accent) ? parsed!.accent! : fromPreset.accent, density: parsed?.density === "compact" ? "compact" : fromPreset.density, soundEnabled: parsed?.soundEnabled === true };
  } catch { return DEFAULTS; }
}

function playSynth(enabled: boolean) {
  if (!enabled || typeof window === "undefined") return;
  try {
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = "sine"; oscillator.frequency.setValueAtTime(520, context.currentTime); oscillator.frequency.exponentialRampToValueAtTime(760, context.currentTime + 0.08);
    gain.gain.setValueAtTime(0.035, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
    oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.12); window.setTimeout(() => void context.close(), 180);
  } catch { /* audio is optional */ }
}

interface AppearancePanelProps {
  settings: AppearanceSettings;
  onChange: (next: AppearanceSettings) => void;
  onClose: () => void;
  soundPacks?: SoundPack[];
  selectedSoundPackId?: string;
  onSelectSoundPack?: (id: string) => void;
  onUploadSoundPack?: (file: File) => Promise<void>;
  onDeleteSoundPack?: (id: string) => void;
  profileStatus?: string;
  displayName?: string;
  onDisplayNameChange?: (name: string) => void;
  onPullProfile?: () => Promise<void>;
  onPushProfile?: () => Promise<void>;
}

export default function AppearancePanel({ settings, onChange, onClose, soundPacks = [], selectedSoundPackId = "", onSelectSoundPack, onUploadSoundPack, onDeleteSoundPack, profileStatus = "Local profile", displayName = "Lambert", onDisplayNameChange, onPullProfile, onPushProfile }: AppearancePanelProps) {
  const [draft, setDraft] = useState(settings);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(settings); }, [settings]);

  const preview = (pack?: SoundPack) => {
    if (!draft.soundEnabled) return;
    if (pack) { try { const audio = new Audio(pack.dataUrl); audio.volume = 0.35; void audio.play(); return; } catch { /* fallback */ } }
    playSynth(true);
  };
  const update = (next: AppearanceSettings, signal = true) => { setDraft(next); onChange(next); if (signal) preview(soundPacks.find((pack) => pack.id === selectedSoundPackId)); };
  const selectPreset = (preset: AppearancePreset) => update({ ...draft, preset: preset.id, accent: preset.accent, density: preset.density });

  return (
    <section className="appearance-panel" aria-labelledby="appearance-title">
      <header className="appearance-panel__header">
        <div><div className="appearance-panel__eyebrow">ORA // APPEARANCE</div><h2 id="appearance-title">Interface signal</h2><p>Customize and sync your command surface.</p></div>
        <button type="button" className="appearance-panel__close touch-target" onClick={onClose} aria-label="Close appearance settings">×</button>
      </header>
      <div className="appearance-panel__body">
        <fieldset className="appearance-panel__section appearance-panel__presets"><legend className="appearance-panel__label">Cyberpunk presets</legend><div className="appearance-presets">{PRESETS.map((preset) => <button key={preset.id} type="button" className={`appearance-preset ${draft.preset === preset.id ? "is-active" : ""}`} onClick={() => selectPreset(preset)} aria-pressed={draft.preset === preset.id}><span className="appearance-preset__signal" style={{ background: `linear-gradient(135deg, ${preset.cyan}, ${preset.violet})` }} /><span><strong>{preset.label}</strong><small>{preset.description}</small></span></button>)}</div></fieldset>
        <div className="appearance-panel__section appearance-theme-lock" role="status"><div><div className="appearance-panel__label">Theme mode</div><strong>Cyberpunk night grid</strong></div><span className="appearance-theme-lock__status">LOCKED</span><p className="appearance-panel__hint">ORA stays dark by design so neon accents, telemetry, and code surfaces remain readable.</p></div>
        <fieldset className="appearance-panel__section"><legend className="appearance-panel__label">Sound effects</legend><button type="button" className={`appearance-sound-toggle ${draft.soundEnabled ? "is-active" : ""}`} onClick={() => update({ ...draft, soundEnabled: !draft.soundEnabled }, false)} aria-pressed={draft.soundEnabled}><span aria-hidden="true">{draft.soundEnabled ? "◉" : "○"}</span><span>{draft.soundEnabled ? "Signal sounds on" : "Signal sounds off"}</span></button><p className="appearance-panel__hint">Optional UI chirps. Sound stays local unless you sync a selected pack.</p></fieldset>
        <fieldset className="appearance-panel__section"><legend className="appearance-panel__label">Sound pack</legend><div className="appearance-sound-packs">{soundPacks.length === 0 && <span className="appearance-panel__hint">No custom pack uploaded.</span>}{soundPacks.map((pack) => <div key={pack.id} className={`appearance-sound-pack ${selectedSoundPackId === pack.id ? "is-active" : ""}`}><button type="button" onClick={() => { onSelectSoundPack?.(pack.id); preview(pack); }} aria-pressed={selectedSoundPackId === pack.id}><span>◖</span><strong>{pack.name}</strong></button><button type="button" className="appearance-sound-pack__delete" onClick={() => onDeleteSoundPack?.(pack.id)} aria-label={`Delete sound pack ${pack.name}`}>×</button></div>)}<input ref={fileRef} type="file" accept="audio/wav,audio/mpeg,audio/ogg,audio/webm" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void onUploadSoundPack?.(file); event.currentTarget.value = ""; }} /><button type="button" className="appearance-upload" onClick={() => fileRef.current?.click()} disabled={soundPacks.length >= 3}>+ Upload sound pack <span>(max 3, 256KB each)</span></button></div></fieldset>
        <fieldset className="appearance-panel__section"><legend className="appearance-panel__label">Workspace density</legend><div className="appearance-segmented" role="group" aria-label="Workspace density">{(["comfortable", "compact"] as Density[]).map((value) => <button key={value} type="button" className={draft.density === value ? "is-active" : ""} onClick={() => update({ ...draft, density: value })} aria-pressed={draft.density === value}>{value}</button>)}</div></fieldset>
        <fieldset className="appearance-panel__section appearance-personal-profile"><legend className="appearance-panel__label">Personal coding profile</legend><label className="appearance-profile-name"><span>Agent recognizes</span><input value={displayName ?? "Lambert"} onChange={(event) => onDisplayNameChange?.(event.target.value)} placeholder="Your name" maxLength={60} /></label><p className="appearance-panel__hint">Used to personalize ORA’s private system context.</p></fieldset>
        <fieldset className="appearance-panel__section appearance-profile-sync"><legend className="appearance-panel__label">Personal profile sync</legend><div className="appearance-profile-sync__row"><span className="appearance-panel__hint" role="status">{profileStatus}</span><button type="button" onClick={() => void onPullProfile?.()}>Pull</button><button type="button" onClick={() => void onPushProfile?.()}>Push</button></div><p className="appearance-panel__hint">Private GitHub Gist sync. Your profile is not written to this repository.</p></fieldset>
      </div>
    </section>
  );
}
