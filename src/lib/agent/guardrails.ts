import type { AgentPlan, AgentPlanChange, FileAction } from "@/lib/agent/types";

const DEFAULT_MAX_ITERATIONS = 18;
const DEFAULT_MAX_TOOL_CALLS = 48;
const DEFAULT_MAX_CHANGES = 32;
const MAX_PATH_LENGTH = 300;

export interface AgentBudget {
  maxIterations: number;
  maxToolCalls: number;
  maxChanges: number;
}

export interface TaskProfile {
  kind: "feature" | "bugfix" | "refactor" | "test" | "documentation" | "investigation" | "mixed";
  risk: "low" | "medium" | "high";
  requiresVerification: boolean;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  normalized: AgentPlan;
}

function boundedEnvInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function getAgentBudget(): AgentBudget {
  return {
    maxIterations: boundedEnvInt("AGENT_MAX_ITERATIONS", DEFAULT_MAX_ITERATIONS, 4, 40),
    maxToolCalls: boundedEnvInt("AGENT_MAX_TOOL_CALLS", DEFAULT_MAX_TOOL_CALLS, 8, 120),
    maxChanges: boundedEnvInt("AGENT_MAX_CHANGES", DEFAULT_MAX_CHANGES, 1, 80),
  };
}

export function createRunId(): string {
  return `ora_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function profileTask(task: string): TaskProfile {
  const value = task.toLowerCase();
  const has = (...terms: string[]) => terms.some((term) => value.includes(term));
  const kind: TaskProfile["kind"] = has("investigate", "explain", "understand", "find out")
    ? "investigation"
    : has("test", "coverage", "spec")
      ? "test"
      : has("docs", "documentation", "readme")
        ? "documentation"
        : has("refactor", "restructure", "rewrite", "clean up")
          ? "refactor"
          : has("fix", "bug", "error", "broken", "regression")
            ? "bugfix"
            : has("add", "build", "create", "implement")
              ? "feature"
              : "mixed";
  const risk = has("auth", "security", "secret", "credential", "payment", "delete", "production")
    ? "high"
    : has("database", "migration", "api", "dependency", "config", "deploy")
      ? "medium"
      : "low";
  return { kind, risk, requiresVerification: kind !== "investigation" || risk !== "low" };
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\.\//, "");
}

function isSafePath(path: string): boolean {
  if (!path || path.length > MAX_PATH_LENGTH) return false;
  if (path.startsWith("/") || path.includes("..") || path.includes("\\")) return false;
  if (path.startsWith(".git/") || path === ".git" || path.startsWith("node_modules/")) return false;
  return true;
}

export function validatePlan(plan: AgentPlan, budget = getAgentBudget()): PlanValidationResult {
  const errors: string[] = [];
  const changes = Array.isArray(plan?.changes) ? plan.changes : [];
  if (!plan?.summary?.trim()) errors.push("Plan summary is required.");
  if (!plan?.approach?.trim()) errors.push("Plan approach is required.");
  if (changes.length === 0) errors.push("Plan must contain at least one file change.");
  if (changes.length > budget.maxChanges) errors.push(`Plan exceeds the ${budget.maxChanges}-file change limit.`);

  const seen = new Set<string>();
  const normalizedChanges: AgentPlanChange[] = [];
  for (const change of changes) {
    const path = normalizePath(String(change?.path ?? ""));
    const action = String(change?.action ?? "") as FileAction;
    if (!isSafePath(path)) errors.push(`Unsafe or invalid repository path: ${path || "(empty)"}`);
    if (seen.has(path)) errors.push(`Duplicate plan path: ${path}`);
    seen.add(path);
    if (!["create", "modify", "delete"].includes(action)) errors.push(`Invalid action for ${path}: ${action}`);
    if (!String(change?.reason ?? "").trim()) errors.push(`Missing reason for ${path}.`);
    if (!String(change?.details ?? "").trim()) errors.push(`Missing implementation details for ${path}.`);
    normalizedChanges.push({
      action,
      path,
      reason: String(change?.reason ?? "").trim(),
      details: String(change?.details ?? "").trim(),
    });
  }
  return {
    valid: errors.length === 0,
    errors,
    normalized: {
      summary: String(plan?.summary ?? "").trim(),
      approach: String(plan?.approach ?? "").trim(),
      changes: normalizedChanges,
    },
  };
}

export function isApprovedPath(plan: AgentPlan | undefined, path: string, action: FileAction): boolean {
  const normalized = normalizePath(path);
  const approved = plan?.changes.find((change) => normalizePath(change.path) === normalized);
  return Boolean(approved && approved.action === action);
}

export function getMissingPlanChanges(plan: AgentPlan | undefined, stagedPaths: Set<string>): AgentPlanChange[] {
  return (plan?.changes ?? []).filter((change) => !stagedPaths.has(normalizePath(change.path)));
}

export function summarizeBudget(budget: AgentBudget): string {
  return `${budget.maxIterations} iterations, ${budget.maxToolCalls} tool calls, ${budget.maxChanges} file changes`;
}
