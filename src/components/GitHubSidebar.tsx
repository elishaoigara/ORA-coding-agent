"use client";

import { useState, useEffect, useMemo } from "react";
import type { GitHubRepo, GitHubFile, InjectedFile, GitHubContext } from "@/types";

interface Props {
  onFilesChange: (files: InjectedFile[], repo: string) => void;
  savedContext?: GitHubContext;
  onClose?: () => void;
  pinnedFiles?: Record<string, string[]>;
  onTogglePinnedFile?: (repo: string, filePath: string) => void;
}

const MODEL_LIMIT = 128000;

function estimateTokens(files: InjectedFile[]): number {
  return Math.round(files.reduce((sum, f) => sum + f.content.length, 0) / 4);
}

function TokenBar({ tokens }: { tokens: number }) {
  const pct = Math.min((tokens / MODEL_LIMIT) * 100, 100);
  const color = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-teal-500";
  const label = pct > 90 ? "text-red-400" : pct > 70 ? "text-amber-400" : "text-teal-400";
  return (
    <div className="px-3 py-2 border-b border-zinc-800">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-zinc-500">context used</span>
        <span className={`text-xs font-mono ${label}`}>
          ~{tokens.toLocaleString()} / {MODEL_LIMIT.toLocaleString()} tokens
        </span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {pct > 90 && <p className="text-red-400 text-xs mt-1">⚠ Too full — remove some files</p>}
      {pct > 70 && pct <= 90 && <p className="text-amber-400 text-xs mt-1">Getting full — remove unused files</p>}
    </div>
  );
}

export default function GitHubSidebar({ onFilesChange, savedContext, onClose, pinnedFiles, onTogglePinnedFile }: Props) {
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [tree, setTree] = useState<GitHubFile[]>([]);
  const [injected, setInjected] = useState<InjectedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [folderLoading, setFolderLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [contextRestored, setContextRestored] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const tokenCount = useMemo(() => estimateTokens(injected), [injected]);

  // Restore saved GitHub context when switching conversations
  useEffect(() => {
    if (savedContext && savedContext.files.length > 0 && !contextRestored) {
      setInjected(savedContext.files);
      setSelectedRepo(savedContext.repo);
      onFilesChange(savedContext.files, savedContext.repo);
      setContextRestored(true);
    }
  }, [savedContext]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true);
    fetch("/api/github?action=repos")
      .then((r) => r.json())
      .then((data) => { if (data.error) setError(data.error); else setRepos(data); })
      .catch(() => setError("Could not load repos. Check GITHUB_PAT."))
      .finally(() => setLoading(false));
  }, []);

  function emit(files: InjectedFile[], repo: string) {
    setInjected(files);
    onFilesChange(files, repo);
  }

  async function browseRepo(repoFullName: string, browsePath = "") {
    setLoading(true);
    setError("");
    setSelectedRepo(repoFullName);
    setPath(browsePath);
    try {
      const res = await fetch(`/api/github?action=contents&repo=${encodeURIComponent(repoFullName)}&path=${encodeURIComponent(browsePath)}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setTree(Array.isArray(data) ? data : [data]);
    } catch { setError("Failed to load files"); }
    finally { setLoading(false); }
  }

  async function injectFile(file: GitHubFile) {
    if (!selectedRepo || injected.find((f) => f.path === file.path)) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/github?action=file&repo=${encodeURIComponent(selectedRepo)}&path=${encodeURIComponent(file.path)}`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      const newFiles = [...injected, { path: file.path, content: data.content, repo: selectedRepo }];
      emit(newFiles, selectedRepo);
    } catch { setError("Failed to read file"); }
    finally { setLoading(false); }
  }

  async function injectFolder(dir: { path: string; name: string }) {
    if (!selectedRepo) return;
    setFolderLoading(dir.path);
    setError("");
    try {
      const res = await fetch(`/api/github?action=read_all&repo=${encodeURIComponent(selectedRepo)}&path=${encodeURIComponent(dir.path)}`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      const existing = new Set(injected.map((f) => f.path));
      const newOnes: InjectedFile[] = data.files
        .filter((f: { path: string }) => !existing.has(f.path))
        .map((f: { path: string; content: string }) => ({ path: f.path, content: f.content, repo: selectedRepo! }));
      if (!newOnes.length) { setError("All files already injected."); return; }
      emit([...injected, ...newOnes], selectedRepo);
    } catch { setError("Failed to read folder"); }
    finally { setFolderLoading(null); }
  }

  async function injectWholeRepo() {
    if (!selectedRepo) return;
    setFolderLoading("__root__");
    setError("");
    try {
      const res = await fetch(`/api/github?action=read_all&repo=${encodeURIComponent(selectedRepo)}&path=`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      const newFiles: InjectedFile[] = data.files.map((f: { path: string; content: string }) => ({
        path: f.path, content: f.content, repo: selectedRepo!,
      }));
      emit(newFiles, selectedRepo);
    } catch { setError("Failed to read repo"); }
    finally { setFolderLoading(null); }
  }

  function removeFile(filePath: string) {
    const newFiles = injected.filter((f) => f.path !== filePath);
    emit(newFiles, selectedRepo ?? "");
  }

  function clearAll() { emit([], ""); setSelectedRepo(null); setTree([]); setPath(""); setPathHistory([]); }

  function navigateInto(dir: GitHubFile) {
    if (!selectedRepo) return;
    setPathHistory((h) => [...h, path]);
    browseRepo(selectedRepo, dir.path);
  }

  function navigateBack() {
    if (!selectedRepo || pathHistory.length === 0) return;
    const prev = pathHistory[pathHistory.length - 1];
    setPathHistory((h) => h.slice(0, -1));
    browseRepo(selectedRepo, prev);
  }

  // Filter repos by search
  const filteredRepos = searchQuery
    ? repos.filter((r) =>
        r.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (r.description && r.description.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : repos;

  return (
    <div className="flex flex-col h-full">
      {/* Search repos */}
      <div className="px-3 py-2 border-b border-zinc-800">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search repos..."
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-300 text-xs placeholder:text-zinc-600 focus:outline-none focus:border-teal-600"
        />
      </div>

      {/* Token bar */}
      {injected.length > 0 && <TokenBar tokens={tokenCount} />}

      {/* Main content */}
      <div className="flex-1 overflow-y-auto mobile-scroll">
        {error && (
          <div className="px-3 py-2 text-red-400 text-xs">{error}</div>
        )}

        {loading && !selectedRepo && (
          <div className="px-3 py-4 text-zinc-500 text-xs text-center">Loading repos...</div>
        )}

        {/* Repo list */}
        {!selectedRepo && !loading && (
          <div className="space-y-0.5 p-2">
            {filteredRepos.map((repo) => (
              <button
                key={repo.full_name}
                onClick={() => browseRepo(repo.full_name)}
                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-zinc-800 transition-colors touch-target"
              >
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400 text-xs">{repo.private ? "🔒" : "📂"}</span>
                  <span className="text-zinc-200 text-sm font-medium truncate">{repo.name}</span>
                </div>
                {repo.description && (
                  <p className="text-zinc-500 text-xs mt-0.5 truncate pl-6">{repo.description}</p>
                )}
              </button>
            ))}
            {filteredRepos.length === 0 && (
              <div className="px-3 py-4 text-zinc-500 text-xs text-center">
                {searchQuery ? "No matching repos" : "No repos found"}
              </div>
            )}
          </div>
        )}

        {/* File browser */}
        {selectedRepo && (
          <div>
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-900">
              <button
                onClick={() => {
                  setSelectedRepo(null);
                  setTree([]);
                  setPath("");
                  setPathHistory([]);
                }}
                className="text-zinc-500 hover:text-zinc-300 text-xs touch-target"
              >
                ← Repos
              </button>
              {pathHistory.length > 0 && (
                <button
                  onClick={navigateBack}
                  className="text-zinc-500 hover:text-zinc-300 text-xs touch-target"
                >
                  ↑ Back
                </button>
              )}
              <span className="text-zinc-400 text-xs truncate">{path || selectedRepo.split("/").pop()}</span>
            </div>

            {/* Inject all button */}
            <div className="px-3 py-2 border-b border-zinc-800">
              <button
                onClick={injectWholeRepo}
                disabled={folderLoading === "__root__"}
                className="w-full text-left text-xs text-teal-400 hover:text-teal-300 py-2 touch-target"
              >
                {folderLoading === "__root__" ? "⟳ Loading..." : "📦 Inject entire repo"}
              </button>
            </div>

            {/* Files */}
            <div className="space-y-0.5 p-2">
              {tree.map((item) => (
                <div key={item.path} className="flex items-center gap-2">
                  {item.type === "dir" ? (
                    <button
                      onClick={() => navigateInto(item)}
                      className="flex-1 text-left px-3 py-2.5 rounded-lg hover:bg-zinc-800 transition-colors touch-target"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-500">📁</span>
                        <span className="text-zinc-300 text-sm">{item.name}</span>
                      </div>
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => injectFile(item)}
                        className="flex-1 text-left px-3 py-2.5 rounded-lg hover:bg-zinc-800 transition-colors touch-target"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-500">📄</span>
                          <span className="text-zinc-300 text-sm truncate">{item.name}</span>
                        </div>
                      </button>
                      {onTogglePinnedFile && pinnedFiles && selectedRepo && (
                        <button
                          onClick={() => onTogglePinnedFile(selectedRepo, item.path)}
                          className={`p-2 rounded-lg touch-target ${
                            pinnedFiles[selectedRepo]?.includes(item.path)
                              ? "text-amber-400"
                              : "text-zinc-600 hover:text-zinc-400"
                          }`}
                        >
                          📌
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Injected files list */}
        {injected.length > 0 && (
          <div className="border-t border-zinc-800 mt-2">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-zinc-400 text-xs">Injected files ({injected.length})</span>
              <button
                onClick={clearAll}
                className="text-red-400 hover:text-red-300 text-xs touch-target"
              >
                Clear all
              </button>
            </div>
            <div className="space-y-0.5 px-2 pb-2">
              {injected.map((f) => (
                <div key={f.path} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/50">
                  <span className="text-zinc-400 text-xs truncate flex-1">{f.path}</span>
                  <button
                    onClick={() => removeFile(f.path)}
                    className="text-zinc-600 hover:text-red-400 text-xs p-1 touch-target"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
