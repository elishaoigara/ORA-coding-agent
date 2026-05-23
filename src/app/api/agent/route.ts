import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/providers";
import { AGENT_TOOLS, type StagedFile } from "@/lib/agentTools";

export const maxDuration = 60;

const GH_BASE = "https://api.github.com";
const MAX_ITERATIONS = 15;

// ── Phase 1: Plan ─────────────────────────────────────────────────────────────
const PLAN_SYSTEM_PROMPT = `You are a senior software engineer analyzing a codebase to plan changes.

YOUR ONLY JOB IN THIS PHASE:
1. Call list_files("") immediately to see the repo structure
2. Navigate into relevant directories with list_files
3. Read every file that is relevant to the task using read_file
4. Understand the full picture before planning anything
5. Output your analysis and a detailed plan

RULES:
- Do NOT use stage_file — this is planning only, no changes yet
- Read ALL files that will be affected before writing the plan
- Be specific: name exact file paths, exact functions, exact changes
- The user will approve or reject your plan before any code is written

OUTPUT FORMAT — at the very end of your response, output your plan as JSON wrapped in <PLAN> tags like this:

<PLAN>
{
  "summary": "One sentence description of what will be done",
  "approach": "Technical explanation of the approach",
  "changes": [
    {
      "action": "create",
      "path": "src/components/LogoutButton.tsx",
      "reason": "New component needed for the logout UI",
      "details": "Creates a button that calls supabase.auth.signOut() and redirects to /login"
    },
    {
      "action": "modify",
      "path": "src/components/Navbar.tsx",
      "reason": "Needs to include the new LogoutButton",
      "details": "Import LogoutButton and add it to the nav items for authenticated users"
    }
  ]
}
</PLAN>

Write your analysis first in plain text, then end with the <PLAN> block.`;

// ── Phase 2: Execute ──────────────────────────────────────────────────────────
function buildExecutePrompt(plan: AgentPlan): string {
  const changesList = plan.changes
    .map((c) => `- ${c.action.toUpperCase()} \`${c.path}\`: ${c.details}`)
    .join("\n");

  return `You are a coding agent executing an approved plan. The user has reviewed and approved the following plan. Execute it now.

APPROVED PLAN:
Summary: ${plan.summary}
Approach: ${plan.approach}

Changes to make:
${changesList}

EXECUTION RULES:
- NEVER ask questions. Execute immediately.
- For every file marked "modify": call read_file first, then stage_file with the complete updated content
- For every file marked "create": call stage_file with the complete new file content
- Write FULL file content — never truncate, never use "..." placeholders
- Follow the existing code style exactly
- After staging all files, write a brief summary confirming what was done`;
}

// ── Tool helpers ──────────────────────────────────────────────────────────────
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
          name: i.name, path: i.path, type: i.type,
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
          note: "Search unavailable. Use list_files and read_file to explore.",
          pattern: args.pattern,
        });
      }
      const data = await res.json();
      const results = (data.items ?? []).slice(0, 10).map(
        (i: { path: string; name: string }) => ({ path: i.path, name: i.name })
      );
      return JSON.stringify({ results, count: results.length });
    }

    if (name === "stage_file") {
      let originalContent: string | null = null;
      const existing = await fetch(`${GH_BASE}/repos/${repo}/contents/${args.path}`, { headers });
      if (existing.ok) {
        const data = await existing.json();
        if (data.content) originalContent = Buffer.from(data.content, "base64").toString("utf-8");
      }

      const staged: StagedFile = {
        path: args.path,
        content: args.content,
        originalContent,
        description: args.description,
      };

      const idx = stagedFiles.findIndex((f) => f.path === args.path);
      if (idx >= 0) stagedFiles[idx] = staged;
      else stagedFiles.push(staged);

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

async function streamText(
  text: string,
  send: (type: string, payload?: Record<string, unknown>) => void
) {
  const words = text.split(" ");
  for (let i = 0; i < words.length; i += 8) {
    send("text", { text: words.slice(i, i + 8).join(" ") + (i + 8 < words.length ? " " : "") });
    await new Promise((r) => setTimeout(r, 8));
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AgentPlan {
  summary: string;
  approach: string;
  changes: {
    action: "create" | "modify" | "delete";
    path: string;
    reason: string;
    details: string;
  }[];
}

// ── Main route ────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: {
    task: string;
    repo: string;
    provider?: string;
    model?: string;
    phase: "plan" | "execute";
    plan?: AgentPlan;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { task, repo, provider: providerId, model, phase, plan } = body;
  if (!task || !repo || !phase) {
    return NextResponse.json({ error: "Missing task, repo, or phase" }, { status: 400 });
  }

  let provider;
  try {
    provider = getProvider(providerId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const agentModel =
    model === "deepseek-reasoner" ? "deepseek-chat" : model || provider.defaultModel;

  // In plan phase only allow read tools
  const planTools = AGENT_TOOLS.filter((t) =>
    ["read_file", "list_files", "search_files"].includes(
      (t as { function: { name: string } }).function.name
    )
  );

  const stagedFiles: StagedFile[] = [];
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(type: string, payload: Record<string, unknown> = {}) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`)
        );
      }

      const phaseLabel = phase === "plan" ? "Analysing codebase" : "Executing plan";
      send("progress", { text: `${phaseLabel} on **${repo}** using ${provider.name} / ${agentModel}…` });

      const systemPrompt =
        phase === "plan"
          ? PLAN_SYSTEM_PROMPT
          : buildExecutePrompt(plan!);

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
              messages: [{ role: "system", content: systemPrompt }, ...messages],
              tools: phase === "plan" ? planTools : AGENT_TOOLS,
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
        if (!choice) { send("error", { text: "Empty response from LLM." }); break; }

        const assistantMsg = choice.message;
        messages.push(assistantMsg);

        // ── Tool calls ──────────────────────────────────────────────────────
        // FIX: check tool_calls on the message directly, not just finish_reason.
        // Qwen3 and some other models return finish_reason "stop" even when
        // tool_calls are present, which caused the agent to skip all tool use
        // and go straight to the final response — producing a blank screen.
        if (assistantMsg.tool_calls?.length) {
          for (const toolCall of assistantMsg.tool_calls) {
            const toolName = toolCall.function?.name ?? "unknown";
            let args: Record<string, string> = {};
            try { args = JSON.parse(toolCall.function.arguments ?? "{}"); } catch { /* empty */ }

            const labels: Record<string, string> = {
              read_file:    `Reading \`${args.path}\`…`,
              list_files:   `Exploring \`${args.path || "/"}\`…`,
              search_files: `Searching for \`${args.pattern}\`…`,
              stage_file:   `Staging \`${args.path}\`…`,
            };
            send("tool_call", { text: labels[toolName] ?? `Calling ${toolName}…` });

            const result = await executeTool(toolName, args, repo, stagedFiles);
            messages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
          }
          continue;
        }

        // ── Final response ──────────────────────────────────────────────────
        const rawText: string = (assistantMsg.content ?? "").trim();

        if (phase === "plan") {
          const planMatch = rawText.match(/<PLAN>([\s\S]*?)<\/PLAN>/);
          const textWithoutPlan = rawText.replace(/<PLAN>[\s\S]*?<\/PLAN>/g, "").trim();

          if (textWithoutPlan) {
            await streamText(textWithoutPlan, send);
            textWasSent = true;
          }

          if (planMatch) {
            try {
              const parsedPlan: AgentPlan = JSON.parse(planMatch[1].trim());
              send("plan", { plan: parsedPlan });
            } catch {
              send("plan_error", { text: "Could not parse structured plan. See analysis above." });
            }
          } else {
            send("plan_error", { text: "Agent did not produce a structured plan. See analysis above." });
          }
        } else {
          if (rawText) {
            await streamText(rawText, send);
            textWasSent = true;
          }
        }

        break;
      }

      // Fallback if model returned no text
      if (!textWasSent) {
        if (phase === "execute" && stagedFiles.length > 0) {
          const summary = [
            "Execution complete. Files staged:\n",
            ...stagedFiles.map(
              (f) => `- \`${f.path}\` (${f.originalContent === null ? "new" : "modified"}): ${f.description}`
            ),
            "\nReview the diffs below and push when ready.",
          ].join("\n");
          await streamText(summary, send);
        } else if (phase === "execute" && stagedFiles.length === 0) {
          // FIX: if execution produced no staged files at all (agent got confused),
          // send a clear error so the user sees something instead of a blank screen.
          await streamText(
            "⚠️ The agent completed but staged no files. This can happen if the model skipped tool calls. " +
            "Try re-running the task, or switch to a different model (e.g. Qwen3 Max).",
            send
          );
          textWasSent = true;
        } else if (phase === "plan") {
          await streamText("Analysis complete. See the plan below.", send);
        }
      }

      if (phase === "execute" && stagedFiles.length > 0) {
        send("staged", { files: stagedFiles });
      }

      send("done", { iterations, phase, stagedCount: stagedFiles.length });
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