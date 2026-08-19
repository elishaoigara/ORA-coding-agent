"use client";

import { useEffect, useRef } from "react";

export type ExecutionLogKind = "system" | "progress" | "tool" | "result" | "error" | "complete";

export interface ExecutionLogEntry {
  id: string;
  kind: ExecutionLogKind;
  text: string;
  detail?: string;
  timestamp: number;
}

interface Props {
  logs: ExecutionLogEntry[];
  active: boolean;
  phase: "planning" | "executing" | "idle" | "awaiting_approval" | "done";
  onClear?: () => void;
}

function iconFor(kind: ExecutionLogKind): string {
  return {
    system: "◈",
    progress: "›",
    tool: "⌁",
    result: "✓",
    error: "×",
    complete: "◆",
  }[kind];
}

function labelFor(kind: ExecutionLogKind): string {
  return {
    system: "SYS",
    progress: "FLOW",
    tool: "TOOL",
    result: "DONE",
    error: "ERR",
    complete: "EXIT",
  }[kind];
}

export default function AgentExecutionConsole({ logs, active, phase, onClear }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [logs.length]);

  const latest = logs[logs.length - 1];
  const phaseLabel = phase === "planning" ? "SCANNING REPOSITORY" : phase === "executing" ? "EXECUTING PLAN" : phase === "awaiting_approval" ? "AWAITING APPROVAL" : phase === "done" ? "RUN COMPLETE" : "STANDBY";

  return (
    <section className={`execution-console ${active ? "is-active" : ""}`} aria-label="Agent execution log">
      <div className="execution-console__header">
        <div className="execution-console__identity">
          <span className="execution-console__signal" aria-hidden="true"><i /><i /><i /></span>
          <div>
            <div className="execution-console__eyebrow">ORA // LIVE TELEMETRY</div>
            <div className="execution-console__title">Execution stream</div>
          </div>
        </div>
        <div className="execution-console__actions">
          <span className="execution-console__phase">{phaseLabel}</span>
          {logs.length > 0 && <button type="button" onClick={onClear} className="execution-console__clear">CLEAR</button>}
        </div>
      </div>

      <div className="execution-console__viewport" role="log" aria-live="polite" aria-relevant="additions text">
        {logs.length === 0 ? (
          <div className="execution-console__empty">
            <span>Awaiting agent telemetry</span>
            <span className="execution-console__cursor" aria-hidden="true">_</span>
          </div>
        ) : (
          logs.map((entry) => (
            <div className={`execution-log execution-log--${entry.kind}`} key={entry.id}>
              <span className="execution-log__time">{new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              <span className="execution-log__tag"><b>{iconFor(entry.kind)}</b>{labelFor(entry.kind)}</span>
              <span className="execution-log__text">{entry.text}</span>
              {entry.detail && <span className="execution-log__detail">{entry.detail}</span>}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <div className="execution-console__footer">
        <span>{logs.length.toString().padStart(2, "0")} events</span>
        <span className="execution-console__latest">{latest?.text ?? "No active stream"}</span>
        <span className={`execution-console__dot ${active ? "is-live" : ""}`} aria-label={active ? "Live" : "Idle"} />
      </div>
    </section>
  );
}
