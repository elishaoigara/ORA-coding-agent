import { NextRequest, NextResponse } from "next/server";
import { githubRequestSchema, validateOr400 } from "@/lib/validation";
import { requireAuth } from "@/lib/auth";

const GH_BASE = "https://api.github.com";

function ghHeaders(pat: string) {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function contentUrl(repo: string, path: string, ref?: string): string {
  const encodedPath = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const url = new URL(`${GH_BASE}/repos/${repo}/contents${encodedPath ? `/${encodedPath}` : ""}`);
  if (ref) url.searchParams.set("ref", ref);
  return url.toString();
}

export async function GET(req: NextRequest) {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;

  const pat = process.env.GITHUB_PAT;
  if (!pat) return NextResponse.json({ error: "GITHUB_PAT not set" }, { status: 500 });

  const headers = ghHeaders(pat);
  const action = req.nextUrl.searchParams.get("action");

  if (action === "repos") {
    try {
      const res = await fetch(`${GH_BASE}/user/repos?per_page=100&sort=updated`, { headers });
      if (!res.ok) return NextResponse.json({ error: `GitHub error: ${res.status}` });
      const data = await res.json();
      return NextResponse.json(
        data.map((r: { name: string; full_name: string; private: boolean; description: string | null }) => ({
          name: r.name,
          full_name: r.full_name,
          private: r.private,
          description: r.description,
        }))
      );
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;

  const pat = process.env.GITHUB_PAT;
  if (!pat) return NextResponse.json({ error: "GITHUB_PAT not set" }, { status: 500 });

  const headers = ghHeaders(pat);
  let raw: unknown;

  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateOr400(githubRequestSchema, raw);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed as Record<string, unknown> & { action: string; repo: string };
  const { action, repo } = body;

  try {
    // ── List branches ──────────────────────────────────────────────────────
    if (action === "list_branches") {
      const res = await fetch(`${GH_BASE}/repos/${repo}/branches?per_page=100`, { headers });
      if (!res.ok) return NextResponse.json({ error: `GitHub error: ${res.status}` });
      const data = await res.json();
      return NextResponse.json(data.map((b: { name: string }) => b.name));
    }

    // ── Create branch ──────────────────────────────────────────────────────
    if (action === "create_branch") {
      const branchName = body.branchName as string;
      if (!branchName) return NextResponse.json({ error: "Missing branchName" }, { status: 400 });

      const repoInfo = await fetch(`${GH_BASE}/repos/${repo}`, { headers });
      if (!repoInfo.ok) {
        return NextResponse.json({ error: "Cannot determine the default branch" }, { status: 502 });
      }
      const { default_branch: sourceBranch } = (await repoInfo.json()) as {
        default_branch: string;
      };
      const refRes = await fetch(
        `${GH_BASE}/repos/${repo}/git/ref/heads/${sourceBranch}`,
        { headers }
      );
      if (!refRes.ok) {
        return NextResponse.json({ error: "Cannot read the default branch ref" }, { status: 502 });
      }
      const refData = (await refRes.json()) as { object: { sha: string } };
      const sha = refData.object.sha;

      const createRes = await fetch(`${GH_BASE}/repos/${repo}/git/refs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
      });

      if (!createRes.ok) {
        const errData = await createRes.json();
        if (errData.errors?.[0]?.code === "ReferenceCreationError") {
          return NextResponse.json({ success: true, branch: branchName, note: "Already exists" });
        }
        return NextResponse.json({ error: `Failed to create branch: ${JSON.stringify(errData)}` }, { status: 500 });
      }

      return NextResponse.json({ success: true, branch: branchName, source: sourceBranch, sha });
    }

    // ── List files in a directory ──────────────────────────────────────────
    if (action === "list_files") {
      const path = (body.path as string) ?? "";
      const res = await fetch(contentUrl(repo, path), { headers });
      if (!res.ok) {
        if (res.status === 404) return NextResponse.json({ error: "Path not found" }, { status: 404 });
        return NextResponse.json({ error: `GitHub error: ${res.status}` });
      }
      const data = await res.json();
      if (!Array.isArray(data)) return NextResponse.json([data]);
      return NextResponse.json(
        data.map((i: { name: string; path: string; type: string; size?: number }) => ({
          name: i.name, path: i.path, type: i.type, size: i.size,
        }))
      );
    }

    // ── Get file content ───────────────────────────────────────────────────
    if (action === "file") {
      const path = (body.path as string) ?? "";
      const res = await fetch(contentUrl(repo, path), { headers });
      if (!res.ok) {
        if (res.status === 404) return NextResponse.json({ error: "File not found" }, { status: 404 });
        return NextResponse.json({ error: `GitHub error: ${res.status}` });
      }
      const data = await res.json();
      if (!data.content) return NextResponse.json({ error: "Empty or binary file" });
      return NextResponse.json({
        path: data.path,
        content: Buffer.from(data.content, "base64").toString("utf-8"),
        size: data.size,
        sha: data.sha,
      });
    }

    // ── Push many files (blobs -> tree -> commit -> update ref) ────────────
    if (action === "push_many") {
      const files = body.files as { path: string; content: string | null; action?: string }[];
      const message = (body.message as string) ?? "feat: AI agent changes";
      const branch = (body.branch as string) ?? undefined;

      if (!files || !files.length) {
        return NextResponse.json({ error: "No files provided" }, { status: 400 });
      }

      // Determine branch to push to
      let targetBranch: string;
      if (branch) {
        targetBranch = branch;
        // Ensure branch exists
        const branchCheck = await fetch(`${GH_BASE}/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { headers });
        if (!branchCheck.ok) {
          return NextResponse.json({ error: `Branch "${branch}" does not exist. Create it first.` }, { status: 400 });
        }
      } else {
        // Get default branch
        const repoInfo = await fetch(`${GH_BASE}/repos/${repo}`, { headers });
        if (!repoInfo.ok) return NextResponse.json({ error: "Cannot fetch repo info" }, { status: 500 });
        const repoData = await repoInfo.json();
        targetBranch = repoData.default_branch;
      }

      // Get the current HEAD commit SHA for the branch
      const refRes = await fetch(`${GH_BASE}/repos/${repo}/git/refs/heads/${encodeURIComponent(targetBranch)}`, { headers });
      if (!refRes.ok) {
        return NextResponse.json({ error: `Cannot get ref for ${targetBranch}: ${refRes.status}` }, { status: 500 });
      }
      const refData = await refRes.json();
      const headSha: string = refData.object.sha;
      const headCommitRes = await fetch(`${GH_BASE}/repos/${repo}/git/commits/${headSha}`, { headers });
      if (!headCommitRes.ok) {
        return NextResponse.json({ error: "Cannot read the branch head commit" }, { status: 502 });
      }
      const headCommit = (await headCommitRes.json()) as { tree: { sha: string } };
      const baseTreeSha = headCommit.tree.sha;

      // Create blobs for files with content, handle deletions
      const treeEntries: Array<{
        path: string;
        mode: "100644";
        type: "blob";
        sha: string | null;
      }> = [];

      for (const file of files) {
        if (file.content === null || file.action === "delete") {
          // Deletion: first get the file's current SHA from the tree
          const existingRes = await fetch(contentUrl(repo, file.path, targetBranch), { headers });
          if (existingRes.ok) {
            treeEntries.push({
              path: file.path,
              mode: "100644",
              type: "blob",
              sha: null,
            });
          }
          // If file doesn't exist, skip it silently
          continue;
        }

        // Create blob for the file content
        const blobRes = await fetch(`${GH_BASE}/repos/${repo}/git/blobs`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            content: file.content,
            encoding: "utf-8",
          }),
        });

        if (!blobRes.ok) {
          const errText = await blobRes.text();
          return NextResponse.json({
            error: `Failed to create blob for ${file.path}: ${errText}`,
          }, { status: 500 });
        }

        const blobData = await blobRes.json();
        treeEntries.push({
          path: file.path,
          mode: "100644",
          type: "blob",
          sha: blobData.sha,
        });
      }

      if (treeEntries.length === 0) {
        return NextResponse.json({ error: "No changes to push (all files were deletions of non-existent files?)" }, { status: 400 });
      }

      // Create tree
      const treeRes = await fetch(`${GH_BASE}/repos/${repo}/git/trees`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeEntries,
        }),
      });

      if (!treeRes.ok) {
        const errText = await treeRes.text();
        return NextResponse.json({ error: `Failed to create tree: ${errText}` }, { status: 500 });
      }

      const treeData = await treeRes.json();
      const treeSha: string = treeData.sha;

      // Create commit
      const commitRes = await fetch(`${GH_BASE}/repos/${repo}/git/commits`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message,
          tree: treeSha,
          parents: [headSha],
        }),
      });

      if (!commitRes.ok) {
        const errText = await commitRes.text();
        return NextResponse.json({ error: `Failed to create commit: ${errText}` }, { status: 500 });
      }

      const commitData = await commitRes.json();
      const commitSha: string = commitData.sha;

      // Update ref (fast-forward)
      const patchRes = await fetch(`${GH_BASE}/repos/${repo}/git/refs/heads/${encodeURIComponent(targetBranch)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ sha: commitSha, force: false }),
      });

      if (!patchRes.ok) {
        const errText = await patchRes.text();
        return NextResponse.json({
          error: `Failed to update ref: ${errText}`,
          commit: commitSha,
          tree: treeSha,
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        commit: commitSha.slice(0, 7),
        branch: targetBranch,
        changedFiles: files.filter((f) => f.content !== null && f.action !== "delete").length,
        deletions: files.filter((f) => f.content === null || f.action === "delete").length,
        url: `https://github.com/${repo}/commit/${commitSha}`,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}