/**
 * /api/conversations — GitHub Gist-backed cross-device history sync
 *
 * Uses GITHUB_PAT (needs the `gist` OAuth scope in addition to `repo`).
 * If the token is missing the route returns empty data gracefully so the
 * app still works with local-only storage.
 *
 * GET  ?gistId=<id>   → { conversations: Conversation[], gistId: string | null }
 * POST { conversations, gistId } → { gistId: string | null }
 */

import { NextRequest, NextResponse } from "next/server";

const PAT              = process.env.GITHUB_PAT ?? "";
const GIST_DESCRIPTION = "ORA Coding Agent – conversation history";
const GIST_FILENAME    = "conversations.json";

const ghHeaders = () => ({
  Authorization:          `Bearer ${PAT}`,
  Accept:                 "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type":         "application/json",
});

export async function GET(req: NextRequest) {
  if (!PAT) return NextResponse.json({ conversations: [], gistId: null });

  const gistId = req.nextUrl.searchParams.get("gistId");

  try {
    if (gistId) {
      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: ghHeaders(),
        next: { revalidate: 10 },
      });
      if (res.ok) {
        const gist = await res.json();
        const raw  = gist.files?.[GIST_FILENAME]?.content ?? "[]";
        return NextResponse.json({ conversations: safeParseArray(raw), gistId });
      }
    }

    // Slow path: discover gist by description (first load on a new device)
    const listRes = await fetch("https://api.github.com/gists?per_page=100", {
      headers: ghHeaders(),
    });
    if (!listRes.ok) return NextResponse.json({ conversations: [], gistId: null });

    const gists = await listRes.json() as Array<{ id: string; description: string }>;
    const found = gists.find((g) => g.description === GIST_DESCRIPTION);
    if (!found) return NextResponse.json({ conversations: [], gistId: null });

    const fullRes = await fetch(`https://api.github.com/gists/${found.id}`, {
      headers: ghHeaders(),
    });
    if (!fullRes.ok) return NextResponse.json({ conversations: [], gistId: null });

    const fullGist = await fullRes.json();
    const raw      = fullGist.files?.[GIST_FILENAME]?.content ?? "[]";
    return NextResponse.json({ conversations: safeParseArray(raw), gistId: found.id });

  } catch {
    return NextResponse.json({ conversations: [], gistId: null });
  }
}

export async function POST(req: NextRequest) {
  if (!PAT) return NextResponse.json({ gistId: null });

  let body: { conversations: unknown; gistId?: string | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { conversations, gistId } = body;
  const content = JSON.stringify(conversations, null, 2);

  try {
    if (gistId) {
      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        method:  "PATCH",
        headers: ghHeaders(),
        body:    JSON.stringify({ files: { [GIST_FILENAME]: { content } } }),
      });
      if (res.ok) return NextResponse.json({ gistId });
    }

    const res = await fetch("https://api.github.com/gists", {
      method:  "POST",
      headers: ghHeaders(),
      body:    JSON.stringify({
        description: GIST_DESCRIPTION,
        public:      false,
        files:       { [GIST_FILENAME]: { content } },
      }),
    });

    if (!res.ok) return NextResponse.json({ gistId: null });
    const newGist = await res.json();
    return NextResponse.json({ gistId: newGist.id });

  } catch {
    return NextResponse.json({ gistId: null });
  }
}

function safeParseArray(raw: string): unknown[] {
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; }
  catch { return []; }
}