import type { Tool } from "@/types";

export type { StagedFile } from "@/lib/agent/types";

const READ_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and directories at a repository-relative path. Use an empty string for the repository root.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Repository-relative directory path, or an empty string for root" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file from the repository or the latest staged version of that file. Maximum size: 2 MB.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Repository-relative file path, such as src/app/page.tsx" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search repository code for text. GitHub code search may only search the default branch; use list_files and read_file as a fallback.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Text to search for" },
          path: { type: "string", description: "Optional repository-relative directory filter" },
        },
        required: ["pattern"],
      },
    },
  },
];

const WRITE_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "stage_file",
      description: "Create or replace a staged text file. Always provide the complete final file content; patches and omitted sections are rejected.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Repository-relative file path" },
          content: { type: "string", description: "Complete final UTF-8 file content" },
          description: { type: "string", description: "Concise summary of this file's change" },
        },
        required: ["path", "content", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Stage an existing repository file for deletion.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Repository-relative file path" },
          reason: { type: "string", description: "Why this file should be deleted" },
        },
        required: ["path", "reason"],
      },
    },
  },
];

export function getAgentTools(phase: "plan" | "execute"): Tool[] {
  return phase === "plan" ? READ_TOOLS : [...READ_TOOLS, ...WRITE_TOOLS];
}
