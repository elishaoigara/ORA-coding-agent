/**
 * /api/conversations — GitHub Gist-backed cross-device history sync
 *
 * Uses GITHUB_PAT (needs the `gist` OAuth scope in addition to `repo`).
 * If the token is missing the route returns empty data gracefully so the
 * app still works with local-only storage.
 *
 * GET  ?gistId=<id>   → { conversations, gistId, syncedAt, configured }
 * POST { conversations, gistId } → { gistId, syncedAt, conversations }
 *
 * Cross-device sync strategy:
 * - Every POST reads the current gist content, merges by updatedAt
 *   (last-write-wins per conversation ID), then writes back.
 *   This prevents Device A from overwriting Device B's newer entries.
 * - GET always returns the canonical merged array from the gist.
 * - Client stores gistId in localStorage; new devices discover it via
 *   description search so no manual ID sharing is needed.
 */

import { NextRequest, NextResponse } from "next/server";

const PAT              = process.env.GITHUB_PAT ?? "";
const GIST_DESCRIPTION = "ORA Coding Agent – conversation history";
const GIST_FILENAME    = "conversations.json";
const CACHE_TTL        = 5; // seconds for Next.js fetch cache

const ghHeaders = () => ({
  Authorization:          `Bearer ${PAT}`,
  Accept:                 "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type":         "application/json",
});

// ── Types ─────────────────────────────────────────────────────────────────────
interface StoredConversation {
  id: string;
  updatedAt: number;
  [key: string]: unknown;
}

type GistResponse = {
  id: string;
  files: Record<string, { content: string }>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeParseArray(raw: string): StoredConversation[] {
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? (p as StoredConversation[]) : [];
  } catch {
    return [];
  }
}

/**
 * Merge two arrays by ID, keeping the entry with the higher updatedAt.
 * Sorted newest-first so history sidebar always shows the right order.
 */
function mergeConversations(
  existing: StoredConversation[],
  incoming: StoredConversation[],
): StoredConversation[] {
  const map = new Map<string, StoredConversation>();
  for (const c of existing) map.set(c.id, c);
  for (const c of incoming) {
    const prev = map.get(c.id);
    if (!prev || c.updatedAt > prev.updatedAt) map.set(c.id, c);
  }
  return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

async function fetchGist(id: string): Promise<GistResponse | null> {
  try {
    const res = await fetch(`https://api.github.com/gists/${id}`, {
      headers: ghHeaders(),
      next: { revalidate: CACHE_TTL },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function discoverGistId(): Promise<string | null> {
  try {
    const res = await fetch("https://api.github.com/gists?per_page=100", {
      headers: ghHeaders(),
    });
    if (!res.ok) return null;
    const gists = (await res.json()) as Array<{ id: string; description: string }>;
    return gists.find((g) => g.description === GIST_DESCRIPTION)?.id ?? null;
  } catch {
    return null;
  }
}

async function patchGist(id: string, merged: StoredConversation[]): Promise<boolean> {
  try {
    const res = await fetch(`https://api.github.com/gists/${id}`, {
      method:  "PATCH",
      headers: ghHeaders(),
      body:    JSON.stringify({
        files: { [GIST_FILENAME]: { content: JSON.stringify(merged, null, 2) } },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!PAT) {
    return NextResponse.json({
      conversations: [],
      gistId:        null,
      syncedAt:      null,
      configured:    false,
    });
  }

  const paramGistId = req.nextUrl.searchParams.get("gistId");

  let gistId: string | null = paramGistId;
  let gist: GistResponse | null = null;

  // Fast path — we already know the gist ID
  if (gistId) {
    gist = await fetchGist(gistId);
    if (!gist) gistId = null; // stale — fall through to discovery
  }

  // Slow path — first visit on a new device
  if (!gist) {
    gistId = await discoverGistId();
    if (gistId) gist = await fetchGist(gistId);
  }

  if (!gist || !gistId) {
    return NextResponse.json({
      conversations: [],
      gistId:        null,
      syncedAt:      null,
      configured:    true,
    });
  }

  const raw           = gist.files?.[GIST_FILENAME]?.content ?? "[]";
  const conversations = safeParseArray(raw);

  return NextResponse.json({
    conversations,
    gistId,
    syncedAt:   Date.now(),
    configured: true,
  });
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!PAT) return NextResponse.json({ gistId: null, syncedAt: null });

  let body: { conversations: StoredConversation[]; gistId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { conversations: incoming, gistId: bodyGistId } = body;
  if (!Array.isArray(incoming)) {
    return NextResponse.json({ error: "conversations must be an array" }, { status: 400 });
  }

  let gistId: string | null = bodyGistId ?? null;

  // ── Try to patch existing gist (with read-then-merge) ──────────────────────
  if (gistId) {
    const existing = await fetchGist(gistId);
    if (existing) {
      const raw    = existing.files?.[GIST_FILENAME]?.content ?? "[]";
      const merged = mergeConversations(safeParseArray(raw), incoming);
      const ok     = await patchGist(gistId, merged);
      if (ok) return NextResponse.json({ gistId, syncedAt: Date.now(), conversations: merged });
    }
    // Gist was deleted — fall through to recreate
    gistId = null;
  }

  // ── Discover an existing gist (another device created it) ─────────────────
  if (!gistId) {
    gistId = await discoverGistId();
    if (gistId) {
      const existing = await fetchGist(gistId);
      if (existing) {
        const raw    = existing.files?.[GIST_FILENAME]?.content ?? "[]";
        const merged = mergeConversations(safeParseArray(raw), incoming);
        const ok     = await patchGist(gistId, merged);
        if (ok) return NextResponse.json({ gistId, syncedAt: Date.now(), conversations: merged });
      }
    }
  }

  // ── Create a brand-new gist ────────────────────────────────────────────────
  try {
    const res = await fetch("https://api.github.com/gists", {
      method:  "POST",
      headers: ghHeaders(),
      body:    JSON.stringify({
        description: GIST_DESCRIPTION,
        public:      false,
        files:       { [GIST_FILENAME]: { content: JSON.stringify(incoming, null, 2) } },
      }),
    });
    if (!res.ok) return NextResponse.json({ gistId: null, syncedAt: null });
    const newGist = await res.json();
    return NextResponse.json({
      gistId:        newGist.id,
      syncedAt:      Date.now(),
      conversations: incoming,
    });
  } catch {
    return NextResponse.json({ gistId: null, syncedAt: null });
  }
}