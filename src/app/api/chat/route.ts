import { NextRequest, NextResponse } from "next/server";
import { getProvider, getAllPublicProviders } from "@/lib/providers";
import { routeMessage } from "@/lib/autoRouter";
import type { ChatRequest, InjectedFile } from "@/types";

const SYSTEM_PROMPT = `You are an expert coding agent. Rules:
- Never truncate code — always output complete, working files
- Wrap code in triple backticks with the correct language tag
- Reference injected files by name and line number when relevant
- Flag bugs, edge cases, and performance issues proactively
- Use modern, idiomatic patterns for the language being used`;

function buildContextBlock(files: InjectedFile[]): string {
  if (!files.length) return "";
  const parts = files.map((f) => {
    const lines = f.content.split("\n");
    const truncated = lines.length > 150
      ? lines.slice(0, 150).join("\n") + `\n// ... (${lines.length - 150} more lines — ask to see a specific section)`
      : f.content;
    return `### ${f.repo}/${f.path}\n\`\`\`\n${truncated}\n\`\`\``;
  });
  return `<context>\n${parts.join("\n\n")}\n</context>\n\n`;
}

function buildHeaders(apiKey: string, baseUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (baseUrl.includes("anthropic.com")) {
    headers["anthropic-version"] = "2023-06-01";
  }
  return headers;
}

function isQwenProvider(baseUrl: string): boolean {
  return baseUrl.includes("dashscope") || baseUrl.includes("aliyun");
}

function isQwenModel(model: string): boolean {
  return /^(qwen|qwq|qvq)/i.test(model);
}

/**
 * Wraps an upstream SSE stream and injects a final `event: usage` line
 * containing token counts extracted from the last OpenAI-compatible data chunk.
 *
 * The injected event looks like:
 *   event: usage
 *   data: {"prompt_tokens":123,"completion_tokens":456,"provider":"groq","model":"llama-3.3-70b-versatile"}
 *
 * Existing clients that only handle `data:` lines will silently ignore it.
 */
function injectUsageEvent(
  body: ReadableStream<Uint8Array>,
  providerId: string,
  modelId: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let lineBuffer = "";
  let capturedUsage: Record<string, number> | null = null;

  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Forward chunk as-is
          controller.enqueue(value);

          // Also parse it to hunt for usage
          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split("\n");
          lineBuffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed?.usage?.prompt_tokens != null) {
                  capturedUsage = {
                    prompt_tokens:     parsed.usage.prompt_tokens,
                    completion_tokens: parsed.usage.completion_tokens ?? 0,
                  };
                }
              } catch { /* not JSON or no usage */ }
            }
          }
        }

        // Flush final incomplete line
        if (lineBuffer) {
          try {
            const parsed = JSON.parse(lineBuffer.replace(/^data: /, ""));
            if (parsed?.usage?.prompt_tokens != null) {
              capturedUsage = {
                prompt_tokens:     parsed.usage.prompt_tokens,
                completion_tokens: parsed.usage.completion_tokens ?? 0,
              };
            }
          } catch { /* ignore */ }
        }

        // Inject usage event at end of stream
        if (capturedUsage) {
          const payload = { ...capturedUsage, provider: providerId, model: modelId };
          const usageEvent = `\nevent: usage\ndata: ${JSON.stringify(payload)}\n\n`;
          controller.enqueue(encoder.encode(usageEvent));
        }
      } finally {
        controller.close();
      }
    },
  });
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("x-app-password");
  if (
    process.env.APP_PASSWORD &&
    process.env.APP_PASSWORD !== "change_me_in_production" &&
    authHeader !== process.env.APP_PASSWORD
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { messages, model, provider: providerId, injectedFiles = [] } = body;

  let resolvedProviderId = providerId;
  let resolvedModel = model;
  let routeReason = "";

  if (providerId === "auto") {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const configuredProviders = getAllPublicProviders()
      .filter((p) => p.configured)
      .map((p) => p.id);

    const decision = routeMessage(lastUserMessage, configuredProviders);
    resolvedProviderId = decision.provider;
    resolvedModel = decision.model;
    routeReason = decision.reason;
  }

  let provider;
  try {
    provider = getProvider(resolvedProviderId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const contextBlock = buildContextBlock(injectedFiles);
  const enrichedMessages = messages.map((m, i) => {
    if (i === messages.length - 1 && m.role === "user" && contextBlock) {
      return { ...m, content: contextBlock + m.content };
    }
    return m;
  });

  const maxTokensMap: Record<string, number> = {
    groq:      32768,
    deepseek:  16000,
    openai:    16384,
    anthropic: 16000,
    qwen:      16000,
  };
  const maxTokens = maxTokensMap[resolvedProviderId ?? ""] ?? 16000;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: Record<string, any> = {
    model: resolvedModel || provider.defaultModel,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...enrichedMessages],
    stream: true,
    max_tokens: maxTokens,
    temperature: 0.2,
    stream_options: { include_usage: true }, // ← request usage from OpenAI-compat APIs
  };

  if (isQwenProvider(provider.baseUrl) && isQwenModel(resolvedModel || provider.defaultModel)) {
    payload.enable_thinking = false;
  }

  const finalModel = resolvedModel || provider.defaultModel;

  try {
    const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(provider.apiKey, provider.baseUrl),
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      return NextResponse.json(
        { error: `Provider error (${provider.name}): ${err}` },
        { status: upstream.status }
      );
    }

    const transformedBody = injectUsageEvent(
      upstream.body!,
      resolvedProviderId,
      finalModel,
    );

    return new NextResponse(transformedBody, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Routed-Provider": resolvedProviderId ?? "",
        "X-Routed-Model":    finalModel,
        "X-Route-Reason":    routeReason,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to reach ${provider.name}: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}