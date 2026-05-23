import { NextRequest, NextResponse } from "next/server";

const GH_BASE = "https://api.github.com";

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".vercel", "coverage", "__pycache__", ".venv", "venv"]);
const SKIP_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".mp4", ".mp3", ".pdf", ".zip", ".woff", ".woff2", ".ttf", ".eot", ".lock", ".lockb"]);

function ghHeaders() {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error("GITHUB_PAT is not set in .env.local");
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// Extracted as a top-level async arrow to avoid "function inside block" TS error
const readDirRecursive = async (
  repo: string,
  dirPath: string,
  results: { path: string; content: string }[]
): Promise<void> => {
  const res = await fetch(
    `${GH_BASE}/repos/${repo}/contents/${dirPath}`,
    { headers: ghHeaders() }
  );
  if (!res.ok) return;
  const items = await res.json();
  if (!Array.isArray(items)) return;

  await Promise.all(
    items.map(async (item: { type: string; name: string; path: string }) => {
      if (item.type === "dir") {
        if (SKIP_DIRS.has(item.name)) return;
        await readDirRecursive(repo, item.path, results);
      } else if (item.type === "file") {
        const ext = "." + item.name.split(".").pop()?.toLowerCase();
        if (SKIP_EXTS.has(ext)) return;
        const fileRes = await fetch(
          `${GH_BASE}/repos/${repo}/contents/${item.path}`,
          { headers: ghHeaders() }
        );
        if (!fileRes.ok) return;
        const fileData = await fileRes.json();
        if (!fileData.content) return;
        try {
          const content = Buffer.from(fileData.content, "base64").toString("utf-8");
          results.push({ path: item.path, content });
        } catch {
          // Binary file — skip
        }
      }
    })
  );
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const action = searchParams.get("action");

  try {
    if (action === "repos") {
      const res = await fetch(
        `${GH_BASE}/user/repos?sort=pushed&per_page=50&type=all`,
        { headers: ghHeaders() }
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return NextResponse.json(
        data.map((r: Record<string, unknown>) => ({
          name: r.name,
          full_name: r.full_name,
          description: r.description,
          private: r.private,
          default_branch: r.default_branch,
        }))
      );
    }

    if (action === "tree") {
      const repo = searchParams.get("repo");
      const path = searchParams.get("path") ?? "";
      if (!repo) return NextResponse.json({ error: "Missing repo" }, { status: 400 });
      const res = await fetch(`${GH_BASE}/repos/${repo}/contents/${path}`, { headers: ghHeaders() });
      if (!res.ok) throw new Error(await res.text());
      return NextResponse.json(await res.json());
    }

    if (action === "file") {
      const repo = searchParams.get("repo");
      const path = searchParams.get("path");
      if (!repo || !path) return NextResponse.json({ error: "Missing repo or path" }, { status: 400 });
      const res = await fetch(`${GH_BASE}/repos/${repo}/contents/${path}`, { headers: ghHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      return NextResponse.json({ path, content, sha: data.sha });
    }

    if (action === "folder") {
      const repo = searchParams.get("repo");
      const folderPath = searchParams.get("path") ?? "";
      if (!repo) return NextResponse.json({ error: "Missing repo" }, { status: 400 });
      const results: { path: string; content: string }[] = [];
      await readDirRecursive(repo, folderPath, results);
      return NextResponse.json({ files: results, count: results.length });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
