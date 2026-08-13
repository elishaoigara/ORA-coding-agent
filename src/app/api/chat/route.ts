import { NextRequest, NextResponse } from "next/server";
import { getProvider, getConfiguredProviderIds, resolveModel, type ProviderId } from "@/lib/providers";
import { routeMessage } from "@/lib/autoRouter";
import { chatRequestSchema, validateOr400 } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";

export const maxDuration = 120;

// HTTP header values must be byte-strings (Latin-1) — the Headers API throws
// if given e.g. a "→" character, which would turn a *successful* auto-routed
// response into a 500. Belt-and-suspenders: strip anything outside printable
// ASCII before it ever reaches a header, regardless of what routeMessage()
// returns.
function asciiSafe(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "");
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateOr400(chatRequestSchema, raw);
  if (parsed instanceof NextResponse) return parsed;
  const { messages: rawMessages, model, provider: providerId, injectedFiles } = parsed;

  // ── Resolve provider & model ────────────────────────────────────────────
  // Bug fix: "auto" used to fall through to getProvider("auto"), which
  // returns an empty placeholder ({ baseUrl: "", apiKey: "" }) rather than a
  // real provider — routeMessage() was defined in lib/autoRouter.ts but was
  // never actually called from here. That meant every request sent with the
  // default provider ("auto" is the app's default) tried to fetch a
  // *relative* URL ("/chat/completions") from the server, which Node's
  // fetch cannot resolve and throws on immediately — i.e. Auto mode was
  // completely non-functional out of the box. Fixed by actually invoking
  // the router and resolving it to a real, configured provider below.
  let provider;
  let routeInfo: { provider: string; model: string; reason: string } | null = null;

  try {
    if (!providerId || providerId === "auto") {
      const configured = getConfiguredProviderIds();
      const lastUserText =
        [...rawMessages].reverse().find((m) => m.role === "user")?.content ?? "";
      const decision = routeMessage(String(lastUserText ?? ""), configured);
      provider = getProvider(decision.provider);
      const routedModel = resolveModel(decision.model || provider.defaultModel, provider.id);
      routeInfo = { provider: decision.provider, model: routedModel, reason: decision.reason };
    } else {
      provider = getProvider(providerId);
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const resolvedModel = routeInfo?.model ?? resolveModel(model || provider.defaultModel, provider.id as ProviderId);

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
      let closed = false;
      function send(type: string, data: string) {
        if (closed || req.signal.aborted) return;
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${data}\n\n`));
      }
      function close() {
        if (closed) return;
        closed = true;
        controller.close();
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
          signal: req.signal,
        });

        if (!res.ok) {
          const errText = await res.text();
          send("error", JSON.stringify({ error: `Provider error (${res.status}): ${errText.slice(0, 500)}` }));
          close();
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

        close();
      } catch (e) {
        send("error", JSON.stringify({ error: (e as Error).message }));
        close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // Bug fix: the frontend has always read these three headers to show
      // the "routed to X" badge in Auto mode — they were simply never set
      // server-side, so the badge silently never appeared.
      ...(routeInfo
        ? {
            "X-Routed-Provider": asciiSafe(routeInfo.provider),
            "X-Routed-Model": asciiSafe(routeInfo.model),
            "X-Route-Reason": asciiSafe(routeInfo.reason),
          }
        : {}),
    },
  });
}
