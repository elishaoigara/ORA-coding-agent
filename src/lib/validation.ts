// ── Request validation ────────────────────────────────────────────────────────
// Centralised zod schemas for every API route. Keeping these in one place
// means the "shape" of a valid request only has to be reasoned about once,
// and every route gets consistent, readable 400 errors instead of hitting
// an upstream provider with malformed data and getting back a confusing
// error three network calls later.
import { z } from "zod";
import { NextResponse } from "next/server";

// ── Shared primitives ─────────────────────────────────────────────────────────
export const repoSchema = z
  .string()
  .trim()
  .min(1, "Repo is required")
  .regex(/^[\w.-]+\/[\w.-]+$/, 'Repo must look like "owner/repo"');

// Deliberately loose: messages coming back from an LLM (assistant turns with
// tool_calls, tool turns with tool_call_id, etc.) have several optional
// OpenAI-specific fields we don't want to hand-model here. We only assert the
// couple of things that actually matter for our own logic downstream.
export const messageSchema = z
  .object({
    role: z.enum(["user", "assistant", "system", "tool"]),
    content: z.union([z.string(), z.null()]).optional(),
  })
  .passthrough();

export const injectedFileSchema = z.object({
  path: z.string().min(1).max(1000),
  content: z.string().max(2_000_000, "File too large to inject (max ~2MB)"),
});

// ── /api/chat ──────────────────────────────────────────────────────────────
export const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1, "No messages provided"),
  model: z.string().max(200).optional(),
  provider: z.string().max(50).optional(),
  injectedFiles: z.array(injectedFileSchema).max(300, "Too many injected files").optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

// ── /api/agent ─────────────────────────────────────────────────────────────
const agentPlanChangeSchema = z.object({
  action: z.enum(["create", "modify", "delete"]),
  path: z.string().min(1),
  reason: z.string().default(""),
  details: z.string().default(""),
});

const agentPlanSchema = z.object({
  summary: z.string().default(""),
  approach: z.string().default(""),
  changes: z.array(agentPlanChangeSchema).default([]),
});

export const agentRequestSchema = z.object({
  task: z.string().trim().min(1, "Task is required").max(20_000, "Task description is too long"),
  repo: repoSchema,
  provider: z.string().max(50).optional(),
  model: z.string().max(200).optional(),
  phase: z.enum(["plan", "execute"]),
  plan: agentPlanSchema.optional(),
  resumeMessages: z.array(z.unknown()).max(500).optional(),
  resumeStagedFiles: z.array(z.unknown()).max(500).optional(),
});
export type AgentRequest = z.infer<typeof agentRequestSchema>;

// ── /api/github ────────────────────────────────────────────────────────────
const pushFileSchema = z.object({
  path: z.string().min(1).max(1000),
  content: z.union([z.string().max(5_000_000), z.null()]),
  action: z.enum(["create", "modify", "delete"]).optional(),
});

export const githubRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_branches"), repo: repoSchema }),
  z.object({
    action: z.literal("create_branch"),
    repo: repoSchema,
    branchName: z.string().trim().min(1, "branchName is required").max(250),
  }),
  z.object({
    action: z.literal("list_files"),
    repo: repoSchema,
    path: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal("file"),
    repo: repoSchema,
    path: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal("push_many"),
    repo: repoSchema,
    files: z.array(pushFileSchema).min(1, "No files provided").max(200, "Too many files in one push"),
    message: z.string().max(2000).optional(),
    branch: z.string().max(250).optional(),
  }),
]);
export type GithubRequest = z.infer<typeof githubRequestSchema>;

// ── /api/conversations ─────────────────────────────────────────────────────
export const conversationSchema = z
  .object({
    id: z.string().min(1),
    updatedAt: z.number(),
  })
  .passthrough(); // title, messages, provider, githubContext, etc. — loose on purpose

export const conversationsSyncSchema = z.object({
  conversations: z.array(conversationSchema).max(5000),
  gistId: z.string().max(200).optional(),
});
export type ConversationsSyncRequest = z.infer<typeof conversationsSyncSchema>;

// ── Helper: parse-or-400 ──────────────────────────────────────────────────────
/**
 * Parses `raw` against `schema`. Returns the typed data on success, or a
 * ready-to-return NextResponse (400, with a readable message) on failure —
 * so a route can just do:
 *
 *   const parsed = validateOr400(agentRequestSchema, await req.json());
 *   if (parsed instanceof NextResponse) return parsed;
 *   const { task, repo, phase } = parsed;
 *
 * Implementation note: this infers the *schema* type parameter (constrained
 * to extend z.ZodType) and derives the return type via `z.infer<S>`, rather
 * than trying to infer the output type directly through a bare
 * `z.ZodType<T>` parameter position. The latter is more common in examples
 * but loses precision for schemas that mix `.optional()` with `.default()`
 * on nested objects — fields silently widen back to optional even though
 * `.default()` guarantees they're always present after a successful parse.
 */
export function validateOr400<S extends z.ZodType>(
  schema: S,
  raw: unknown
): z.infer<S> | NextResponse {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.length ? ` (${first.path.join(".")})` : "";
    return NextResponse.json(
      { error: `Invalid request${path}: ${first?.message ?? "validation failed"}` },
      { status: 400 }
    );
  }
  return result.data as z.infer<S>;
}
