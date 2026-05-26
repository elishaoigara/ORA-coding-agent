import type { TokenUsage } from "@/lib/tokenCost";

export interface Message {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  usage?: TokenUsage;
}

export interface GitHubFile {
  name: string;
  path: string;
  type: "file" | "dir";
  sha: string;
}

export interface GitHubRepo {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  default_branch: string;
}

export interface InjectedFile {
  path: string;
  content: string;
  repo: string;
}

export interface ChatRequest {
  messages: Message[];
  model: string;
  provider: string;
  injectedFiles?: InjectedFile[];
}

export interface PublicProvider {
  id: string;
  name: string;
  models: { id: string; label: string }[];
  defaultModel: string;
  configured: boolean;
}

export interface GitHubContext {
  repo: string;
  files: InjectedFile[];
  pinnedAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  project: string;
  messages: Message[];
  provider: string;
  model: string;
  githubContext?: GitHubContext;
  systemPrompt?: string;       // ← NEW: per-conversation custom system prompt
  createdAt: number;
  updatedAt: number;
}