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
  provider: string;        // e.g. "groq" | "deepseek" | "qwen"
  injectedFiles?: InjectedFile[];
}

// Shape returned by /api/provider
export interface PublicProvider {
  id: string;
  name: string;
  models: { id: string; label: string }[];
  defaultModel: string;
  configured: boolean;     // false = API key not set, show as disabled in UI
}
