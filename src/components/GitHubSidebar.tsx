'use client';

import { useState } from 'react';

<<<<<<< HEAD
export default function GitHubSidebar() {
  const [isExpanded, setIsExpanded] = useState(true);
=======
interface Props {
  onFilesChange: (files: InjectedFile[], repo: string) => void;
  savedContext?: GitHubContext; // restored from conversation
  onClose?: () => void;        // called by the mobile close button
}
>>>>>>> 0c7f7c7 (fix:3316661331666133166613316661331666133888)

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.6.113.82-.268.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.807 1.305 3.492.998.107-.775.418-1.305.762-1.605-2.665-.305-5.466-1.335-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.124-.303-.535-1.523.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.873.118 3.176.77.84 1.235 1.91 1.235 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.218.69.825.577C20.565 21.795 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
          </svg>
          GitHub
        </h3>
        <button 
          onClick={toggleExpand}
          className="p-1 rounded-md hover:bg-gray-700 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      
      {isExpanded && (
        <div className="space-y-2">
          <div className="p-2 rounded-md hover:bg-gray-700 cursor-pointer transition-colors flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m2 4l2 2-2 2M6 20l-4-16m4 4l2 2 2-2" />
            </svg>
            Repositories
          </div>
          <div className="p-2 rounded-md hover:bg-gray-700 cursor-pointer transition-colors flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Profile
          </div>
          <div className="p-2 rounded-md hover:bg-gray-700 cursor-pointer transition-colors flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-2.572 1.065c-.94 1.543-3.31.826-2.37 2.37a1.724 1.724 0 00-1.066 2.573c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.572-1.065c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 002.572-1.065c.94-1.543 3.31-.826 2.37-2.37a1.724 1.724 0 001.066-2.572z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </div>
        </div>
      )}
    </div>
  );
<<<<<<< HEAD
}
=======
}

export default function GitHubSidebar({ onFilesChange, savedContext, onClose }: Props) {
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
      const res = await fetch(`/api/github?action=tree&repo=${encodeURIComponent(repoFullName)}&path=${encodeURIComponent(browsePath)}`);
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
      const res = await fetch(`/api/github?action=folder&repo=${encodeURIComponent(selectedRepo)}&path=${encodeURIComponent(dir.path)}`);
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
      const res = await fetch(`/api/github?action=folder&repo=${encodeURIComponent(selectedRepo)}&path=`);
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
>>>>>>> 0c7f7c7 (fix:3316661331666133166613316661331666133888)
