"use client";

import { useMemo } from "react";
import { formatCost, formatTokens, type TokenUsage } from "@/lib/tokenCost";

export interface BenchmarkSample {
  id: string;
  kind: "chat" | "agent";
  startedAt: number;
  latencyMs: number;
  provider: string;
  model: string;
  usage?: TokenUsage | null;
  toolCalls?: number;
  iterations?: number;
  status: "complete" | "error" | "stopped";
}

interface Props {
  open: boolean;
  samples: BenchmarkSample[];
  live: boolean;
  onClose: () => void;
  onClear: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onShare: () => void;
}

function formatLatency(value: number) {
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

export default function BenchmarkDashboard({ open, samples, live, onClose, onClear, onExportJson, onExportCsv, onShare }: Props) {
  const summary = useMemo(() => {
    const completed = samples.filter((sample) => sample.status === "complete");
    const usage = completed.reduce((total, sample) => total + (sample.usage?.totalTokens ?? 0), 0);
    const cost = completed.reduce((total, sample) => total + (sample.usage?.estimatedCostUsd ?? 0), 0);
    const averageLatency = completed.length ? completed.reduce((total, sample) => total + sample.latencyMs, 0) / completed.length : 0;
    const fastest = completed.length ? Math.min(...completed.map((sample) => sample.latencyMs)) : 0;
    return { completed: completed.length, usage, cost, averageLatency, fastest };
  }, [samples]);

  if (!open) return null;

  return (
    <div className="ora-benchmark-overlay" role="presentation" onMouseDown={onClose}>
      <section className="ora-benchmark-panel" role="dialog" aria-modal="true" aria-labelledby="benchmark-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="ora-benchmark-panel__header"><div><div className="ora-benchmark-panel__eyebrow">ORA // PERFORMANCE TELEMETRY</div><h2 id="benchmark-title">Benchmark dashboard</h2><p>Live response and resource signals for Lambert’s workspace.</p></div><div className="ora-benchmark-panel__actions"><span className={`ora-benchmark-live ${live ? "is-live" : ""}`}><i />{live ? "LIVE" : "IDLE"}</span><button type="button" className="touch-target" onClick={onClose} aria-label="Close benchmark dashboard">×</button></div></header>
        <div className="ora-benchmark-kpis"><article><span>Runs</span><strong>{summary.completed}</strong><small>completed samples</small></article><article><span>Average latency</span><strong>{summary.averageLatency ? formatLatency(summary.averageLatency) : "—"}</strong><small>request to completion</small></article><article><span>Tokens</span><strong>{formatTokens(summary.usage)}</strong><small>recorded output + input</small></article><article><span>Est. cost</span><strong>{formatCost(summary.cost)}</strong><small>from provider usage</small></article></div>
        <div className="ora-benchmark-chart" aria-label="Latency history"><div className="ora-benchmark-chart__header"><span>Latency history</span><small>fastest {summary.fastest ? formatLatency(summary.fastest) : "—"}</small></div><div className="ora-benchmark-bars">{samples.slice(-16).map((sample) => { const max = Math.max(...samples.slice(-16).map((item) => item.latencyMs), 1); return <div key={sample.id} className="ora-benchmark-bar" title={`${sample.kind} · ${formatLatency(sample.latencyMs)}`}><span style={{ height: `${Math.max(8, (sample.latencyMs / max) * 100)}%` }} /><small>{Math.round(sample.latencyMs / 100) / 10}s</small></div>; })}{samples.length === 0 && <p>No benchmark runs yet. Send a chat or launch an autonomous workflow to start collecting telemetry.</p>}</div></div>
        <div className="ora-benchmark-table"><div className="ora-benchmark-table__header"><span>Recent runs</span><div className="ora-benchmark-report-actions"><button type="button" onClick={onExportJson} disabled={samples.length === 0}>JSON</button><button type="button" onClick={onExportCsv} disabled={samples.length === 0}>CSV</button><button type="button" onClick={onShare} disabled={samples.length === 0}>Share</button><button type="button" onClick={onClear} disabled={samples.length === 0}>Clear</button></div></div>{samples.slice(-8).reverse().map((sample) => <div key={sample.id} className="ora-benchmark-row"><span className={`ora-benchmark-status ora-benchmark-status--${sample.status}`} /><strong>{sample.kind === "agent" ? "Agent workflow" : "Chat response"}</strong><span>{sample.provider || "—"} · {sample.model || "auto"}</span><span>{formatLatency(sample.latencyMs)}</span><span>{sample.usage ? `${formatTokens(sample.usage.totalTokens)} · ${formatCost(sample.usage.estimatedCostUsd)}` : sample.toolCalls ? `${sample.toolCalls} tools · ${sample.iterations ?? 0} iters` : "No usage"}</span></div>)}</div>
        <footer className="ora-benchmark-panel__footer"><span>Metrics stay local to this device.</span><span>Use <kbd>Ctrl</kbd><kbd>B</kbd> to open</span></footer>
      </section>
    </div>
  );
}
