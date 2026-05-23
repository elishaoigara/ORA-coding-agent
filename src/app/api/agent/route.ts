import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/providers";
import { AGENT_TOOLS, type StagedFile, type ToolCallResult } from "@/lib/agentTools";

const GH_BASE = "https://api.github.com";
const MAX_ITERATIONS = 15;

const AGENT_SYSTEM_PROMPT = `You are an autonomous coding agent with access to a GitHub repository.

Your workflow for every task:
1. EXPLORE first — use list_files to understand the structure
2. READ before editing — always read_file before modifying it
3. SEARCH when needed — use search_files to locate relevant code
4. STAGE changes — use stage_file with the complete new file content
5. Be thorough — handle edge cases, follow existing code style, write complete files

Rules:
- Never truncate file content in stage_file — always write the full file
- Read a file before staging a modified version of it
- Stage related files together (e.g. component + its test)
- Explain each staged file clearly in the description field
- When done, summarise what you've done and what files are staged for review`;

function ghHeaders(pat: string) {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// Execute a single tool call against GitHub
async function executeTool(
  name: string,
  args: Record<string, string>,
  repo: string,
  stagedFiles: StagedFile[]
): Promise<string> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) return JSON.stringify({ error: "GITHUB_PAT not configured" });
  const headers = ghHeaders(pat);

  try {
    if (name === "read_file") {
      const res = await fetch(`${GH_BASE}/repos/${repo}/contents/${args.path}`, { headers });
      if (!res.ok) return JSON.stringify({ error: `File not found: ${args.path}` });
      const data = await res.json();
      if (!data.content) return JSON.stringify({ error: "Empty or binary file" });
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      return JSON.stringify({ path: args.path, content, lines: content.split("\n").length });
    }

    if (name === "list_files") {
      const path = args.path ?? "";
      const res = await fetch(`${GH_BASE}/repos/${repo}/contents/${path}`, { headers });
      if (!res.ok) return JSON.stringify({ error: `Cannot list: ${path}` });
      const items = await res.json();
      if (!Array.isArray(items)) return JSON.stringify({ error: "Not a directory" });
      return JSON.stringify(
        items.map((i: { name: string; path: string; type: string; size?: number }) => ({
          name: i.name,
          path: i.path,
          type: i.type,
          size: i.size,
        }))
      );
    }

    if (name === "search_files") {
      // Use GitHub search API (code search within the repo)
      const query = `${args.pattern}+repo:${repo}${args.path ? `+path:${args.path}` : ""}`;
      const res = await fetch(
        `${GH_BASE}/search/code?q=${encodeURIComponent(args.pattern)}&repo:${repo}&per_page=10`,
        { headers: { ...headers, Accept: "application/vnd.github+json" } }
      );
      if (!res.ok) {
        // Fallback: list files and mention the search term
        return JSON.stringify({ message: `Search unavailable. Try list_files to explore the structure.` });
      }
      const data = await res.json();
      return JSON.stringify(
        (data.items ?? []).slice(0, 10).map((i: { path: string; name: string }) => ({
          path: i.path,
          name: i.name,
        }))
      );
    }

    if (name === "stage_file") {
      // Read original content if file exists (for diff display)
      let originalContent: string | null = null;
      const existing = await fetch(`${GH_BASE}/repos/${repo}/contents/${args.path}`, { headers });
      if (existing.ok) {
        const data = await existing.json();
        if (data.content) {
          originalContent = Buffer.from(data.content, "base64").toString("utf-8");
        }
      }

      // Add/replace in staged files
      const existingIndex = stagedFiles.findIndex((f) => f.path === args.path);
      const staged: StagedFile = {
        path: args.path,
        content: args.content,
        originalContent,
        description: args.description,
      };

      if (existingIndex >= 0) {
        stagedFiles[existingIndex] = staged;
      } else {
        stagedFiles.push(staged);
      }

      return JSON.stringify({
        success: true,
        path: args.path,
        status: originalContent !== null ? "modified" : "new file",
        lines: args.content.split("\n").length,
      });
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message });
  }
}

export async function POST(req: NextRequest) {
  let body: {
    task: string;
    repo: string;
    provider?: string;
    model?: string;
    messages?: { role: string; content: string }[];
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { task, repo, provider: providerId, model, messages: history = [] } = body;

  if (!task || !repo) {
    return NextResponse.json({ error: "Missing task or repo" }, { status: 400 });
  }

  let provider;
  try {
    provider = getProvider(providerId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // Use deepseek-chat or qwen3-coder-plus for agentic tasks — not the reasoner
  const agentModel =
    model === "deepseek-reasoner" ? "deepseek-chat" : model || provider.defaultModel;

  const stagedFiles: StagedFile[] = [];

  // SSE stream setup
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(type: string, data: unknown) {
        const payload =
          typeof data === "string"
            ? { type, text: data }
            : { type, ...(data as Record<string, unknown>) };
        const line = `data: ${JSON.stringify(payload)}\n\n`;
        controller.enqueue(encoder.encode(line));
      }

      const messages: { role: string; content: unknown }[] = [
        ...history,
        { role: "user", content: task },
      ];

      send("progress", { text: `Starting agent on **${repo}**…` });

      let iterations = 0;

      // ── Agentic loop ─────────────────────────────────────────────────────────
      while (iterations < MAX_ITERATIONS) {
        iterations++;

        let response;
        try {
          const res = await fetch(`${provider.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${provider.apiKey}`,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: agentModel,
              messages: [{ role: "system", content: AGENT_SYSTEM_PROMPT }, ...messages],
              tools: AGENT_TOOLS,
              tool_choice: "auto",
              max_tokens: 4096,
              temperature: 0.2,
              stream: false, // tool call phase is non-streaming
            }),
          });

          if (!res.ok) {
            const err = await res.text();
            send("error", { text: `Provider error: ${err}` });
            break;
          }

          response = await res.json();
        } catch (e) {
          send("error", { text: `Network error: ${(e as Error).message}` });
          break;
        }

        const choice = response.choices?.[0];
        if (!choice) break;

        const assistantMessage = choice.message;
        messages.push(assistantMessage);

        // ── Tool calls ───────────────────────────────────────────────────────
        if (choice.finish_reason === "tool_calls" && assistantMessage.tool_calls?.length) {
          const toolResults: ToolCallResult[] = [];

          for (const toolCall of assistantMessage.tool_calls) {
            const name = toolCall.function.name;
            let args: Record<string, string> = {};
            try {
              args = JSON.parse(toolCall.function.arguments);
            } catch { /* malformed args */ }

            // Stream a human-readable progress update
            const progressText: Record<string, string> = {
              read_file:    `Reading \`${args.path}\`…`,
              list_files:   `Exploring \`${args.path || "/"}\`…`,
              search_files: `Searching for \`${args.pattern}\`…`,
              stage_file:   `Staging \`${args.path}\`…`,
            };
            send("tool_call", { text: progressText[name] ?? `Calling ${name}…`, tool: name, args });

            const result = await executeTool(name, args, repo, stagedFiles);
            toolResults.push({ tool_call_id: toolCall.id, content: result });
          }

          // Add tool results back into messages
          messages.push({
            role: "tool",
            content: toolResults.map((r) => ({
              type: "tool_result",
              tool_use_id: r.tool_call_id,
              content: r.content,
            })),
          });

          // For providers that use a flat array format for tool results
          // (OpenAI compatible format):
          for (const r of toolResults) {
            messages[messages.length - 1] = {
              role: "tool",
              content: r.content,
              // @ts-ignore
              tool_call_id: r.tool_call_id,
            } as never;
            if (toolResults.length > 1) {
              // Multiple tool results need separate messages in OpenAI format
              break;
            }
          }

          // If multiple tool calls, add each result as separate tool message
          if (toolResults.length > 1) {
            messages.pop(); // remove the one we just added
            for (const r of toolResults) {
              messages.push({
                role: "tool",
                // @ts-ignore
                tool_call_id: r.tool_call_id,
                content: r.content,
              });
            }
          }

          continue; // loop back for next LLM call
        }

        // ── Final response — stream it ───────────────────────────────────────
        if (choice.finish_reason === "stop" || assistantMessage.content) {
          const finalText = assistantMessage.content ?? "";

          // Stream the final text token by token (simulate streaming from non-stream response)
          send("text_start", {});
          const words = finalText.split(" ");
          for (let i = 0; i < words.length; i += 5) {
            send("text", { text: words.slice(i, i + 5).join(" ") + " " });
          }
          send("text_end", {});
          break;
        }

        break;
      }

      // ── Send staged files ────────────────────────────────────────────────
      if (stagedFiles.length > 0) {
        send("staged", { files: stagedFiles });
      }

      send("done", { iterations, stagedCount: stagedFiles.length });
      controller.close();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}