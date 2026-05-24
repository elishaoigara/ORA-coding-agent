import { NextRequest, NextResponse } from "next/server";

const GH_BASE = "https://api.github.com";

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build",
  ".vercel", "coverage", "__pycache__", ".venv", "venv",
]);
const SKIP_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
  ".mp4", ".mp3", ".pdf", ".zip", ".woff", ".woff2", ".ttf",
  ".eot", ".lock", ".lockb",
]);

function ghHeaders() {
  const pat = process.env.GITHUB_PAT;
  if (!pat) throw new Error("GITHUB_PAT is not set in .env.local");
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

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
        } catch { /* binary — skip */ }
      }
    })
  );
};

// ── GET ───────────────────────────────────────────────────────────────────────
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
      const res = await fetch(
        `${GH_BASE}/repos/${repo}/contents/${path}`,
        { headers: ghHeaders() }
      );
      if (!res.ok) throw new Error(await res.text());
      return NextResponse.json(await res.json());
    }

    if (action === "file") {
      const repo = searchParams.get("repo");
      const path = searchParams.get("path");
      if (!repo || !path)
        return NextResponse.json({ error: "Missing repo or path" }, { status: 400 });
      const res = await fetch(
        `${GH_BASE}/repos/${repo}/contents/${path}`,
        { headers: ghHeaders() }
      );
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

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, repo, files, message, branch } = body;

    if (action !== "push_many") {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
    if (!repo || !files?.length || !message) {
      return NextResponse.json(
        { error: "Missing repo, files, or message" },
        { status: 400 }
      );
    }

    const headers = ghHeaders();

    // 1. Get repo info to find default branch
    const repoRes = await fetch(`${GH_BASE}/repos/${repo}`, { headers });
    if (!repoRes.ok)
      throw new Error(`Could not fetch repo info: ${await repoRes.text()}`);
    const repoData = await repoRes.json();
    const targetBranch: string = branch?.trim() || repoData.default_branch;

    // 2. Get the current HEAD commit SHA for the branch
    // FIX: was /git/ref/heads/ (wrong — 404 every time)
    //      now  /git/refs/heads/ (correct GitHub API endpoint)
    const refRes = await fetch(
      `${GH_BASE}/repos/${repo}/git/refs/heads/${targetBranch}`,
      { headers }
    );
    if (!refRes.ok)
      throw new Error(`Could not get branch ref for "${targetBranch}": ${await refRes.text()}`);
    const refData = await refRes.json();
    const baseCommitSha: string = refData.object.sha;

    // 3. Get the base tree SHA from that commit
    const commitRes = await fetch(
      `${GH_BASE}/repos/${repo}/git/commits/${baseCommitSha}`,
      { headers }
    );
    if (!commitRes.ok)
      throw new Error(`Could not get base commit: ${await commitRes.text()}`);
    const commitData = await commitRes.json();
    const baseTreeSha: string = commitData.tree.sha;

    // 4. Create a blob for each file
    const treeItems = await Promise.all(
      (files as { path: string; content: string }[]).map(async (f) => {
        const blobRes = await fetch(`${GH_BASE}/repos/${repo}/git/blobs`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ content: f.content, encoding: "utf-8" }),
        });
        if (!blobRes.ok)
          throw new Error(`Could not create blob for ${f.path}: ${await blobRes.text()}`);
        const blob = await blobRes.json();
        return { path: f.path, mode: "100644", type: "blob", sha: blob.sha };
      })
    );

    // 5. Create a new tree on top of the base tree
    const treeRes = await fetch(`${GH_BASE}/repos/${repo}/git/trees`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
    });
    if (!treeRes.ok)
      throw new Error(`Could not create tree: ${await treeRes.text()}`);
    const newTree = await treeRes.json();

    // 6. Create the commit
    const newCommitRes = await fetch(`${GH_BASE}/repos/${repo}/git/commits`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        tree: newTree.sha,
        parents: [baseCommitSha],
      }),
    });
    if (!newCommitRes.ok)
      throw new Error(`Could not create commit: ${await newCommitRes.text()}`);
    const newCommit = await newCommitRes.json();

    // 7. Advance the branch ref to the new commit
    const updateRes = await fetch(
      `${GH_BASE}/repos/${repo}/git/refs/heads/${targetBranch}`,
      {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ sha: newCommit.sha }),
      }
    );
    if (!updateRes.ok)
      throw new Error(`Could not update branch ref: ${await updateRes.text()}`);

    return NextResponse.json({
      success: true,
      branch: targetBranch,
      commit: newCommit.sha.slice(0, 7),
      files: (files as { path: string }[]).map((f) => f.path),
      url: `https://github.com/${repo}/commit/${newCommit.sha}`,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}