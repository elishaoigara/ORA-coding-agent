import type { BenchmarkSample } from "@/components/BenchmarkDashboard";

const WORKFLOW_SUFFIX = "\n\nExecution contract: inspect repository evidence first; state assumptions; make the smallest coherent changes; preserve existing behavior; run the project’s lint, typecheck, tests, and build checks; summarize files changed, verification results, and any remaining risks.";

export function optimizeWorkflowBrief(brief: string): string {
  const normalized = brief.trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  if (/execution contract: inspect repository evidence first/i.test(normalized)) return normalized;
  return `${normalized}${WORKFLOW_SUFFIX}`;
}

export function benchmarkCsv(samples: BenchmarkSample[]): string {
  const header = ["id", "startedAt", "kind", "status", "latencyMs", "provider", "model", "promptTokens", "completionTokens", "totalTokens", "estimatedCostUsd", "toolCalls", "iterations"];
  const rows = samples.map((sample) => [sample.id, new Date(sample.startedAt).toISOString(), sample.kind, sample.status, Math.round(sample.latencyMs), sample.provider, sample.model, sample.usage?.promptTokens ?? "", sample.usage?.completionTokens ?? "", sample.usage?.totalTokens ?? "", sample.usage?.estimatedCostUsd ?? "", sample.toolCalls ?? "", sample.iterations ?? ""]);
  return [header, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function benchmarkJson(samples: BenchmarkSample[]): string {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), owner: "Lambert", samples }, null, 2);
}
