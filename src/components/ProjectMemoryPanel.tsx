"use client";

import { useMemo, useState } from "react";
import { createProjectMemory, saveProjectMemory, type ProjectMemory } from "@/lib/projectMemory";

interface Props { memory: ProjectMemory; onChange: (memory: ProjectMemory) => void; onClose?: () => void; }
const fields: Array<[keyof Pick<ProjectMemory, "architecture" | "stack" | "conventions" | "database" | "deployment">, string, string]> = [
  ["architecture", "Architecture", "How the repository is structured"],
  ["stack", "Stack", "Frameworks, runtimes, and key dependencies"],
  ["conventions", "Conventions", "Coding, naming, testing, and API conventions"],
  ["database", "Database", "Schema, ORM, migrations, and data constraints"],
  ["deployment", "Deployment", "Build, hosting, environment, and release notes"],
];

export default function ProjectMemoryPanel({ memory, onChange, onClose }: Props) {
  const [draft, setDraft] = useState(memory);
  const [saved, setSaved] = useState(false);
  const listSummary = useMemo(() => `${draft.decisions.length} decisions · ${draft.knownBugs.length} bugs · ${draft.todos.length} TODOs`, [draft]);
  function update(field: string, value: string) { setDraft((current) => ({ ...current, [field]: value })); setSaved(false); }
  function addItem(field: "decisions" | "knownBugs" | "todos") { const value = window.prompt(`Add ${field === "knownBugs" ? "known bug" : field === "todos" ? "TODO" : "decision"}`)?.trim(); if (value) { setDraft((current) => ({ ...current, [field]: [...current[field], value].slice(-40) })); setSaved(false); } }
  function removeItem(field: "decisions" | "knownBugs" | "todos", index: number) { setDraft((current) => ({ ...current, [field]: current[field].filter((_, itemIndex) => itemIndex !== index) })); setSaved(false); }
  function persist() { const next = saveProjectMemory(createProjectMemory(draft.repo, draft)); setDraft(next); onChange(next); setSaved(true); }

  return <section className="memory-panel" aria-label="Project memory">
    <header className="memory-panel__header"><div><div className="memory-panel__eyebrow">ORA // PROJECT MEMORY</div><h2>Context Vault</h2><p>{memory.repo} · {listSummary}</p></div>{onClose && <button onClick={onClose} className="memory-panel__close" aria-label="Close memory">×</button>}</header>
    <div className="memory-panel__body">
      <div className="memory-panel__notice">Persistent browser memory is user-maintained context. ORA must verify it against the repository before relying on it.</div>
      {fields.map(([field, label, placeholder]) => <label key={field} className="memory-field"><span>{label}</span><textarea value={draft[field]} onChange={(event) => update(field, event.target.value)} placeholder={placeholder} rows={2} /></label>)}
      {(["decisions", "knownBugs", "todos"] as const).map((field) => <div className="memory-list" key={field}><div className="memory-list__header"><span>{field === "knownBugs" ? "Known bugs" : field === "todos" ? "TODOs" : "Important decisions"}</span><button onClick={() => addItem(field)}>+ ADD</button></div>{draft[field].length === 0 ? <p className="memory-list__empty">No entries yet.</p> : draft[field].map((item, index) => <div className="memory-list__item" key={`${item}_${index}`}><span>{item}</span><button onClick={() => removeItem(field, index)} aria-label={`Remove ${item}`}>×</button></div>)}</div>)}
    </div>
    <footer className="memory-panel__footer"><button onClick={() => { setDraft(memory); setSaved(false); }} className="memory-panel__secondary">RESET</button><button onClick={persist} className="memory-panel__primary">{saved ? "SAVED" : "SAVE MEMORY"}</button></footer>
  </section>;
}
