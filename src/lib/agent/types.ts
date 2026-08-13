import type { Tool } from "@/types";

export type AgentPhase = "plan" | "execute";
export type FileAction = "create" | "modify" | "delete";

export interface AgentPlanChange {
  action: FileAction;
  path: string;
  reason: string;
  details: string;
}

export interface AgentPlan {
  summary: string;
  approach: string;
  changes: AgentPlanChange[];
}

export interface StagedFile {
  path: string;
  content: string | null;
  originalContent: string | null;
  description: string;
  action: FileAction;
  sha?: string;
}

export interface AgentToolCall {
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: AgentToolCall[];
  tool_call_id?: string;
}

export interface AgentCompletionChoice {
  finish_reason?: string | null;
  message: AgentMessage;
}

export interface AgentCompletion {
  choices?: AgentCompletionChoice[];
}

export interface AgentCompletionRequest {
  model: string;
  messages: AgentMessage[];
  tools: Tool[];
  forceText?: boolean;
}

export interface AgentContinuation {
  messages: AgentMessage[];
  stagedFiles: StagedFile[];
  progress?: string;
}
