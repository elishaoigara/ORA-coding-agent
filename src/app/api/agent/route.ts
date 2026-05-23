import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/providers";
import { AGENT_TOOLS, type StagedFile } from "@/lib/agentTools";

export const maxDuration = 60;

const GH_BASE = "https://api.github.com";
const MAX_ITERATIONS = 12;

const AGENT_SYSTEM_PROMPT = `You are an autonomous coding agent with access to a GitHub repository via tools.

Your workflow for every task:
1. EXPLORE first — use list_files to understand the project structure
2. READ before editing — always call read_file before modifying any file
3. SEARCH when needed — use search_files to locate relevant code
4. STAGE your changes — call stage_file with the COMPLETE new file content (never truncate)
5. Be thorough — follow existing code style, handle edge cases, write complete files

Important rules:
- Always write the FULL file content in stage_file, never use "..." or placeholders
- Read a file first, then stage your modified version
- Stage all related files (e.g. component + its types + its test)
- After staging everything, write a clear summary of what you changed and why`;

function ghHeaders(pat: string) {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function executeTool(
  name: string,
  args: Record<string, string>,
  repo: string,
  stagedFiles: StagedFile[]
): Promise<string> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) return JSON.stringify({ error: "GITHUB_PAT not set" });
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
      if (!res.ok) return JSON.stringify({ error: `Cannot list: ${path || "root"}` });
      const items = await res.json();
      if (!Array.isArray(items)) return JSON.stringify({ error: "Not a directory" });
      return JSON.stringify(
        items.map((i: { name: string; path: string; type: string; size?: number }) => ({
          name: i.name,
          path: i.path,
          type: i.type,
          ...(i.size ? { size: i.size } : {}),
        }))
      );
    }

    if (name === "search_files") {
      const q = encodeURIComponent(`${args.pattern} repo:${repo}`);
      const res = await fetch(`${GH_BASE}/search/code?q=${q}&per_page=10`, {
        headers: { ...headers, Accept: "application/vnd.github+json" },
      });
      if (!res.ok) {
        return JSON.stringify({
          note: "Search unavailable. Use list_files to explore and read_file to inspect files.",
          pattern: args.pattern,
        });
      }
      const data = await res.json();
      const results = (data.items ?? [])
        .slice(0, 10)
        .map((i: { path: string; name: string }) => ({ path: i.path, name: i.name }));
      return JSON.stringify({ results, count: results.length });
    }

    if (name === "stage_file") {
      let originalContent: string | null = null;
      const existing = await fetch(`${GH_BASE}/repos/${repo}/contents/${args.path}`, { headers });
      if (existing.ok) {
        const data = await existing.json();
        if (data.content) {
          originalContent = Buffer.from(data.content, "base64").toString("utf-8");
        }
      }

      const staged: StagedFile = {
        path: args.path,
        content: args.content,
        originalContent,
        description: args.description,
      };

      const existingIndex = stagedFiles.findIndex((f) => f.path === args.path);
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
        message: "Staged. Will NOT be pushed until user approves.",
      });
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message });
  }
}

async function streamText(
  text: string,
  send: (type: string, payload?: Record<string, unknown>) => void
) {
  const words = text.split(" ");
  const chunkSize = 8;
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk =
      words.slice(i, i + chunkSize).join(" ") +
      (i + chunkSize < words.length ? " " : "");
    send("text", { text: chunk });
    await new Promise((r) => setTimeout(r, 10));
  }
}

export async function POST(req: NextRequest) {
  let body: { task: string; repo: string; provider?: string; model?: string };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { task, repo, provider: providerId, model } = body;
  if (!task || !repo) {
    return NextResponse.json({ error: "Missing task or repo" }, { status: 400 });
  }

  let provider;
  try {
    provider = getProvider(providerId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // DeepSeek Reasoner doesn't support tool calling — swap to V3
  const agentModel =
    model === "deepseek-reasoner" ? "deepseek-chat" : model || provider.defaultModel;

  const stagedFiles: StagedFile[] = [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(type: string, payload: Record<string, unknown> = {}) {
        const data = JSON.stringify({ type, ...payload });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }

      send("progress", {
        text: `Agent starting on **${repo}** using ${provider.name} / ${agentModel}…`,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messages: any[] = [{ role: "user", content: task }];

      let iterations = 0;
      let textWasSent = false;

      while (iterations < MAX_ITERATIONS) {
        iterations++;

        let llmResponse;
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
              stream: false,
            }),
          });

          if (!res.ok) {
            const errText = await res.text();
            send("error", { text: `LLM error (${res.status}): ${errText.slice(0, 300)}` });
            break;
          }

          llmResponse = await res.json();
        } catch (e) {
          send("error", { text: `Network error: ${(e as Error).message}` });
          break;
        }

        const choice = llmResponse.choices?.[0];
        if (!choice) {
          send("error", { text: "Empty response from LLM." });
          break;
        }

        const assistantMsg = choice.message;
        messages.push(assistantMsg);

        // ── Tool calls ─────────────────────────────────────────────────────
        if (choice.finish_reason === "tool_calls" && assistantMsg.tool_calls?.length) {
          for (const toolCall of assistantMsg.tool_calls) {
            const toolName = toolCall.function?.name ?? "unknown";
            let args: Record<string, string> = {};
            try {
              args = JSON.parse(toolCall.function.arguments ?? "{}");
            } catch { /* use empty */ }

            const labels: Record<string, string> = {
              read_file:    `Reading \`${args.path}\`…`,
              list_files:   `Exploring \`${args.path || "/"}\`…`,
              search_files: `Searching for \`${args.pattern}\`…`,
              stage_file:   `Staging \`${args.path}\`…`,
            };
            send("tool_call", { text: labels[toolName] ?? `Calling ${toolName}…` });

            const result = await executeTool(toolName, args, repo, stagedFiles);

            // One message per tool result — this is the correct OpenAI format
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: result,
            });
          }
          continue; // back to top of loop
        }

        // ── Final answer ───────────────────────────────────────────────────
        // Some models (Qwen3, GPT-4o) return content: null after tool calls.
        // In that case we auto-generate a summary from staged files.
        const finalText: string = (assistantMsg.content ?? "").trim();

        if (finalText) {
          await streamText(finalText, send);
          textWasSent = true;
        }

        break;
      }

      // ── Fallback: model never wrote a text summary ─────────────────────
      // This happens when models consider tool calls to BE their response.
      if (!textWasSent) {
        if (stagedFiles.length > 0) {
          const summary = [
            "I've completed the task. Here's what I changed:\n",
            ...stagedFiles.map(
              (f) =>
                `- \`${f.path}\` — ${
                  f.originalContent === null ? "**new file**" : "**modified**"
                }: ${f.description}`
            ),
            "\nReview the staged changes below and push when ready.",
          ].join("\n");
          await streamText(summary, send);
        } else {
          await streamText(
            "I explored the repository but didn't find anything that needed changing for this task.",
            send
          );
        }
      }

      // ── Send staged files to client ─────────────────────────────────────
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