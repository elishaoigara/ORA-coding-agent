"use client";

import { useState, useEffect, useMemo } from "react";
import type { GitHubRepo, GitHubFile, InjectedFile, GitHubContext } from "@/types";

interface Props {
  onFilesChange: (files: InjectedFile[], repo: string) => void;
  savedContext?: GitHubContext; // restored from conversation
  onClose?: () => void;        // called by the mobile close button
  pinnedFiles?: Record<string, string[]>;  // ADD THIS
  onTogglePinnedFile?: (repo: string, filePath: string) => void;  // ADD THIS
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
    const prev = pathHistory[pathHistory.length - 1] ?? "";
    setPathHistory((h) => h.slice(0, -1));
    if (selectedRepo) browseRepo(selectedRepo, prev);
  }

  return (
    <aside className="w-64 md:w-64 h-full border-r border-zinc-800 flex flex-col bg-zinc-950 text-sm flex-shrink-0">
      <div className="px-3 py-2 border-b border-zinc-800 font-medium text-zinc-400 text-xs uppercase tracking-wider flex items-center justify-between">
        <span>GitHub context</span>
        <div className="flex items-center gap-2">
          {savedContext && injected.length > 0 && (
            <span className="text-teal-500 text-xs normal-case">📌 pinned</span>
          )}
          {onClose && (
            <button onClick={onClose} className="md:hidden text-zinc-600 hover:text-zinc-300 text-sm leading-none">✕</button>
          )}
        </div>
      </div>

      {injected.length > 0 && <TokenBar tokens={tokenCount} />}

      {injected.length > 0 && (
        <div className="border-b border-zinc-800 px-3 py-2 max-h-44 overflow-y-auto">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-zinc-500">{injected.length} file{injected.length > 1 ? "s" : ""} in context</span>
            <button onClick={clearAll} className="text-xs text-zinc-600 hover:text-red-400 transition-colors">clear all</button>
          </div>
          {injected.map((f) => (
            <div key={f.path} className="flex items-center justify-between gap-1 py-0.5">
              <span className="text-teal-400 text-xs truncate" title={`${f.repo}/${f.path}`}>
                {f.path.split("/").pop()}
              </span>
              <button onClick={() => removeFile(f.path)} className="text-zinc-600 hover:text-zinc-300 text-xs flex-shrink-0">✕</button>
            </div>
          ))}
        </div>
      )}

      {!selectedRepo ? (
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading && <div className="text-zinc-500 text-xs px-1">Loading repos…</div>}
          {error && <div className="text-red-400 text-xs px-1">{error}</div>}
          {repos.map((r) => (
            <button key={r.full_name} onClick={() => browseRepo(r.full_name)}
              className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-800 text-zinc-300 flex items-center gap-2">
              <span className="text-zinc-500">{r.private ? "🔒" : "📂"}</span>
              <span className="truncate">{r.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto flex flex-col">
          <div className="px-3 py-2 border-b border-zinc-800 flex items-center gap-2 flex-wrap">
            <button onClick={() => { setSelectedRepo(null); setTree([]); setPath(""); setPathHistory([]); }}
              className="text-zinc-500 hover:text-zinc-200 text-xs">← repos</button>
            {pathHistory.length > 0 && (
              <button onClick={navigateBack} className="text-zinc-500 hover:text-zinc-200 text-xs">↑ up</button>
            )}
            <span className="text-zinc-500 text-xs truncate flex-1">{path || "/"}</span>
          </div>

          <div className="px-2 py-2 border-b border-zinc-800 flex flex-col gap-1">
            <button onClick={() => injectFolder({ path, name: path || "root" })} disabled={folderLoading !== null}
              className="w-full text-xs px-2 py-1.5 rounded border border-zinc-700 hover:border-teal-700 hover:text-teal-300 text-zinc-400 transition-colors disabled:opacity-40 flex items-center justify-center gap-1">
              {folderLoading === path ? <><span className="animate-spin">⟳</span> Loading…</> : <>📂 Inject this folder</>}
            </button>
            <button onClick={injectWholeRepo} disabled={folderLoading !== null}
              className="w-full text-xs px-2 py-1.5 rounded border border-zinc-700 hover:border-purple-700 hover:text-purple-300 text-zinc-400 transition-colors disabled:opacity-40 flex items-center justify-center gap-1">
              {folderLoading === "__root__" ? <><span className="animate-spin">⟳</span> Loading repo…</> : <>🗂 Inject whole repo</>}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2">
            {loading && <div className="text-zinc-500 text-xs px-1">Loading…</div>}
            {error && <div className="text-red-400 text-xs px-1">{error}</div>}
            {tree.sort((a, b) => (a.type === "dir" ? -1 : 1) - (b.type === "dir" ? -1 : 1)).map((item) => (
              <div key={item.sha + item.path} className="flex items-center gap-1">
                {item.type === "dir" ? (
                  <div className="flex-1 flex items-center gap-1">
                    <button onClick={() => navigateInto(item)}
                      className="flex-1 text-left px-2 py-1 rounded hover:bg-zinc-800 text-zinc-300 flex items-center gap-2">
                      <span className="text-yellow-500">📁</span>
                      <span className="truncate">{item.name}</span>
                    </button>
                    <button onClick={() => injectFolder(item)} disabled={folderLoading !== null}
                      title={`Inject all files in ${item.name}`}
                      className="px-1.5 py-1 text-zinc-600 hover:text-teal-400 disabled:opacity-30 text-xs rounded hover:bg-zinc-800 transition-colors flex-shrink-0">
                      {folderLoading === item.path ? <span className="animate-spin inline-block">⟳</span> : "⊕"}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => injectFile(item)}
                    className={`flex-1 text-left px-2 py-1 rounded hover:bg-zinc-800 flex items-center gap-2 ${injected.find((f) => f.path === item.path) ? "text-teal-400" : "text-zinc-300"}`}>
                    <span className="text-zinc-500">📄</span>
                    <span className="truncate">{item.name}</span>
                    {injected.find((f) => f.path === item.path) && <span className="text-teal-500 text-xs ml-auto flex-shrink-0">✓</span>}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}