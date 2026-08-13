import { NextRequest, NextResponse } from "next/server";
import { getAgentTools } from "@/lib/agentTools";
import { routeMessage } from "@/lib/autoRouter";
import {
  getConfiguredProviderIds,
  getProvider,
  resolveModel,
  type ProviderConfig,
  type ProviderId,
} from "@/lib/providers";
import { agentRequestSchema, validateOr400 } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";
import {
  GitHubWorkspace,
  normalizeRepositoryPath,
} from "@/lib/agent/githubWorkspace";
import { buildExecutePrompt, PLAN_SYSTEM_PROMPT } from "@/lib/agent/prompts";
import {
  createAgentCompletion,
  ProviderRequestError,
} from "@/lib/agent/providerClient";
import type {
  AgentMessage,
  AgentPlan,
  AgentToolCall,
  StagedFile,
} from "@/lib/agent/types";
import {
  getMissingChanges,
  looksLikeLeakedToolCall,
  parsePlanResponse,
  parseToolArguments,
  pruneToolMessages,
} from "@/lib/agent/utils";

export const maxDuration = 300;

const MAX_ITERATIONS_PER_REQUEST = 15;
const DEFAULT_REQUEST_BUDGET_MS = 45_000;
const ELLIPSIS = "\u2026";

function configuredDuration(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_REQUEST_BUDGET_MS;
  return Math.min(280_000, Math.max(10_000, parsed));
}

function resolveAgentProvider(
  providerId: string | undefined,
  task: string
): { provider: ProviderConfig; model: string; reason: string } {
  if (providerId && providerId !== "auto") {
    const provider = getProvider(providerId);
    return {
      provider,
      model: provider.defaultModel,
      reason: "Selected by user",
    };
  }

  const decision = routeMessage(task, getConfiguredProviderIds());
  const provider = getProvider(decision.provider);
  return {
    provider,
    model: decision.model || provider.defaultModel,
    reason: decision.reason,
  };
}

function toolLabel(name: string, args: Record<string, string>): string {
  const labels: Record<string, string> = {
    read_file: `Reading ${args.path ?? "file"}${ELLIPSIS}`,
    list_files: `Exploring ${args.path || "/"}${ELLIPSIS}`,
    search_files: `Searching for ${args.pattern ?? "code"}${ELLIPSIS}`,
    stage_file: `Staging ${args.path ?? "file"}${ELLIPSIS}`,
    delete_file: `Deleting ${args.path ?? "file"}${ELLIPSIS}`,
  };
  return labels[name] ?? `Calling ${name}${ELLIPSIS}`;
}

function recoverMalformedToolCalls(body: string): Array<{
  name: string;
  args: Record<string, string>;
}> {
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: string; failed_generation?: string };
    };
    if (parsed.error?.code !== "tool_use_failed") return [];

    const generated = parsed.error.failed_generation ?? "";
    const expressions = [
      /<function=(\w+)>([\s\S]*?)<\/function>/g,
      /<function=(\w+)\n({[\s\S]*?})>(?:<\/c\/function>|<\/function>)/g,
    ];
    const recovered: Array<{ name: string; args: Record<string, string> }> = [];
    const seen = new Set<string>();

    for (const expression of expressions) {
      let match: RegExpExecArray | null;
      while ((match = expression.exec(generated)) !== null) {
        const key = `${match[1]}:${match[2]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        recovered.push({ name: match[1], args: parseToolArguments(match[2]) });
      }
    }
    return recovered;
  } catch {
    return [];
  }
}

async function streamText(
  text: string,
  send: (type: string, payload?: Record<string, unknown>) => void
): Promise<void> {
  const words = text.split(" ");
  for (let index = 0; index < words.length; index += 8) {
    const chunk = words.slice(index, index + 8).join(" ");
    send("text", { text: chunk + (index + 8 < words.length ? " " : "") });
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateOr400(agentRequestSchema, raw);
  if (parsed instanceof NextResponse) return parsed;

  const {
    task,
    repo,
    provider: requestedProvider,
    model: requestedModel,
    branch,
    phase,
    resumeMessages,
    resumeStagedFiles,
  } = parsed;
  const plan: AgentPlan | undefined = phase === "execute" ? parsed.plan : undefined;

  let provider: ProviderConfig;
  let agentModel: string;
  let routeReason: string;
  try {
    const resolved = resolveAgentProvider(requestedProvider, task);
    provider = resolved.provider;
    routeReason = resolved.reason;
    agentModel = resolveModel(
      requestedProvider && requestedProvider !== "auto" && requestedModel
        ? requestedModel
        : resolved.model,
      provider.id as ProviderId
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not resolve an AI provider" },
      { status: 400 }
    );
  }

  const activeTools = getAgentTools(phase);
  const allowedTools = new Set(activeTools.map((tool) => tool.function.name));
  const stagedFiles: StagedFile[] = resumeStagedFiles
    ? resumeStagedFiles.map((file) => ({ ...file }))
    : [];
  const workspace = new GitHubWorkspace(repo, branch, stagedFiles);
  const executeTool = async (name: string, args: Record<string, string>): Promise<string> => {
    if (!allowedTools.has(name)) {
      return JSON.stringify({ error: `${name} is not available during ${phase}` });
    }

    if (name === "stage_file" || name === "delete_file") {
      let path: string;
      try {
        path = normalizeRepositoryPath(args.path);
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : "Invalid repository path",
        });
      }
      const approvedChange = plan?.changes.find(
        (change) => normalizeRepositoryPath(change.path) === path
      );
      if (!approvedChange) {
        return JSON.stringify({
          error: `${path || "This path"} is outside the approved plan`,
        });
      }
      if (name === "delete_file" && approvedChange.action !== "delete") {
        return JSON.stringify({ error: `${path} was not approved for deletion` });
      }
      if (name === "stage_file" && approvedChange.action === "delete") {
        return JSON.stringify({ error: `${path} was approved for deletion, not modification` });
      }
    }

    return workspace.execute(name, args);
  };
  const requestBudgetMs = configuredDuration(process.env.AGENT_WATCHDOG_MS);
  const providerTimeoutMs = Math.min(40_000, requestBudgetMs - 3_000);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      const send = (type: string, payload: Record<string, unknown> = {}) => {
        if (closed || request.signal.aborted) return;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`)
        );
      };
      const continueExecution = (messages: AgentMessage[], progress: string) => {
        send("continue", {
          messages: pruneToolMessages(messages),
          stagedFiles,
          progress,
        });
        close();
      };

      const phaseLabel = phase === "plan" ? "Analysing codebase" : "Executing plan";
      send("meta", {
        provider: provider.id,
        model: agentModel,
        reason: routeReason,
        branch: branch ?? null,
      });
      send("progress", {
        text: `${phaseLabel} on ${repo}${branch ? ` (${branch})` : ""} using ${provider.name} / ${agentModel}${ELLIPSIS}`,
      });

      const systemPrompt = phase === "plan"
        ? PLAN_SYSTEM_PROMPT
        : buildExecutePrompt(plan!);
      const messages: AgentMessage[] = resumeMessages?.length
        ? resumeMessages.map((message) => ({ ...message }))
        : [{ role: "user", content: task }];
      const startedAt = Date.now();
      let iterations = 0;
      let textWasSent = false;
      let consecutiveEmptyResponses = 0;
      let planWasSent = false;

      try {
        while (iterations < MAX_ITERATIONS_PER_REQUEST && !request.signal.aborted) {
          const missing = getMissingChanges(plan?.changes, stagedFiles);
          if (Date.now() - startedAt >= requestBudgetMs) {
            if (phase === "execute" && missing.length > 0) {
              continueExecution(
                messages,
                `Staged ${stagedFiles.length} file(s). Resuming the remaining work${ELLIPSIS}`
              );
              return;
            }
            break;
          }

          iterations += 1;
          let completion;
          try {
            completion = await createAgentCompletion(
              provider,
              {
                model: agentModel,
                messages: [{ role: "system", content: systemPrompt }, ...messages],
                tools: activeTools,
                forceText: phase === "execute" && missing.length === 0,
              },
              providerTimeoutMs,
              request.signal
            );
          } catch (error) {
            if (request.signal.aborted) {
              close();
              return;
            }

            if (error instanceof ProviderRequestError) {
              const recovered = recoverMalformedToolCalls(error.responseBody);
              if (recovered.length > 0) {
                const toolCalls: AgentToolCall[] = [];
                const results: AgentMessage[] = [];
                for (const [index, call] of recovered.entries()) {
                  const id = `recovered_${Date.now()}_${index}`;
                  send("tool_call", { text: toolLabel(call.name, call.args) });
                  const result = await executeTool(call.name, call.args);
                  toolCalls.push({
                    id,
                    type: "function",
                    function: { name: call.name, arguments: JSON.stringify(call.args) },
                  });
                  results.push({ role: "tool", tool_call_id: id, content: result });
                }
                messages.push({ role: "assistant", content: null, tool_calls: toolCalls });
                messages.push(...results);
                continue;
              }
              send("error", {
                text: `Provider error (${error.status}): ${error.responseBody.slice(0, 500)}`,
              });
              break;
            }

            if (error instanceof Error && error.name === "AbortError") {
              if (phase === "execute" && stagedFiles.length > 0) {
                continueExecution(
                  messages,
                  `The model timed out after staging ${stagedFiles.length} file(s). Resuming${ELLIPSIS}`
                );
                return;
              }
              send("error", { text: "The model timed out. Try a faster model or a smaller task." });
              break;
            }

            send("error", {
              text: `Provider request failed: ${error instanceof Error ? error.message : "unknown error"}`,
            });
            break;
          }

          const choice = completion.choices?.[0];
          if (!choice?.message) {
            send("error", { text: "The provider returned an empty response." });
            break;
          }

          const assistantMessage = choice.message;
          messages.push(assistantMessage);

          if (choice.finish_reason === "length") {
            send("progress", { text: `Response reached the model limit; continuing${ELLIPSIS}` });
            messages.push({
              role: "user",
              content: "Continue exactly where the previous response stopped. Complete the active workflow.",
            });
            continue;
          }

          const toolCalls = assistantMessage.tool_calls ?? [];
          if (toolCalls.length > 0) {
            consecutiveEmptyResponses = 0;
            for (const [index, toolCall] of toolCalls.entries()) {
              const name = toolCall.function?.name ?? "unknown";
              const id = toolCall.id || `tool_${Date.now()}_${index}`;
              const args = parseToolArguments(toolCall.function?.arguments);
              toolCall.id = id;
              send("tool_call", { text: toolLabel(name, args) });
              const result = await executeTool(name, args);
              messages.push({ role: "tool", tool_call_id: id, content: result });
            }
            continue;
          }

          const responseText = (assistantMessage.content ?? "").trim();
          if (!responseText) {
            consecutiveEmptyResponses += 1;
            if (consecutiveEmptyResponses >= 2) break;
            messages.push({ role: "user", content: "Continue the active coding-agent workflow." });
            continue;
          }

          if (looksLikeLeakedToolCall(responseText)) {
            consecutiveEmptyResponses += 1;
            if (consecutiveEmptyResponses >= 2) {
              send("error", {
                text: "This model is not using structured tools reliably. Try another model.",
              });
              break;
            }
            messages.push({
              role: "user",
              content: "Use the structured tool_calls field instead of writing tool calls as text.",
            });
            continue;
          }
          consecutiveEmptyResponses = 0;

          if (phase === "plan") {
            const parsedPlan = parsePlanResponse(responseText);
            if (parsedPlan.narrative && !textWasSent) {
              await streamText(parsedPlan.narrative, send);
              textWasSent = true;
            }
            if (parsedPlan.plan) {
              send("plan", { plan: parsedPlan.plan });
              planWasSent = true;
              break;
            }
            messages.push({
              role: "user",
              content: `${parsedPlan.error ?? "The plan was invalid"} Output only a valid <PLAN> JSON block now.`,
            });
            continue;
          }

          const remaining = getMissingChanges(plan?.changes, stagedFiles);
          if (remaining.length > 0) {
            send("progress", { text: `Staging ${remaining.length} remaining file(s)${ELLIPSIS}` });
            messages.push({
              role: "user",
              content: `The approved plan is not complete. Stage these paths now:\n${remaining
                .map((change) => `- ${change.path}`)
                .join("\n")}`,
            });
            continue;
          }

          await streamText(responseText, send);
          textWasSent = true;
          break;
        }

        if (request.signal.aborted) {
          close();
          return;
        }

        const missingAfterLoop = getMissingChanges(plan?.changes, stagedFiles);
        if (phase === "execute" && missingAfterLoop.length > 0) {
          continueExecution(
            messages,
            `Staged ${stagedFiles.length} file(s). Continuing ${missingAfterLoop.length} remaining file(s)${ELLIPSIS}`
          );
          return;
        }

        if (!textWasSent) {
          if (phase === "execute" && stagedFiles.length > 0) {
            await streamText(
              [
                "Execution complete. Review the staged changes before pushing:",
                ...stagedFiles.map(
                  (file) => `- ${file.path} (${file.action}): ${file.description}`
                ),
              ].join("\n"),
              send
            );
          } else if (phase === "plan" && !planWasSent) {
            await streamText("The agent could not produce a valid plan. Try another model or narrow the task.", send);
          } else if (phase === "execute") {
            await streamText("The agent completed without staging any changes.", send);
          }
        }

        if (phase === "execute" && stagedFiles.length > 0) {
          send("staged", { files: stagedFiles });
        }
        send("done", { iterations, phase, stagedCount: stagedFiles.length });
        close();
      } catch (error) {
        send("error", {
          text: `Agent failed: ${error instanceof Error ? error.message : "unknown error"}`,
        });
        close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
