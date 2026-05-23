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
  injectedFiles?: InjectedFile[];
}
