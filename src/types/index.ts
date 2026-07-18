// ── Message types ─────────────────────────────────────────────────────────────
import type { TokenUsage } from "@/lib/tokenCost";

export interface Message {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  usage?: TokenUsage;
}

// ── GitHub file injection ────────────────────────────────────────────────────
export interface InjectedFile {
  path: string;
  content: string;
}

// ── GitHub context saved in conversations ─────────────────────────────────────
export interface GitHubContext {
  repo: string;
  files: InjectedFile[];
  pinnedAt: number;
}

// ── Provider types ────────────────────────────────────────────────────────────
export interface ModelItem {
  id: string;
  label: string;
  contextWindow?: number;
}

export interface PublicProvider {
  id: string;
  name: string;
  configured: boolean;
  defaultModel: string;
  models: ModelItem[];
}

// ── Conversation ──────────────────────────────────────────────────────────────
export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  provider?: string;
  model?: string;
  project?: string;
  systemPrompt?: string;
  githubContext?: GitHubContext;
  createdAt: number;
  updatedAt: number;
}

// ── Tool types (OpenAI-compatible function calling) ───────────────────────────
export interface ToolFunction {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export interface Tool {
  type: "function";
  function: ToolFunction;
}
