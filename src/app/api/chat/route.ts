import { NextRequest, NextResponse } from "next/server";
import { getProvider, getAllPublicProviders } from "@/lib/providers";
import { routeMessage } from "@/lib/autoRouter";
import type { ChatRequest, InjectedFile } from "@/types";

const SYSTEM_PROMPT = `You are an expert AI coding agent. You help developers write, debug, refactor, review, and understand code across all languages and frameworks.

Guidelines:
- Always wrap code blocks in triple backticks with the correct language tag (e.g. \`\`\`typescript)
- Be concise but complete — don't truncate working code
- When given file context, reference it specifically (e.g. "In your utils.ts on line 12...")
- Point out edge cases, potential bugs, or performance issues proactively
- When debugging, explain the root cause before showing the fix
- Prefer idiomatic, modern patterns for the language being used`;

function buildContextBlock(files: InjectedFile[]): string {
  if (!files.length) return "";
  const parts = files.map(
    (f) => `### File: ${f.repo}/${f.path}\n\`\`\`\n${f.content}\n\`\`\``
  );
  return `<context>\nThe user has shared these files from their GitHub repo:\n\n${parts.join("\n\n")}\n</context>\n\n`;
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

  const payload = {
    model: resolvedModel || provider.defaultModel,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...enrichedMessages],
    stream: true,
    max_tokens: 4096,
    temperature: 0.3,
  };

  try {
    const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      return NextResponse.json(
        { error: `Provider error (${provider.name}): ${err}` },
        { status: upstream.status }
      );
    }

    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Routed-Provider": resolvedProviderId,
        "X-Routed-Model": resolvedModel || provider.defaultModel,
        "X-Route-Reason": routeReason,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to reach ${provider.name}: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}