"use client";

import { useState } from "react";

interface FileToPush {
  path: string;
  content: string;
}

interface Props {
  repo: string;           // e.g. "elishaoigara/ORA"
  files: FileToush[];     // pre-filled from chat (AI-generated code)
  onClose: () => void;
}

// Parse code blocks from an AI message
export function extractCodeBlocks(text: string): FileToush[] {
  const results: FileToush[] = [];
  // Match ```lang\n...code...\n```
  const regex = /```(?:\w+)?\n([\s\S]*?)```/g;
  let match;
  let i = 1;
  while ((match = regex.exec(text)) !== null) {
    results.push({ path: `generated_file_${i}.txt`, content: match[1] });
    i++;
  }
  return results;
}

interface FileToush {
  path: string;
  content: string;
}

export default function PushToGitHub({ repo, files, onClose }: Props) {
  const [fileList, setFileList] = useState<FileToush[]>(
    files.map((f) => ({ ...f }))
  );
  const [commitMsg, setCommitMsg] = useState("feat: AI-generated code");
  const [branch, setBranch] = useState("");
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; url?: string } | null>(null);

  function updatePath(i: number, path: string) {
    setFileList((prev) => prev.map((f, idx) => idx === i ? { ...f, path } : f));
  }

  function updateContent(i: number, content: string) {
    setFileList((prev) => prev.map((f, idx) => idx === i ? { ...f, content } : f));
  }

  function removeFile(i: number) {
    setFileList((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addFile() {
    setFileList((prev) => [...prev, { path: "new_file.ts", content: "" }]);
  }

  async function push() {
    if (!fileList.length || !commitMsg.trim()) return;
    setPushing(true);
    setResult(null);
    try {
      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "push_many",
          repo,
          files: fileList,
          message: commitMsg,
          branch: branch || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ success: true, message: `✓ Pushed ${data.files.length} file(s) to ${data.branch}`, url: data.url });
      } else {
        setResult({ success: false, message: data.error ?? "Push failed" });
      }
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <h2 className="text-zinc-100 font-semibold text-sm">Push to GitHub</h2>
            <p className="text-zinc-500 text-xs mt-0.5">{repo}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Commit message */}
          <div>
            <label className="text-zinc-400 text-xs mb-1 block">Commit message</label>
            <input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-teal-600" />
          </div>

          {/* Branch (optional) */}
          <div>
            <label className="text-zinc-400 text-xs mb-1 block">Branch <span className="text-zinc-600">(leave empty for default)</span></label>
            <input value={branch} onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-teal-600 placeholder:text-zinc-600" />
          </div>

          {/* Files */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-zinc-400 text-xs">Files to push ({fileList.length})</label>
              <button onClick={addFile} className="text-xs text-teal-400 hover:text-teal-300">+ add file</button>
            </div>
            <div className="space-y-3">
              {fileList.map((f, i) => (
                <div key={i} className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input value={f.path} onChange={(e) => updatePath(i, e.target.value)}
                      className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-teal-300 text-xs font-mono focus:outline-none focus:border-teal-600"
                      placeholder="src/components/MyFile.tsx" />
                    <button onClick={() => removeFile(i)} className="text-zinc-600 hover:text-red-400 text-xs">✕</button>
                  </div>
                  <textarea value={f.content} onChange={(e) => updateContent(i, e.target.value)}
                    rows={6}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-300 text-xs font-mono resize-y focus:outline-none focus:border-teal-600" />
                </div>
              ))}
            </div>
          </div>

          {result && (
            <div className={`rounded-lg px-4 py-3 text-sm ${result.success ? "bg-teal-950 border border-teal-800 text-teal-300" : "bg-red-950 border border-red-800 text-red-300"}`}>
              <p>{result.message}</p>
              {result.url && (
                <a href={result.url} target="_blank" rel="noopener noreferrer"
                  className="text-xs underline mt-1 block opacity-80 hover:opacity-100">
                  View commit on GitHub →
                </a>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-800 flex items-center justify-end gap-3">
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200 text-sm px-4 py-2">Cancel</button>
          <button onClick={push} disabled={pushing || !fileList.length || !commitMsg.trim()}
            className="bg-teal-700 hover:bg-teal-600 disabled:opacity-40 text-white rounded-lg px-5 py-2 text-sm font-medium transition-colors flex items-center gap-2">
            {pushing ? <><span className="animate-spin">⟳</span> Pushing…</> : <>↑ Push to GitHub</>}
          </button>
        </div>
      </div>
    </div>
  );
}
