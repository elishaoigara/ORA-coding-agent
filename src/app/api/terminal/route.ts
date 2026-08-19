import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  createTerminalSession,
  executeTerminalCommand,
  applyWorkspacePatches,
  getTerminalSession,
  listVerificationSteps,
  runVerification,
  stopTerminalSession,
  type TerminalEvent,
} from "@/lib/terminalRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function encodeEvent(type: string, payload: Record<string, unknown>) {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}

function parseBody(request: NextRequest) {
  return request.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  return Response.json({ verificationSteps: listVerificationSteps() });
}

export async function POST(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await parseBody(request);
  const action = typeof body.action === "string" ? body.action : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";

  if (action === "stop") {
    if (!sessionId) return Response.json({ error: "sessionId is required" }, { status: 400 });
    const stopped = await stopTerminalSession(sessionId);
    return Response.json({ stopped });
  }

  if (action === "status") {
    const session = getTerminalSession(sessionId);
    return session ? Response.json({ session: { ...session, process: undefined } }) : Response.json({ error: "Session not found" }, { status: 404 });
  }

  if (!["start", "exec", "verify", "apply"].includes(action)) {
    return Response.json({ error: "Unsupported terminal action" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (type: string, payload: Record<string, unknown>) => {
        if (!closed) controller.enqueue(encoder.encode(encodeEvent(type, payload)));
      };
      const onEvent = (event: TerminalEvent) => send("terminal", event as unknown as Record<string, unknown>);
      try {
        if (action === "start") {
          const repo = typeof body.repo === "string" ? body.repo : "";
          const branch = typeof body.branch === "string" ? body.branch : undefined;
          const session = await createTerminalSession(repo, branch, onEvent);
          send("session", { session: { ...session, process: undefined } });
        } else if (action === "exec") {
          if (!sessionId) throw new Error("sessionId is required");
          const command = typeof body.command === "string" ? body.command : "";
          const exitCode = await executeTerminalCommand(sessionId, command, onEvent);
          send("command_done", { exitCode });
        } else if (action === "apply") {
          if (!sessionId) throw new Error("sessionId is required");
          const patches = Array.isArray(body.patches) ? body.patches : [];
          const applied = await applyWorkspacePatches(sessionId, patches as Array<{ path: string; content: string; action?: "create" | "modify" | "delete" }>, onEvent);
          send("patches_applied", { applied });
        } else {
          if (!sessionId) throw new Error("sessionId is required");
          const result = await runVerification(sessionId, onEvent);
          send("verification_done", result as unknown as Record<string, unknown>);
        }
        send("done", { action });
      } catch (error) {
        send("error", { text: error instanceof Error ? error.message : "Terminal operation failed" });
      } finally {
        closed = true;
        controller.close();
      }
    },
    cancel() { closed = true; },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
