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

    if (action === "contents") {
      const repo = searchParams.get("repo") ?? "";
      const path = searchParams.get("path") ?? "";
      const res = await fetch(
        `${GH_BASE}/repos/${repo}/contents/${path}`,
        { headers: ghHeaders() }
      );
      if (!res.ok) throw new Error(await res.text());
      return NextResponse.json(await res.json());
    }

    if (action === "file") {
      const repo = searchParams.get("repo") ?? "";
      const path = searchParams.get("path") ?? "";
      const res = await fetch(
        `${GH_BASE}/repos/${repo}/contents/${path}`,
        { headers: ghHeaders() }
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      return NextResponse.json({ content, sha: data.sha });
    }

    if (action === "read_all") {
      const repo = searchParams.get("repo") ?? "";
      const results: { path: string; content: string }[] = [];
      await readDirRecursive(repo, "", results);
      return NextResponse.json({ files: results });
    }

    if (action === "branches") {
      const repo = searchParams.get("repo") ?? "";
      const res = await fetch(
        `${GH_BASE}/repos/${repo}/branches?per_page=50`,
        { headers: ghHeaders() }
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return NextResponse.json(data.map((b: { name: string }) => b.name));
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  try {
    // ── push_many: commit multiple files ──────────────────────────────────────
    if (action === "push_many") {
      const { repo, files, message, branch } = body as {
        repo: string;
        files: { path: string; content: string }[];
        message: string;
        branch?: string;
      };

      // Resolve target branch
      const repoRes = await fetch(`${GH_BASE}/repos/${repo}`, { headers: ghHeaders() });
      if (!repoRes.ok) throw new Error(await repoRes.text());
      const repoData = await repoRes.json();
      const targetBranch = branch?.trim() || repoData.default_branch;

      // Get current commit SHA
      const refRes = await fetch(
        `${GH_BASE}/repos/${repo}/git/refs/heads/${targetBranch}`,
        { headers: ghHeaders() }
      );
      if (!refRes.ok) throw new Error(`Branch "${targetBranch}" not found: ${await refRes.text()}`);
      const refData = await refRes.json();
      const parentSha = refData.object.sha;

      // Get tree SHA for parent commit
      const parentRes = await fetch(
        `${GH_BASE}/repos/${repo}/git/commits/${parentSha}`,
        { headers: ghHeaders() }
      );
      const parentData = await parentRes.json();
      const baseTreeSha = parentData.tree.sha;

      // Build blobs
      const treeItems = await Promise.all(
        files.map(async ({ path, content }) => {
          const blobRes = await fetch(`${GH_BASE}/repos/${repo}/git/blobs`, {
            method: "POST",
            headers: { ...ghHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ content, encoding: "utf-8" }),
          });
          const blob = await blobRes.json();
          return { path, mode: "100644", type: "blob", sha: blob.sha };
        })
      );

      // Create tree
      const treeRes = await fetch(`${GH_BASE}/repos/${repo}/git/trees`, {
        method: "POST",
        headers: { ...ghHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
      });
      const treeData = await treeRes.json();

      // Create commit
      const commitRes = await fetch(`${GH_BASE}/repos/${repo}/git/commits`, {
        method: "POST",
        headers: { ...ghHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ message, tree: treeData.sha, parents: [parentSha] }),
      });
      const commitData = await commitRes.json();

      // Update ref
      const updateRes = await fetch(
        `${GH_BASE}/repos/${repo}/git/refs/heads/${targetBranch}`,
        {
          method: "PATCH",
          headers: { ...ghHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ sha: commitData.sha }),
        }
      );
      if (!updateRes.ok) throw new Error(await updateRes.text());

      const commitUrl = `https://github.com/${repo}/commit/${commitData.sha}`;
      return NextResponse.json({
        success: true,
        branch:  targetBranch,
        commit:  commitData.sha.slice(0, 7),
        url:     commitUrl,
        files:   files.map((f) => f.path),
      });
    }

    // ── create_pr: open a pull request after agent push ───────────────────────
    if (action === "create_pr") {
      const { repo, head, base, title, body: prBody } = body as {
        repo:  string;
        head:  string;   // source branch (the feature branch agent pushed to)
        base:  string;   // target branch (usually main/master)
        title: string;
        body:  string;   // PR description — we pass the agent plan here
      };

      const prRes = await fetch(`${GH_BASE}/repos/${repo}/pulls`, {
        method: "POST",
        headers: { ...ghHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ title, body: prBody, head, base }),
      });

      if (!prRes.ok) {
        const errText = await prRes.text();
        // 422 "A pull request already exists" is not a real error
        if (prRes.status === 422 && errText.includes("already exists")) {
          return NextResponse.json({ success: true, alreadyExists: true });
        }
        throw new Error(errText);
      }

      const prData = await prRes.json();
      return NextResponse.json({
        success: true,
        number:  prData.number,
        url:     prData.html_url,
        title:   prData.title,
      });
    }

    // ── create_branch: create a branch before agent execution ─────────────────
    if (action === "create_branch") {
      const { repo, branchName, fromBranch } = body as {
        repo:       string;
        branchName: string;
        fromBranch?: string;
      };

      // Resolve base branch SHA
      const repoRes = await fetch(`${GH_BASE}/repos/${repo}`, { headers: ghHeaders() });
      const repoData = await repoRes.json();
      const baseBranch = fromBranch?.trim() || repoData.default_branch;

      const refRes = await fetch(
        `${GH_BASE}/repos/${repo}/git/refs/heads/${baseBranch}`,
        { headers: ghHeaders() }
      );
      if (!refRes.ok) throw new Error(`Base branch "${baseBranch}" not found`);
      const refData = await refRes.json();
      const sha = refData.object.sha;

      const createRes = await fetch(`${GH_BASE}/repos/${repo}/git/refs`, {
        method: "POST",
        headers: { ...ghHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        if (createRes.status === 422 && errText.includes("already exists")) {
          return NextResponse.json({ success: true, alreadyExists: true, branch: branchName });
        }
        throw new Error(errText);
      }

      return NextResponse.json({ success: true, branch: branchName, from: baseBranch });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}