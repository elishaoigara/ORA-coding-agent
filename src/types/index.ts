export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
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

// Persisted GitHub context — saved per conversation
export interface GitHubContext {
  repo: string;          // e.g. "elishaoigara/ORA"
  files: InjectedFile[]; // injected files
  pinnedAt: number;      // timestamp
}
