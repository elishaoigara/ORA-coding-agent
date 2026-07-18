import type { Tool } from "@/types";

export interface StagedFile {
  path: string;
  content: string | null; // null = deletion
  originalContent?: string | null;
  description: string;
  action?: "create" | "modify" | "delete"; // delete requires special handling
  sha?: string; // current file SHA for deletions
}

// Tools available to the agent for reading and searching the codebase
const READ_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and directories in a given path. Use / for root. Returns dir/file listing with size hints.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path (e.g. /src, /src/components)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the content of a file given its path. Returns the full file contents as text. Max 2MB.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Full file path from repo root (e.g. /src/app/page.tsx)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search across files using a regex or text pattern. Returns matching file paths and line numbers.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Text or regex pattern to search for" },
          path: { type: "string", description: "Optional: limit search to a specific directory" },
        },
        required: ["pattern"],
      },
    },
  },
];

// Tools that write/modify files — only available in execution phase
const EXECUTE_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "stage_file",
      description: "Stage a file for commit. If file exists, it creates a modification diff. If new, creates the file. Provide the FULL intended content of the file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Full file path from repo root (e.g. /src/app/page.tsx)" },
          content: { type: "string", description: "The COMPLETE new file content — never truncate or use placeholders" },
          description: { type: "string", description: "Short summary of changes made" },
        },
        required: ["path", "content", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Stage a file for deletion from the repository. Requires the file's current SHA.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Full file path from repo root to delete" },
          reason: { type: "string", description: "Why this file should be deleted" },
        },
        required: ["path", "reason"],
      },
    },
  },
];

export function getAgentTools(phase: "plan" | "execute"): Tool[] {
  if (phase === "plan") return READ_TOOLS;
  return [...READ_TOOLS, ...EXECUTE_TOOLS];
}
