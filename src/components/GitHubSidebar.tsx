"use client";

import { useState, useEffect, useCallback } from "react";
import type { InjectedFile, GitHubContext } from "@/types";
import { useDebouncedValue } from "@/lib/useDebounce";

// ── TokenBar with configurable limit ──────────────────────────────────────────
function TokenBar({ tokens, limit }: { tokens: number; limit?: number }) {
  const effectiveLimit = limit ?? 128000;
  const pct = Math.min(100, (tokens / effectiveLimit) * 100);
  const color =
    pct > 90 ? "bg-red-500" :
    pct > 70 ? "bg-amber-500" :
    pct > 40 ? "bg-teal-500" : "bg-violet-500";
  return (
    <div className="px-4 py-2 border-t border-zinc-800 light:border-[#e5ded1]">
      <div className="flex justify-between text-xs text-zinc-500 light:text-[#8a7f6d] mb-1">
        <span>Tokens</span>
        <span>{tokens.toLocaleString()} / {effectiveLimit.toLocaleString()} ({pct.toFixed(0)}%)</span>
      </div>
      <div className="h-1.5 bg-zinc-800 light:bg-[#efe9dd] rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface Props {
  onFilesChange: (files: InjectedFile[], repo: string) => void;
  savedContext?: GitHubContext;
  pinnedFiles?: Record<string, string[]>;
  onTogglePinnedFile?: (repo: string, path: string) => void;
  contextWindow?: number;
}

export default function GitHubSidebar({
  onFilesChange,
  savedContext,
  pinnedFiles,
  onTogglePinnedFile,
  contextWindow,
}: Props) {
  const [repo, setRepo]             = useState(savedContext?.repo ?? "");
  const [repos, setRepos]           = useState<Array<{ name: string; full_name: string; private: boolean; description: string | null }>>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [repoSearch, setRepoSearch] = useState("");
  const [files, setFiles]           = useState<InjectedFile[]>(savedContext?.files ?? []);
  const [error, setError]           = useState("");
  const [activeTab, setActiveTab]   = useState<"browse" | "pinned">("browse");

  // ── Token estimator ──────────────────────────────────────────────────
  function estimateTokens(files: InjectedFile[]): number {
    const totalChars = files.reduce((s, f) => s + f.content.length, 0);
    return Math.round(totalChars / 4);
  }

  // ── Load repo list on mount ───────────────────────────────────────────
  useEffect(() => {
    fetch("/api/github?action=repos")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setRepos(data);
      })
      .catch(() => setError("Could not load repos. Check GITHUB_PAT."))
      .finally(() => setReposLoading(false));
  }, []);

  // ── Auto-load saved context ──────────────────────────────────────────
  useEffect(() => {
    if (savedContext) {
      setRepo(savedContext.repo);
      setFiles(savedContext.files);
    }
  }, [savedContext]);

  // ── Fetch file content ───────────────────────────────────────────────
  async function fetchFileContent(filePath: string): Promise<string | null> {
    try {
      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "file", repo, path: filePath }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.content ?? null;
    } catch { return null; }
  }

  // ── Load files from a path ───────────────────────────────────────────
  async function loadDirectory(dirPath: string) {
    setError("");
    try {
      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_files", repo, path: dirPath }),
      });
      if (!res.ok) { setError("Cannot list directory"); return []; }
      return await res.json();
    } catch {
      setError("Network error");
      return [];
    }
  }

  // ── Inject a single file ─────────────────────────────────────────────
  async function injectFile(filePath: string) {
    if (files.some((f) => f.path === filePath)) return;
    const content = await fetchFileContent(filePath);
    if (content === null) { setError("Cannot read file"); return; }
    const updated = [...files, { path: filePath, content }];
    setFiles(updated);
    onFilesChange(updated, repo);
  }

  // ── Inject entire directory ──────────────────────────────────────────
  async function injectDir(dirPath: string) {
    setBrowseLoading(true);
    setError("");

    try {
      const items = await loadDirectory(dirPath);
      if (!Array.isArray(items)) { setBrowseLoading(false); return; }

      const updated: InjectedFile[] = [...files];
      const existingPaths = new Set(updated.map((f) => f.path));
      let totalChars = updated.reduce((s, f) => s + f.content.length, 0);
      const MAX_CHARS = 2_000_000;

      // Check if repo is too large before proceeding
      const fileItems = items.filter((i: { type: string }) => i.type === "file");
      if (fileItems.length > 100) {
        const confirm = window.confirm(
          `This will inject up to ${fileItems.length} files (estimated ~${Math.round(fileItems.length * 500 / 1000)}K tokens). This may exceed localStorage limits. Continue with first 50 files?`
        );
        if (!confirm) { setBrowseLoading(false); return; }
      }
      const itemsToInject = fileItems.slice(0, 50);

      for (const item of itemsToInject) {
        if (existingPaths.has(item.path)) continue;
        const content = await fetchFileContent(item.path);
        if (content !== null) {
          if (totalChars + content.length > MAX_CHARS) {
            setError("Reached the 2 MB context limit — remaining files were skipped.");
            break;
          }
          updated.push({ path: item.path, content });
          existingPaths.add(item.path);
          totalChars += content.length;
        }
      }
      setFiles(updated);
      onFilesChange(updated, repo);

      if (updated.length !== items.length) {
        setError(`Loaded ${updated.length - files.length} files (truncated from ${items.length})`);
      }
    } catch {
      setError("Error loading directory");
    } finally {
      setBrowseLoading(false);
    }
  }

  // ── Remove a file ────────────────────────────────────────────────────
  function removeFile(filePath: string) {
    const updated = files.filter((f) => f.path !== filePath);
    setFiles(updated);
    onFilesChange(updated, repo);
  }

  // ── Clear all ────────────────────────────────────────────────────────
  function clearFiles() {
    setFiles([]);
    onFilesChange([], repo);
  }

  // ── Browse state ─────────────────────────────────────────────────────
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [listing, setListing] = useState<Array<{ name: string; path: string; type: string }>>([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  const browseDirectory = useCallback(async (dir: string, selectedRepo = repo) => {
    if (!selectedRepo) return;
    setBrowseLoading(true);
    setError("");
    try {
      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_files", repo: selectedRepo, path: dir }),
      });
      if (!res.ok) { setError("Cannot list directory"); return; }
      const data = await res.json();
      setListing(Array.isArray(data) ? data : [data]);
    } catch {
      setError("Error listing directory");
    } finally {
      setBrowseLoading(false);
    }
  }, [repo]);

  const debouncedRepo = useDebouncedValue(repo, 400);
  useEffect(() => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(debouncedRepo)) return;
    setCurrentPath([]);
    if (debouncedRepo !== savedContext?.repo) {
      setFiles([]);
      onFilesChange([], debouncedRepo);
    }
    void browseDirectory("", debouncedRepo);
  }, [browseDirectory, debouncedRepo, onFilesChange, savedContext?.repo]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 light:bg-[#faf8f4]">
      {/* ── Repo picker ───────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-zinc-800 light:border-[#e5ded1] space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-teal-400 light:text-teal-600 text-sm">⎇</span>
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repo"
            className="flex-1 bg-zinc-800 light:bg-white border border-zinc-700 light:border-[#ddd3bd] rounded-lg px-3 py-2 text-zinc-100 light:text-[#2b2620] text-xs focus:outline-none focus:border-teal-600 placeholder:text-zinc-600 light:placeholder:text-[#a89e8c]"
          />
          {repo && (
            <button
              onClick={() => {
                setRepo("");
                setFiles([]);
                setCurrentPath([]);
                setListing([]);
                onFilesChange([], "");
              }}
              className="text-zinc-500 hover:text-zinc-300 light:text-[#8a7f6d] light:hover:text-[#2b2620] text-xs px-2 py-2"
              title="Change repo"
            >
              ✕
            </button>
          )}
        </div>

        {/* Repo list / search, shown until a repo is chosen */}
        {!repo && (
          <div>
            <input
              value={repoSearch}
              onChange={(e) => setRepoSearch(e.target.value)}
              placeholder="Search your repos..."
              className="w-full bg-zinc-800 light:bg-white border border-zinc-700 light:border-[#ddd3bd] rounded-lg px-3 py-2 text-zinc-300 light:text-[#4a4335] text-xs placeholder:text-zinc-600 light:placeholder:text-[#a89e8c] focus:outline-none focus:border-teal-600"
            />
            <div className="mt-2 max-h-56 overflow-y-auto space-y-0.5 mobile-scroll">
              {reposLoading ? (
                <div className="px-2 py-4 text-zinc-500 light:text-[#8a7f6d] text-xs text-center">Loading repos...</div>
              ) : (
                (() => {
                  const filtered = repoSearch
                    ? repos.filter((r) =>
                        r.full_name.toLowerCase().includes(repoSearch.toLowerCase()) ||
                        (r.description && r.description.toLowerCase().includes(repoSearch.toLowerCase()))
                      )
                    : repos;
                  if (filtered.length === 0) {
                    return (
                      <div className="px-2 py-4 text-zinc-500 light:text-[#8a7f6d] text-xs text-center">
                        {repoSearch ? "No matching repos" : "No repos found"}
                      </div>
                    );
                  }
                  return filtered.map((r) => (
                    <button
                      key={r.full_name}
                      onClick={() => setRepo(r.full_name)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-800 light:hover:bg-[#efe9dd] transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-500 light:text-[#8a7f6d] text-xs">{r.private ? "🔒" : "📂"}</span>
                        <span className="text-zinc-200 light:text-[#2b2620] text-xs font-medium truncate">{r.name}</span>
                      </div>
                      {r.description && (
                        <p className="text-zinc-500 light:text-[#8a7f6d] text-xs mt-0.5 truncate pl-5">{r.description}</p>
                      )}
                    </button>
                  ));
                })()
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <div className="flex border-b border-zinc-800 light:border-[#e5ded1]">
        <button
          onClick={() => setActiveTab("browse")}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeTab === "browse" ? "text-teal-400 light:text-teal-700 border-b-2 border-teal-500" : "text-zinc-500 hover:text-zinc-300 light:text-[#8a7f6d] light:hover:text-[#2b2620]"
          }`}
        >
          Browse
        </button>
        <button
          onClick={() => setActiveTab("pinned")}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            activeTab === "pinned" ? "text-teal-400 light:text-teal-700 border-b-2 border-teal-500" : "text-zinc-500 hover:text-zinc-300 light:text-[#8a7f6d] light:hover:text-[#2b2620]"
          }`}
        >
          Pinned
        </button>
      </div>

      {/* ── Browse tab ────────────────────────────────────────────────── */}
      {activeTab === "browse" && (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5 mobile-scroll">
          {/* Path breadcrumbs */}
          <div className="flex items-center gap-1 px-2 pb-2 overflow-x-auto">
            <button
              onClick={() => { setCurrentPath([]); browseDirectory(""); }}
              className="text-xs text-teal-500 hover:text-teal-400 light:text-teal-700 light:hover:text-teal-600 whitespace-nowrap flex-shrink-0"
            >
              /
            </button>
            {currentPath.map((part, i) => (
              <span key={i} className="flex items-center gap-1 whitespace-nowrap flex-shrink-0">
                <span className="text-zinc-600 light:text-[#a89e8c]">/</span>
                <button
                  onClick={() => {
                    const newPath = currentPath.slice(0, i + 1);
                    setCurrentPath(newPath);
                    browseDirectory(newPath.join("/"));
                  }}
                  className="text-xs text-zinc-400 hover:text-zinc-200 light:text-[#6b6255] light:hover:text-[#2b2620]"
                >
                  {part}
                </button>
              </span>
            ))}
          </div>

          {browseLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="flex gap-1">
                <div className="thinking-dot" />
                <div className="thinking-dot" />
                <div className="thinking-dot" />
              </div>
            </div>
          ) : listing.length === 0 ? (
            <div className="text-center py-8 text-zinc-600 light:text-[#a89e8c] text-xs">
              {repo ? "Empty directory" : "Enter a repo to browse"}
            </div>
          ) : (
            listing.map((item) => (
              <div key={item.path} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-800 light:hover:bg-[#efe9dd] transition-colors text-xs">
                <span className="text-zinc-500 light:text-[#8a7f6d] flex-shrink-0">
                  {item.type === "dir" ? "📁" : "📄"}
                </span>
                <button
                  onClick={() => {
                    if (item.type === "dir") {
                      setCurrentPath((prev) => [...prev, item.name]);
                      browseDirectory(item.path);
                    } else {
                      injectFile(item.path);
                    }
                  }}
                  className="flex-1 text-left text-zinc-300 hover:text-teal-300 light:text-[#4a4335] light:hover:text-teal-700 truncate min-w-0"
                  title={item.path}
                >
                  {item.name}
                </button>
                {item.type === "file" && (
                  <button
                    onClick={() => injectFile(item.path)}
                    className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-teal-500 hover:text-teal-400 light:text-teal-600 light:hover:text-teal-700 text-xs px-1 transition-opacity"
                    title="Inject file"
                  >
                    +
                  </button>
                )}
                {item.type === "dir" && (
                  <button
                    onClick={() => injectDir(item.path)}
                    className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-amber-500 hover:text-amber-400 text-xs px-1 transition-opacity"
                    title="Inject all files in folder"
                  >
                    ⊞
                  </button>
                )}
              </div>
            ))
          )}

          {/* Quick inject buttons */}
          {repo && listing.length > 0 && (
            <div className="px-2 pt-3 pb-1">
              <button
                onClick={() => injectDir("")}
                className="w-full text-center text-xs py-1.5 rounded-lg border border-dashed border-zinc-700 light:border-[#ddd3bd] text-zinc-500 hover:text-teal-400 hover:border-teal-700 light:text-[#8a7f6d] light:hover:text-teal-700 light:hover:border-teal-400 transition-colors"
              >
                Inject entire repo
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Pinned tab ────────────────────────────────────────────────── */}
      {activeTab === "pinned" && (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5 mobile-scroll">
          {pinnedFiles?.[repo]?.length ? (
            pinnedFiles[repo].map((fp) => (
              <div key={fp} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-800 light:hover:bg-[#efe9dd] transition-colors text-xs">
                <span className="text-zinc-500 light:text-[#8a7f6d]">📌</span>
                <span className="flex-1 truncate text-zinc-400 light:text-[#6b6255]">{fp}</span>
                <button
                  onClick={() => injectFile(fp)}
                  className="text-teal-500 hover:text-teal-400 light:text-teal-600 light:hover:text-teal-700 text-xs"
                >
                  +
                </button>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-zinc-600 light:text-[#a89e8c] text-xs">
              Pin files from browse tab to quick-access them here
            </div>
          )}
        </div>
      )}

      {/* ── Error bar ─────────────────────────────────────────────────── */}
      {error && (
        <div className="px-4 py-2 bg-red-950 light:bg-red-50 border-t border-red-800 light:border-red-200">
          <div className="flex items-center justify-between">
            <span className="text-red-400 light:text-red-700 text-xs">{error}</span>
            <button onClick={() => setError("")} className="text-red-500 hover:text-red-400 light:text-red-600 light:hover:text-red-700 text-xs">✕</button>
          </div>
        </div>
      )}

      {/* ── Loaded files list ─────────────────────────────────────────── */}
      {files.length > 0 && (
        <div className="border-t border-zinc-800 light:border-[#e5ded1] max-h-40 overflow-y-auto">
          <div className="px-4 py-2 flex items-center justify-between">
            <span className="text-zinc-500 light:text-[#8a7f6d] text-xs">{files.length} file{files.length !== 1 ? "s" : ""} injected</span>
            <button onClick={clearFiles} className="text-red-500 hover:text-red-400 light:text-red-600 light:hover:text-red-700 text-xs">Clear</button>
          </div>
          {files.map((f) => (
            <div key={f.path} className="flex items-center gap-2 px-4 py-1.5 group text-xs hover:bg-zinc-800 light:hover:bg-[#efe9dd] transition-colors">
              <span className="text-zinc-500 light:text-[#8a7f6d] flex-shrink-0">📄</span>
              <span className="flex-1 truncate text-zinc-400 light:text-[#6b6255]" title={f.path}>{f.path}</span>
              {onTogglePinnedFile && (
                <button
                  onClick={() => onTogglePinnedFile(repo, f.path)}
                  className={`opacity-100 md:opacity-0 md:group-hover:opacity-100 text-xs transition-opacity ${
                    pinnedFiles?.[repo]?.includes(f.path) ? "text-amber-400" : "text-zinc-600 hover:text-amber-400 light:text-[#a89e8c] light:hover:text-amber-500"
                  }`}
                  title="Toggle pin"
                >
                  📌
                </button>
              )}
              <button
                onClick={() => removeFile(f.path)}
                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-red-500 hover:text-red-400 text-xs transition-opacity"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Token bar ─────────────────────────────────────────────────── */}
      <TokenBar tokens={estimateTokens(files)} limit={contextWindow} />
    </div>
  );
}