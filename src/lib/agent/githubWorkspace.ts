import type { StagedFile } from "./types";

const GITHUB_API = "https://api.github.com";
const MAX_FILE_BYTES = 2_000_000;

type ToolArguments = Record<string, string | undefined>;

type GitHubContent = {
  content?: string;
  encoding?: string;
  path?: string;
  sha?: string;
  size?: number;
  type?: string;
};

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export function normalizeRepositoryPath(input: string | undefined): string {
  const path = (input ?? "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");

  if (path.includes("\0") || path.split("/").some((part) => part === "..")) {
    throw new Error("Invalid repository path");
  }

  return path;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function hasTruncationPlaceholder(content: string): boolean {
  return content.split("\n").some((line) => {
    const value = line.trim().toLowerCase();
    return (
      value === "..." ||
      value === "…" ||
      /^\/\/\s*(?:\.\.\.|…)(?:\s+rest.*)?$/.test(value) ||
      /^#\s*(?:\.\.\.|…)(?:\s+rest.*)?$/.test(value) ||
      /^\/\*\s*(?:\.\.\.|…)\s*\*\/$/.test(value)
    );
  });
}

export class GitHubWorkspace {
  private readonly requestHeaders: Record<string, string> | null;

  constructor(
    private readonly repo: string,
    private readonly branch: string | undefined,
    private readonly stagedFiles: StagedFile[],
    token = process.env.GITHUB_PAT
  ) {
    this.requestHeaders = token ? headers(token) : null;
  }

  async execute(name: string, args: ToolArguments): Promise<string> {
    if (!this.requestHeaders) {
      return this.result({ error: "GITHUB_PAT is not configured" });
    }

    try {
      switch (name) {
        case "read_file":
          return await this.readFile(args.path);
        case "list_files":
          return await this.listFiles(args.path);
        case "search_files":
          return await this.searchFiles(args.pattern, args.path);
        case "stage_file":
          return await this.stageFile(args.path, args.content, args.description);
        case "delete_file":
          return await this.deleteFile(args.path, args.reason);
        default:
          return this.result({ error: `Unknown tool: ${name}` });
      }
    } catch (error) {
      return this.result({
        error: error instanceof Error ? error.message : "Tool execution failed",
      });
    }
  }

  private contentUrl(path: string): string {
    const suffix = path ? `/${encodePath(path)}` : "";
    const url = new URL(`${GITHUB_API}/repos/${this.repo}/contents${suffix}`);
    if (this.branch) url.searchParams.set("ref", this.branch);
    return url.toString();
  }

  private async fetchContent(path: string): Promise<Response> {
    return fetch(this.contentUrl(path), { headers: this.requestHeaders! });
  }

  private async readFile(rawPath: string | undefined): Promise<string> {
    const path = normalizeRepositoryPath(rawPath);
    if (!path) return this.result({ error: "A file path is required" });

    const staged = this.stagedFiles.find((file) => file.path === path);
    if (staged) {
      if (staged.content === null) {
        return this.result({ error: `${path} is currently staged for deletion` });
      }
      return this.result({
        path,
        content: staged.content,
        lines: staged.content.split("\n").length,
        source: "staged",
      });
    }

    const response = await this.fetchContent(path);
    if (!response.ok) {
      return this.result({ error: `Cannot read ${path} (GitHub ${response.status})` });
    }

    const file = (await response.json()) as GitHubContent;
    if (file.type !== "file" || !file.content) {
      return this.result({ error: `${path} is empty, binary, or not a file` });
    }
    if ((file.size ?? 0) > MAX_FILE_BYTES) {
      return this.result({ error: `${path} exceeds the 2 MB agent file limit` });
    }

    const content = Buffer.from(file.content, "base64").toString("utf-8");
    return this.result({ path, content, lines: content.split("\n").length });
  }

  private async listFiles(rawPath: string | undefined): Promise<string> {
    const path = normalizeRepositoryPath(rawPath);
    const response = await this.fetchContent(path);
    if (!response.ok) {
      return this.result({
        error: `Cannot list ${path || "repository root"} (GitHub ${response.status})`,
      });
    }

    const items = (await response.json()) as GitHubContent[] | GitHubContent;
    if (!Array.isArray(items)) {
      return this.result({ error: `${path || "repository root"} is not a directory` });
    }

    return this.result(
      items.map((item) => ({
        name: item.path?.split("/").pop() ?? "",
        path: item.path ?? "",
        type: item.type ?? "unknown",
        ...(item.size ? { size: item.size } : {}),
      }))
    );
  }

  private async searchFiles(
    rawPattern: string | undefined,
    rawPath: string | undefined
  ): Promise<string> {
    const pattern = rawPattern?.trim();
    if (!pattern) return this.result({ error: "A search pattern is required" });

    const path = normalizeRepositoryPath(rawPath);
    const qualifiers = [`repo:${this.repo}`];
    if (path) qualifiers.push(`path:${path}`);
    const query = encodeURIComponent(`${pattern} ${qualifiers.join(" ")}`);
    const response = await fetch(`${GITHUB_API}/search/code?q=${query}&per_page=20`, {
      headers: this.requestHeaders!,
    });

    if (!response.ok) {
      return this.result({
        error: `GitHub code search failed (${response.status})`,
        hint: "Use list_files and read_file to continue exploring.",
      });
    }

    const data = (await response.json()) as {
      items?: Array<{ path: string; name: string }>;
    };
    const results = (data.items ?? []).map((item) => ({
      path: item.path,
      name: item.name,
    }));
    return this.result({ results, count: results.length });
  }

  private async stageFile(
    rawPath: string | undefined,
    content: string | undefined,
    description: string | undefined
  ): Promise<string> {
    const path = normalizeRepositoryPath(rawPath);
    if (!path) return this.result({ error: "A file path is required" });
    if (content === undefined) return this.result({ error: "Complete file content is required" });
    if (Buffer.byteLength(content, "utf-8") > MAX_FILE_BYTES) {
      return this.result({ error: `${path} exceeds the 2 MB agent file limit` });
    }
    if (hasTruncationPlaceholder(content)) {
      return this.result({
        error: "Truncated content detected. stage_file requires the complete file.",
      });
    }

    const previous = this.stagedFiles.find((file) => file.path === path);
    let originalContent = previous?.originalContent ?? null;
    let sha = previous?.sha;

    if (!previous) {
      const response = await this.fetchContent(path);
      if (response.ok) {
        const file = (await response.json()) as GitHubContent;
        if (file.type !== "file" || !file.content) {
          return this.result({ error: `${path} is not a writable text file` });
        }
        if ((file.size ?? 0) > MAX_FILE_BYTES) {
          return this.result({ error: `${path} exceeds the 2 MB agent file limit` });
        }
        originalContent = Buffer.from(file.content, "base64").toString("utf-8");
        sha = file.sha;
      } else if (response.status !== 404) {
        return this.result({
          error: `Could not inspect ${path} before staging (GitHub ${response.status})`,
        });
      }
    }

    const staged: StagedFile = {
      path,
      content,
      originalContent,
      description: description?.trim() || `Update ${path}`,
      action: originalContent === null ? "create" : "modify",
      sha,
    };
    this.upsert(staged);

    return this.result({
      success: true,
      path,
      status: staged.action === "create" ? "created" : "modified",
      lines: content.split("\n").length,
      changed: content !== originalContent,
    });
  }

  private async deleteFile(
    rawPath: string | undefined,
    reason: string | undefined
  ): Promise<string> {
    const path = normalizeRepositoryPath(rawPath);
    if (!path) return this.result({ error: "A file path is required" });

    const previous = this.stagedFiles.find((file) => file.path === path);
    let originalContent = previous?.originalContent ?? null;
    let sha = previous?.sha;

    if (!previous) {
      const response = await this.fetchContent(path);
      if (!response.ok) {
        return this.result({ error: `Cannot delete ${path} (GitHub ${response.status})` });
      }
      const file = (await response.json()) as GitHubContent;
      if (file.type !== "file") return this.result({ error: `${path} is not a file` });
      originalContent = file.content
        ? Buffer.from(file.content, "base64").toString("utf-8")
        : null;
      sha = file.sha;
    }

    this.upsert({
      path,
      content: null,
      originalContent,
      description: reason?.trim() || `Delete ${path}`,
      action: "delete",
      sha,
    });

    return this.result({ success: true, path, status: "deleted" });
  }

  private upsert(file: StagedFile): void {
    const index = this.stagedFiles.findIndex((candidate) => candidate.path === file.path);
    if (index === -1) this.stagedFiles.push(file);
    else this.stagedFiles[index] = file;
  }

  private result(value: unknown): string {
    return JSON.stringify(value);
  }
}
