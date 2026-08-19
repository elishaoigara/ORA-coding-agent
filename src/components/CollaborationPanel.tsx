"use client";

import { SPECIALISTS, type SpecialistRole } from "@/lib/collaboration";

interface Props { selected: SpecialistRole[]; onChange: (roles: SpecialistRole[]) => void; onClose?: () => void; }

export default function CollaborationPanel({ selected, onChange, onClose }: Props) {
  function toggle(role: SpecialistRole) { onChange(selected.includes(role) ? selected.filter((item) => item !== role) : [...selected, role].slice(-4)); }
  return <section className="collab-panel" aria-label="Agent collaboration">
    <header className="collab-panel__header"><div><div className="collab-panel__eyebrow">ORA // ORCHESTRATION</div><h2>Specialist Mesh</h2><p>{selected.length ? `${selected.length} specialist perspective${selected.length === 1 ? "" : "s"} active` : "Manager agent only"}</p></div>{onClose && <button onClick={onClose} className="collab-panel__close" aria-label="Close collaboration">×</button>}</header>
    <div className="collab-panel__notice">Specialists provide bounded perspectives. The manager reconciles their outputs into one plan and keeps the existing approval gate.</div>
    <div className="collab-panel__roles">{SPECIALISTS.map((role) => { const active = selected.includes(role.id); return <button key={role.id} onClick={() => toggle(role.id)} className={`collab-role ${active ? "is-active" : ""}`}><span className="collab-role__dot" /><span><strong>{role.label}</strong><small>{role.focus}</small></span><em>{active ? "ON" : "OFF"}</em></button>; })}</div>
    <footer className="collab-panel__footer"><span>Maximum 4 specialists per run</span>{selected.length > 0 && <button onClick={() => onChange([])}>CLEAR</button>}</footer>
  </section>;
}
