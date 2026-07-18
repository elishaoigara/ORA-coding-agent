import { NextRequest, NextResponse } from "next/server";
import { getProvider, resolveModel } from "@/lib/providers";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: {
    messages: { role: string; content: string }[];
    model?: string;
    provider?: string;
    injectedFiles?: { path: string; content: string }[];
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── Password check (optional) ──────────────────────────────────────────
  const password = req.headers.get("x-app-password") ?? "";
  const expected = process.env.APP_PASSWORD;
  if (expected && password !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messages: rawMessages, model, provider: providerId, injectedFiles } = body;
  if (!rawMessages?.length) {
    return NextResponse.json({ error: "No messages" }, { status: 400 });
  }

  // ── Resolve provider & model ───────────────────────────────────────────
  let provider;
  try {
    provider = getProvider(providerId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // Resolve deprecated model IDs
  const resolvedModel = resolveModel(model || provider.defaultModel);

  // ── Build messages ─────────────────────────────────────────────────────
  const messages = [...rawMessages];

  // Inject GitHub files as context if present
  if (injectedFiles?.length) {
    const contextBlock = injectedFiles
      .map((f) => `<file path="${f.path}">\n${f.content}\n</file>`)
      .join("\n\n");

    const lastUserIdx = messages.length - 1;
    for (let i = lastUserIdx; i >= 0; i--) {
      if (messages[i].role === "user") {
        messages[i] = {
          ...messages[i],
          content: `<context>\n${contextBlock}\n</context>\n\n---\n\n${messages[i].content}`,
        };
        break;
      }
    }
  }

  // ── Call LLM ───────────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(type: string, data: string) {
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${data}\n\n`));
      }

      try {
        const res = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${provider.apiKey}`,
            ...(provider.baseUrl.includes("openrouter.ai")
              ? { "HTTP-Referer": "https://github.com/ORA-coding-agent", "X-Title": "ORA Coding Agent" }
              : {}),
          },
          body: JSON.stringify({
            model: resolvedModel,
            messages,
            stream: true,
            max_tokens: 16384,
            temperature: 0.3,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          send("error", JSON.stringify({ error: `Provider error (${res.status}): ${errText.slice(0, 500)}` }));
          controller.close();
          return;
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let usageData: Record<string, number> | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) send("text", JSON.stringify({ choices: [{ delta: { content: delta } }] }));
                if (parsed.usage) usageData = parsed.usage;
              } catch { /* incomplete JSON */ }
            }
          }
        }

        if (usageData) {
          send("usage", JSON.stringify({ usage: usageData }));
        }

        controller.close();
      } catch (e) {
        send("error", JSON.stringify({ error: (e as Error).message }));
        controller.close();
      }
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
