"use client";

import { useEffect, useMemo, useState } from "react";

export interface LambertWorkflow {
  id: string;
  label: string;
  description: string;
  prompt: string;
  tone: "cyan" | "violet" | "amber";
}

export const LAMBERT_WORKFLOWS: LambertWorkflow[] = [
  { id: "quality-loop", label: "Quality loop", description: "Lint, typecheck, test, build, then repair failures.", prompt: "Run a complete quality loop on this repository: inspect first, then lint, typecheck, test, and build. Repair failures across files and verify the final result.", tone: "cyan" },
  { id: "review-repo", label: "Review repository", description: "Find correctness, security, and maintainability risks.", prompt: "Perform a deep repository review. Prioritize correctness bugs, security risks, performance regressions, and maintainability issues. Inspect evidence before proposing changes.", tone: "violet" },
  { id: "fix-types", label: "Fix type errors", description: "Resolve TypeScript or static-analysis errors safely.", prompt: "Find and fix all TypeScript and static-analysis errors in the repository. Preserve behavior, make the smallest coherent multi-file changes, and verify with the project checks.", tone: "amber" },
  { id: "optimize-runtime", label: "Optimize runtime", description: "Profile hot paths and improve measurable responsiveness.", prompt: "Audit this repository for runtime and bundle performance. Identify the highest-impact hot paths, implement evidence-based optimizations, and verify that behavior and tests remain correct.", tone: "cyan" },
  { id: "security-pass", label: "Security pass", description: "Inspect secrets, auth boundaries, validation, and unsafe flows.", prompt: "Perform a security-focused coding pass. Inspect authentication, authorization, secrets, input validation, file operations, and external API boundaries. Repair confirmed issues and verify them.", tone: "violet" },
];

interface Props {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onRun: (prompt: string) => void;
}

export default function LambertCommandPalette({ open, busy, onClose, onRun }: Props) {
  const [query, setQuery] = useState("");
  const [customTask, setCustomTask] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? LAMBERT_WORKFLOWS.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(normalized)) : LAMBERT_WORKFLOWS;
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ora-command-overlay" role="presentation" onMouseDown={onClose}>
      <section className="ora-command-palette" role="dialog" aria-modal="true" aria-labelledby="lambert-command-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="ora-command-palette__header">
          <div>
            <div className="ora-command-palette__eyebrow">LAMBERT // AUTONOMOUS OPS</div>
            <h2 id="lambert-command-title">Quick workflows</h2>
            <p>Launch a verified coding mission without rewriting the brief.</p>
          </div>
          <button type="button" className="touch-target ora-command-palette__close" onClick={onClose} aria-label="Close workflow command palette">×</button>
        </header>
        <label className="ora-command-palette__search"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter workflows…" /></label>
        <div className="ora-command-palette__list">
          {filtered.map((workflow, index) => (
            <button key={workflow.id} type="button" className={`ora-workflow-card ora-workflow-card--${workflow.tone}`} onClick={() => onRun(workflow.prompt)} disabled={busy}>
              <span className="ora-workflow-card__index">{String(index + 1).padStart(2, "0")}</span>
              <span><strong>{workflow.label}</strong><small>{workflow.description}</small></span>
              <kbd>↵</kbd>
            </button>
          ))}
          {filtered.length === 0 && <p className="ora-command-palette__empty">No preset matches that filter.</p>}
        </div>
        <div className="ora-command-palette__custom"><label htmlFor="lambert-custom-workflow">Custom autonomous brief</label><div><input id="lambert-custom-workflow" value={customTask} onChange={(event) => setCustomTask(event.target.value)} placeholder="e.g. Harden the checkout flow and add regression tests" onKeyDown={(event) => { if (event.key === "Enter" && customTask.trim()) onRun(customTask.trim()); }} /><button type="button" onClick={() => customTask.trim() && onRun(customTask.trim())} disabled={busy || !customTask.trim()}>Run</button></div></div>
        <footer className="ora-command-palette__footer"><span><kbd>Ctrl</kbd><kbd>P</kbd> open palette</span><span><kbd>Esc</kbd> close</span><span>Runs in Agent mode</span></footer>
      </section>
    </div>
  );
}
