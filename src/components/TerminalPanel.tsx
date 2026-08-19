"use client";

import { useRef, useState } from "react";
import { readSse } from "@/lib/readSse";

interface TerminalLine { id: string; kind: string; text: string; timestamp: number; }
interface Props { repo: string; branch?: string; onClose?: () => void; onRepair?: (failure: string) => void; }

export default function TerminalPanel({ repo, branch, onClose, onRepair }: Props) {
  const [sessionId, setSessionId] = useState("");
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [verification, setVerification] = useState<{ passed?: boolean; steps?: Array<{ label: string; passed: boolean; exitCode: number }> }>({});
  const [lastFailure, setLastFailure] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  function addLine(kind: string, text: string) {
    if (!text.trim()) return;
    setLines((current) => [...current.slice(-399), { id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, kind, text, timestamp: Date.now() }]);
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  async function streamAction(action: "start" | "exec" | "verify", extra: Record<string, unknown> = {}) {
    if (busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      const response = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ action, repo, branch, sessionId: sessionId || undefined, ...extra }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error || "Terminal request failed");
      await readSse(response, ({ data }) => {
        const event = JSON.parse(data) as { type: string; kind?: string; text?: string; session?: { id: string }; passed?: boolean; steps?: Array<{ label: string; passed: boolean; exitCode: number }> };
        if (event.type === "terminal") addLine(event.kind ?? "system", event.text ?? "");
        if (event.type === "session" && event.session?.id) { setSessionId(event.session.id); setConnected(true); addLine("system", "Terminal session connected"); }
        if (event.type === "verification_done") {
          setVerification({ passed: event.passed, steps: event.steps });
          const failedStep = event.steps?.find((step) => !step.passed);
          const failure = failedStep ? `${failedStep.label} failed with exit code ${failedStep.exitCode}. Inspect the streamed output, identify the root cause, and make the smallest safe multi-file repair.` : "Verification pipeline failed; inspect the streamed output.";
          setLastFailure(event.passed ? "" : failure);
          addLine(event.passed ? "result" : "stderr", event.passed ? "All verification checks passed" : failure);
        }
        if (event.type === "error") addLine("stderr", event.text ?? "Terminal operation failed");
      });
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) addLine("stderr", error instanceof Error ? error.message : "Terminal request failed");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function start() { setLines([]); setVerification({}); await streamAction("start"); }
  async function runCommand() { const value = command.trim(); if (!value || !sessionId) return; setCommand(""); await streamAction("exec", { command: value }); }
  async function stop() {
    abortRef.current?.abort();
    if (sessionId) await fetch("/api/terminal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop", sessionId }) });
    setConnected(false); setSessionId(""); setBusy(false); addLine("system", "Terminal session stopped");
  }

  return (
    <section className="terminal-panel" aria-label="Terminal workspace">
      <header className="terminal-panel__header">
        <div><div className="terminal-panel__eyebrow">ORA // WORKSPACE RUNTIME</div><h2>Terminal</h2></div>
        <div className="terminal-panel__header-actions">
          <span className={`terminal-panel__status ${connected ? "is-connected" : ""}`}>{connected ? "CONNECTED" : "OFFLINE"}</span>
          {onClose && <button type="button" onClick={onClose} className="terminal-panel__close">×</button>}
        </div>
      </header>

      {!connected ? (
        <div className="terminal-panel__connect">
          <div className="terminal-panel__connect-icon">⌘</div>
          <p>Start an isolated workspace for <strong>{repo || "a connected repository"}</strong>{branch ? ` on ${branch}` : ""}.</p>
          <button type="button" onClick={start} disabled={!repo || busy} className="terminal-panel__primary">{busy ? "PREPARING…" : "START WORKSPACE"}</button>
        </div>
      ) : (
        <>
          <div className="terminal-panel__toolbar">
            <button type="button" onClick={() => streamAction("verify")} disabled={busy} className="terminal-panel__action">{busy ? "RUNNING…" : "VERIFY PROJECT"}</button>
            <button type="button" onClick={stop} className="terminal-panel__action terminal-panel__action--danger">STOP</button>
            {verification.steps && <span className={`terminal-panel__verification ${verification.passed ? "is-passed" : "is-failed"}`}>{verification.passed ? "PASS" : "REPAIR NEEDED"}</span>}
            {!verification.passed && lastFailure && onRepair && <button type="button" onClick={() => onRepair(lastFailure)} className="terminal-panel__repair">REPAIR WITH ORA</button>}
          </div>
          <div className="terminal-panel__output" role="log" aria-live="polite">
            {lines.length === 0 && <div className="terminal-panel__empty">Workspace ready. Run a command or start verification.</div>}
            {lines.map((line) => <div key={line.id} className={`terminal-line terminal-line--${line.kind}`}><span className="terminal-line__time">{new Date(line.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span><span className="terminal-line__text">{line.text}</span></div>)}
            <div ref={endRef} />
          </div>
          <form className="terminal-panel__input" onSubmit={(event) => { event.preventDefault(); void runCommand(); }}>
            <span className="terminal-panel__prompt">$</span>
            <input value={command} onChange={(event) => setCommand(event.target.value)} disabled={busy} placeholder="run a safe workspace command…" aria-label="Terminal command" />
            <button type="submit" disabled={!command.trim() || busy}>RUN</button>
          </form>
        </>
      )}
    </section>
  );
}
