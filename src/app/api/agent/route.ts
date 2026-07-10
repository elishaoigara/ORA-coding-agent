import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/providers";
import { AGENT_TOOLS, type StagedFile } from "@/lib/agentTools";

export const maxDuration = 300;

const GH_BASE = "https://api.github.com";
const MAX_ITERATIONS_PER_CALL = 15;
const MAX_TOKENS = 32000;

const REQUEST_BUDGET_MS  = parseInt(process.env.AGENT_WATCHDOG_MS ?? "45000", 10);
const PER_CALL_TIMEOUT_MS = Math.min(40_000, REQUEST_BUDGET_MS - 5_000);

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
- NEVER ask questions or say "I'll do X" — just DO it immediately with tool calls
- NEVER truncate code — write COMPLETE file contents, every single line
- NEVER use "..." or "// rest of file" placeholders — the full file must be written
- For every file marked "modify": call read_file first, then stage_file with complete updated content
- For every file marked "create": call stage_file with complete new file content
- Write FULL file content — if a file is 500 lines, write all 500 lines
- Follow the existing code style exactly
- After ALL files are staged with stage_file, stop calling tools and write a SHORT plain-text summary of every file you changed`;
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

      const content = args.content ?? "";
      if (
        content.trim().endsWith("...") ||
        content.includes("// ... rest") ||
        content.includes("// ...rest") ||
        content.includes("/* ... */") ||
        content.includes("# ... rest")
      ) {
        return JSON.stringify({
          error: "TRUNCATED CONTENT DETECTED. You must write the COMPLETE file. Never use '...' placeholders.",
        });
      }

      const staged: StagedFile = {
        path: args.path,
        content,
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
        lines: content.split("\n").length,
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

function isQwenProvider(baseUrl: string): boolean {
  return baseUrl.includes("dashscope") || baseUrl.includes("aliyun");
}

// ── Leaked pseudo tool-call syntax detector ──────────────────────────────────
// Some models (seen from certain OpenRouter free-tier models) don't use the
// structured `tool_calls` field at all — instead they emit their own made-up
// tag syntax for tool invocation directly as plain assistant `content`, e.g.
// "<|DSML|tool_calls><|DSML|invoke name="read_file">...". Since the API call
// succeeds (200 OK), our normal "no tool_calls" path treats this as regular
// text and would stream the raw tags straight into the chat UI. Detect that
// pattern here so we can nudge the model to use real function-calling instead
// of showing the user a wall of garbled tags.
const LEAKED_TOOLCALL_RE = /<\|?\s*[\w.-]*\|?\s*(?:tool_calls|invoke|function_calls?)\b/i;

function looksLikeLeakedToolCall(text: string): boolean {
  return LEAKED_TOOLCALL_RE.test(text);
}

function isQwenModel(model: string): boolean {
  return /^(qwen|qwq|qvq)/i.test(model);
}

function llmHeaders(apiKey: string, baseUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (baseUrl.includes("anthropic.com")) {
    headers["anthropic-version"] = "2023-06-01";
  }
  if (baseUrl.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "https://github.com/ORA-coding-agent";
    headers["X-Title"] = "ORA Coding Agent";
  }
  return headers;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildRequestBody(params: {
  model: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: any[];
  baseUrl: string;
  forceText?: boolean;
}) {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    tools: params.tools,
    tool_choice: params.forceText ? "none" : "auto",
    max_tokens: MAX_TOKENS,
    temperature: 0.2,
    stream: false,
  };

  if (isQwenProvider(params.baseUrl) && isQwenModel(params.model)) {
    body.enable_thinking = false;
  }

  return body;
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
    resumeMessages?: unknown[];
    resumeStagedFiles?: StagedFile[];
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { task, repo, provider: providerId, model, phase, plan, resumeMessages, resumeStagedFiles } = body;
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

  const planTools = AGENT_TOOLS.filter((t) =>
    ["read_file", "list_files", "search_files"].includes(
      (t as { function: { name: string } }).function.name
    )
  );

  const stagedFiles: StagedFile[] = resumeStagedFiles ? [...resumeStagedFiles] : [];
  const encoder = new TextEncoder();

  function allFilesStaged(): boolean {
    if (!plan) return false;
    return plan.changes
      .filter((c) => c.action !== "delete")
      .every((c) => stagedFiles.some((f) => f.path === c.path));
  }

  const stream = new ReadableStream({
    async start(controller) {
      function send(type: string, payload: Record<string, unknown> = {}) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`)
        );
      }

      const isResume = !!resumeMessages?.length;
      const phaseLabel = isResume ? "Continuing execution" : phase === "plan" ? "Analysing codebase" : "Executing plan";
      send("progress", { text: `${phaseLabel} on **${repo}** using ${provider.name} / ${agentModel}…` });

      const systemPrompt = phase === "plan" ? PLAN_SYSTEM_PROMPT : buildExecutePrompt(plan!);
      const activeTools  = phase === "plan" ? planTools : AGENT_TOOLS;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messages: any[] = resumeMessages?.length
        ? [...resumeMessages]
        : [{ role: "user", content: task }];

      let iterations = 0;
      let textWasSent = false;
      let consecutiveEmptyResponses = 0;
      const requestStart = Date.now();

      function nearBudget(): boolean {
        return Date.now() - requestStart >= REQUEST_BUDGET_MS;
      }

      while (iterations < MAX_ITERATIONS_PER_CALL) {
        if (nearBudget()) {
          const missing = plan?.changes
            .filter((c) => c.action !== "delete" && !stagedFiles.some((f) => f.path === c.path))
            .map((c) => `- ${c.path}`).join("\n");
          if (phase === "execute" && missing) {
            const prunedWatchdog = messages.map((m: Record<string, unknown>) => {
              if (m.role !== "tool") return m;
              try {
                const p = JSON.parse(m.content as string ?? "{}");
                if (typeof p.content === "string" && p.content.length > 500)
                  return { ...m, content: JSON.stringify({ ...p, content: `[pruned]` }) };
              } catch { /**/ }
              return m;
            });
            send("continue", {
              messages: prunedWatchdog,
              stagedFiles,
              progress: `Staged ${stagedFiles.length} file(s). Resuming in next request…`,
            });
            controller.close();
            return;
          }
          break;
        }

        iterations++;

        let llmResponse;
        try {
          const forceText = phase === "execute" && allFilesStaged();

          const fetchAbort   = new AbortController();
          const fetchTimeout = setTimeout(() => fetchAbort.abort(), PER_CALL_TIMEOUT_MS);

          let res!: Response;
          try {
            res = await fetch(`${provider.baseUrl}/chat/completions`, {
              method: "POST",
              headers: llmHeaders(provider.apiKey, provider.baseUrl),
              body: JSON.stringify(
                buildRequestBody({
                  model: agentModel,
                  messages: [{ role: "system", content: systemPrompt }, ...messages],
                  tools: activeTools,
                  baseUrl: provider.baseUrl,
                  forceText,
                })
              ),
              signal: fetchAbort.signal,
            });
          } finally {
            clearTimeout(fetchTimeout);
          }

          if (!res.ok) {
            const errText = await res.text();

            // ── Groq/LLaMA XML tool-call fallback ──────────────────────────
            // LLaMA models on Groq emit tool calls in XML instead of JSON.
            // Two known variants:
            //   Format 1: <function=name>{"args"}</function>
            //   Format 2: <function=name\n{"args"}></c/function>  ← LLaMA 3.3 70B
            // Groq rejects both with 400 tool_use_failed. Parse and execute
            // them ourselves so the agent loop continues uninterrupted.
            try {
              const errJson = JSON.parse(errText);
              if (errJson.error?.code === "tool_use_failed") {
                const failedGen: string = errJson.error?.failed_generation ?? "";

                const xmlRe  = /<function=(\w+)>([\s\S]*?)<\/function>/g;
                const xmlRe2 = /<function=(\w+)\n({[\s\S]*?})>(?:<\/c\/function>|<\/function>)/g;

                let xmlMatch: RegExpExecArray | null;
                let recovered = false;
                const syntheticToolCalls: {id: string; type: string; function: {name: string; arguments: string}}[] = [];
                const toolResults: {id: string; content: string}[] = [];

                // Collect all matches from both format variants
                const allMatches: [string, string][] = [];
                while ((xmlMatch = xmlRe.exec(failedGen)) !== null) {
                  allMatches.push([xmlMatch[1], xmlMatch[2].trim()]);
                }
                while ((xmlMatch = xmlRe2.exec(failedGen)) !== null) {
                  allMatches.push([xmlMatch[1], xmlMatch[2].trim()]);
                }

                for (const [toolName, rawArgs] of allMatches) {
                  let args: Record<string, string> = {};
                  try { args = JSON.parse(rawArgs || "{}"); } catch { /* no args */ }

                  const syntheticId = `xmlcall_${Date.now()}_${syntheticToolCalls.length}`;
                  send("tool_call", { text: `↩ Retrying \`${toolName}\` (XML→JSON fix)…` });

                  const result = await executeTool(toolName, args, repo, stagedFiles);
                  syntheticToolCalls.push({
                    id: syntheticId, type: "function",
                    function: { name: toolName, arguments: JSON.stringify(args) },
                  });
                  toolResults.push({ id: syntheticId, content: result });
                  recovered = true;
                }

                if (recovered) {
                  messages.push({ role: "assistant", content: null, tool_calls: syntheticToolCalls });
                  for (const tr of toolResults) {
                    messages.push({ role: "tool", tool_call_id: tr.id, content: tr.content });
                  }
                  continue;
                }
              }
            } catch { /* not JSON or no failed_generation — fall through */ }
            // ── End Groq XML fallback ───────────────────────────────────────

            send("error", { text: `LLM error (${res.status}): ${errText.slice(0, 500)}` });
            break;
          }
          llmResponse = await res.json();
        } catch (e) {
          const err = e as Error;
          if (err.name === "AbortError") {
            if (phase === "execute" && stagedFiles.length > 0) {
              const prunedAbort = messages.map((m: Record<string, unknown>) => {
                if (m.role !== "tool") return m;
                try {
                  const p = JSON.parse(m.content as string ?? "{}");
                  if (typeof p.content === "string" && p.content.length > 500)
                    return { ...m, content: JSON.stringify({ ...p, content: "[pruned]" }) };
                } catch { /**/ }
                return m;
              });
              send("continue", {
                messages: prunedAbort,
                stagedFiles,
                progress: `LLM call timed out — staged ${stagedFiles.length} file(s) so far. Resuming…`,
              });
              controller.close();
              return;
            }
            send("error", { text: "⏱ The LLM took too long to respond. Try a faster model or a smaller task." });
            break;
          }
          send("error", { text: `Network error: ${err.message}` });
          break;
        }

        const choice = llmResponse.choices?.[0];
        if (!choice) {
          send("error", { text: `Empty response from LLM. Raw: ${JSON.stringify(llmResponse).slice(0, 200)}` });
          break;
        }

        const assistantMsg = choice.message;
        messages.push(assistantMsg);

        if (choice.finish_reason === "length") {
          send("progress", { text: "⚠️ Response was cut off — continuing…" });
          messages.push({
            role: "user",
            content: "Your last response was cut off. Continue exactly where you left off — complete all remaining tool calls and file changes.",
          });
          continue;
        }

        const hasToolCalls = Array.isArray(assistantMsg.tool_calls) && assistantMsg.tool_calls.length > 0;

        if (hasToolCalls) {
          consecutiveEmptyResponses = 0;
          for (const toolCall of assistantMsg.tool_calls) {
            const toolName = toolCall.function?.name ?? "unknown";
            const toolId = toolCall.id ?? `tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            let args: Record<string, string> = {};
            try { args = JSON.parse(toolCall.function?.arguments ?? "{}"); } catch { /* empty */ }

            const labels: Record<string, string> = {
              read_file:    `Reading \`${args.path}\`…`,
              list_files:   `Exploring \`${args.path || "/"}\`…`,
              search_files: `Searching for \`${args.pattern}\`…`,
              stage_file:   `Staging \`${args.path}\`…`,
            };
            send("tool_call", { text: labels[toolName] ?? `Calling ${toolName}…` });

            const result = await executeTool(toolName, args, repo, stagedFiles);
            toolCall.id = toolId;
            messages.push({ role: "tool", tool_call_id: toolId, content: result });
          }
          continue;
        }

        const rawText: string = (assistantMsg.content ?? "").trim();

        if (!rawText) {
          consecutiveEmptyResponses++;
          if (consecutiveEmptyResponses >= 2) break;
          continue;
        }

        // Model tried to call a tool using made-up tag syntax instead of the
        // real function-calling API. Don't show this to the user — push it
        // back as feedback and let the model retry with proper tool_calls.
        if (looksLikeLeakedToolCall(rawText)) {
          consecutiveEmptyResponses++;
          if (consecutiveEmptyResponses >= 2) {
            send("error", {
              text: "⚠️ This model isn't reliably using tool calls. Try switching to a different model (e.g. DeepSeek V3.2 or Qwen3 Coder Plus).",
            });
            break;
          }
          messages.push({
            role: "user",
            content:
              "Do not write tool calls as text/tags in your response content. Use the actual function-calling mechanism (the tool_calls field) to invoke tools. Try again.",
          });
          continue;
        }
        consecutiveEmptyResponses = 0;

        if (phase === "plan") {
          const planMatch = rawText.match(/<PLAN>([\s\S]*?)<\/PLAN>/);
          const textWithoutPlan = rawText.replace(/<PLAN>[\s\S]*?<\/PLAN>/g, "").trim();

          if (textWithoutPlan && !textWasSent) {
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
            messages.push({
              role: "user",
              content: "You forgot to include the <PLAN> JSON block. Please output ONLY the <PLAN>...</PLAN> block now, nothing else.",
            });
            continue;
          }
        } else {
          const missingPaths = plan?.changes
            .filter((c) => c.action !== "delete" && !stagedFiles.some((f) => f.path === c.path))
            .map((c) => `- ${c.path}`)
            .join("\n");

          if (missingPaths && iterations < MAX_ITERATIONS_PER_CALL) {
            send("progress", { text: "Still staging remaining files…" });
            messages.push({
              role: "user",
              content: `You haven't staged all planned files yet. Still missing:\n${missingPaths}\n\nContinue — stage these files now.`,
            });
            continue;
          }

          if (missingPaths) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const prunedMsgs = messages.map((m: any) => {
              if (m.role !== "tool") return m;
              try {
                const p = JSON.parse(m.content ?? "{}");
                if (typeof p.content === "string" && p.content.length > 500) {
                  return { ...m, content: JSON.stringify({ ...p, content: `[pruned — ${p.lines ?? "?"} lines]` }) };
                }
              } catch { /**/ }
              return m;
            });
            send("continue", {
              messages: prunedMsgs,
              stagedFiles,
              progress: `Staged ${stagedFiles.length} file(s) so far. Continuing…`,
            });
            controller.close();
            return;
          }

          if (rawText) {
            await streamText(rawText, send);
            textWasSent = true;
          }
        }

        break;
      }

      const missingAfterLoop = plan?.changes
        .filter((c) => c.action !== "delete" && !stagedFiles.some((f) => f.path === c.path))
        .map((c) => `- ${c.path}`)
        .join("\n");

      if (phase === "execute" && missingAfterLoop) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prunedMessages = messages.map((m: any) => {
          if (m.role !== "tool") return m;
          try {
            const parsed = JSON.parse(m.content ?? "{}");
            if (typeof parsed.content === "string" && parsed.content.length > 500) {
              return { ...m, content: JSON.stringify({ ...parsed, content: `[pruned — ${parsed.lines ?? "?"} lines]` }) };
            }
          } catch { /* not JSON */ }
          return m;
        });

        send("continue", {
          messages: prunedMessages,
          stagedFiles,
          progress: `Staged ${stagedFiles.length} file(s) so far. Continuing in next batch…`,
        });
        controller.close();
        return;
      }

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
          await streamText(
            "⚠️ The agent finished but staged no files. " +
            "This usually means the model didn't use its tools. " +
            "Try switching to Qwen3 Max or DeepSeek V3 and re-running the task.",
            send
          );
        } else if (phase === "plan") {
          await streamText(
            "⚠️ The agent completed analysis but could not produce a structured plan. " +
            "Please try rephrasing your task, or switch to a more capable model (DeepSeek V3.2 or Qwen3 Coder Plus).",
            send
          );
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