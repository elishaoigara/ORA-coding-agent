import { agentPlanSchema } from "@/lib/validation";
import type {
  AgentMessage,
  AgentPlan,
  AgentPlanChange,
  StagedFile,
} from "./types";

const LEAKED_TOOL_CALL = /<\|?\s*[\w.-]*\|?\s*(?:tool_calls|invoke|function_calls?)\b/i;

export function looksLikeLeakedToolCall(text: string): boolean {
  return LEAKED_TOOL_CALL.test(text);
}

export function getMissingChanges(
  changes: AgentPlanChange[] | undefined,
  stagedFiles: StagedFile[]
): AgentPlanChange[] {
  if (!changes) return [];
  const stagedPaths = new Set(stagedFiles.map((file) => file.path));
  return changes.filter((change) => !stagedPaths.has(change.path.replace(/^\/+/, "")));
}

export function parseToolArguments(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        typeof item === "string" ? item : JSON.stringify(item),
      ])
    );
  } catch {
    return {};
  }
}

export function parsePlanResponse(text: string): {
  narrative: string;
  plan?: AgentPlan;
  error?: string;
} {
  const match = text.match(/<PLAN>([\s\S]*?)<\/PLAN>/i);
  const narrative = text.replace(/<PLAN>[\s\S]*?<\/PLAN>/gi, "").trim();
  if (!match) return { narrative, error: "The model did not return a <PLAN> block." };

  try {
    const result = agentPlanSchema.safeParse(JSON.parse(match[1].trim()));
    if (!result.success) {
      return {
        narrative,
        error: `The plan is invalid: ${result.error.issues[0]?.message ?? "validation failed"}`,
      };
    }
    return { narrative, plan: result.data };
  } catch {
    return { narrative, error: "The model returned invalid plan JSON." };
  }
}

export function pruneToolMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => {
    if (message.role !== "tool" || typeof message.content !== "string") return message;

    try {
      const parsed = JSON.parse(message.content) as Record<string, unknown>;
      if (typeof parsed.content !== "string" || parsed.content.length <= 500) {
        return message;
      }
      return {
        ...message,
        content: JSON.stringify({
          ...parsed,
          content: `[pruned - ${String(parsed.lines ?? "?")} lines]`,
        }),
      };
    } catch {
      return message;
    }
  });
}

export function upsertStagedFiles(
  current: StagedFile[],
  incoming: StagedFile[]
): StagedFile[] {
  const byPath = new Map(current.map((file) => [file.path, file]));
  for (const file of incoming) byPath.set(file.path, file);
  return Array.from(byPath.values());
}
