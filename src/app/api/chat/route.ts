import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/providers";
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
    (f) =>
      `### File: ${f.repo}/${f.path}\n\`\`\`\n${f.content}\n\`\`\``
  );
  return `<context>\nThe user has shared these files from their GitHub repo:\n\n${parts.join("\n\n")}\n</context>\n\n`;
}

export async function POST(req: NextRequest) {
  // Simple auth check — skipped if APP_PASSWORD is not set (local dev)
  const authHeader = req.headers.get("x-app-password");
  if (process.env.APP_PASSWORD && process.env.APP_PASSWORD !== "change_me_in_production" && authHeader !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { messages, model, injectedFiles = [] } = body;
  const provider = getProvider();

  // Prepend file context to the latest user message if files are injected
  const contextBlock = buildContextBlock(injectedFiles);
  const enrichedMessages = messages.map((m, i) => {
    if (i === messages.length - 1 && m.role === "user" && contextBlock) {
      return { ...m, content: contextBlock + m.content };
    }
    return m;
  });

  const payload = {
    model: model || provider.defaultModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...enrichedMessages,
    ],
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
        // Anthropic needs an extra header; harmless for others
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      return NextResponse.json(
        { error: `Provider error: ${err}` },
        { status: upstream.status }
      );
    }

    // Stream the response straight to the client
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to reach provider: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}
