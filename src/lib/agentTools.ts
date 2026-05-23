/**
 * Tool definitions for the autonomous coding agent.
 * All providers (Groq, DeepSeek, Qwen) support these via OpenAI-compatible tool calling.
 *
 * IMPORTANT: stage_file only STAGES changes locally.
 * Nothing is pushed to GitHub until the user explicitly approves.
 */

export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the current content of a file from the GitHub repository. Always read a file before modifying it.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to repo root e.g. src/lib/auth.ts" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and directories at a given path in the repository. Use this to explore structure.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path. Empty string for repo root.", default: "" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for a text pattern across files in the repository to locate relevant code.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Text or function name to search for" },
          path:    { type: "string", description: "Directory to search in. Defaults to root.", default: "" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stage_file",
      description:
        "Stage a file to be pushed to GitHub. Use this to create a new file or overwrite an existing one with your changes. Changes are NOT pushed until the user reviews and approves them.",
      parameters: {
        type: "object",
        properties: {
          path:        { type: "string", description: "File path e.g. src/components/Button.tsx" },
          content:     { type: "string", description: "Complete file content to write" },
          description: { type: "string", description: "Brief explanation of what changed and why" },
        },
        required: ["path", "content", "description"],
      },
    },
  },
];

export interface StagedFile {
  path: string;
  content: string;
  originalContent: string | null; // null = new file
  description: string;
}

export interface ToolCallResult {
  tool_call_id: string;
  content: string;
}