"use client";

import { useState, useEffect } from "react";
import type { StagedFile } from "@/lib/agentTools";

interface Props {
  files: StagedFile[];
  repo: string;
  onPush: (files: StagedFile[]) => void;
  onDiscard: () => void;
  onOpenArtifact?: (lang: string, code: string, path?: string) => void;
  defaultBranch?: string;
}

// ── Myers diff algorithm ──────────────────────────────────────────────────────
// Bug fix #7: replaced naive line-zip with proper LCS-based diff so a single
// inserted line doesn't mark every subsequent line as modified.
interface DiffLine {
  type: "same" | "add" | "remove";
  text: string;
  lineNo?: number;
}

function myersDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const N = oldLines.length;
  const M = newLines.length;
  const MAX = N + M;

  if (MAX === 0) return [];

  // Find the shortest edit script via Myers algorithm
  const v = new Array(2 * MAX + 1).fill(0);
  const trace: number[][] = [];

  outer: for (let d = 0; d <= MAX; d++) {
    const snap = [...v];
    trace.push(snap);
    for (let k = -d; k <= d; k += 2) {
      const idx = k + MAX;
      let x: number;
      if (k === -d || (k !== d && v[idx - 1] < v[idx + 1])) {
        x = v[idx + 1];
      } else {
        x = v[idx - 1] + 1;
      }
      let y = x - k;
      while (x < N && y < M && oldLines[x] === newLines[y]) { x++; y++; }
      v[idx] = x;
      if (x >= N && y >= M) break outer;
    }
  }

  // Backtrack to build edit script
  const edits: Array<{ type: "insert" | "delete" | "equal"; old?: string; new?: string }> = [];
  let x = N;
  let y = M;

  for (let d = trace.length - 1; d >= 0; d--) {
    const snap = trace[d];
    const k = x - y;
    const idx = k + MAX;

    let prevK: number;
    if (k === -d || (k !== d && snap[idx - 1] < snap[idx + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = snap[prevK + MAX];
    const prevY = prevX - prevK;

    while (x > prevX + (x - y === prevX - prevY ? 0 : 0) && y > prevY &&
           x > 0 && y > 0 && oldLines[x - 1] === newLines[y - 1]) {
      edits.unshift({ type: "equal", old: oldLines[x - 1], new: newLines[y - 1] });
      x--; y--;
    }

    if (d > 0) {
      if (prevK === k - 1) {
        if (y > prevY) {
          edits.unshift({ type: "insert", new: newLines[y - 1] });
          y--;
        }
      } else {
        if (x > prevX) {
          edits.unshift({ type: "delete", old: oldLines[x - 1] });
          x--;
        }
      }
    }
  }

  // Convert to DiffLine[] with line numbers
  const result: DiffLine[] = [];
  let oldLineNo = 1;
  let newLineNo = 1;

  for (const edit of edits) {
    if (edit.type === "equal") {
      result.push({ type: "same", text: edit.old!, lineNo: oldLineNo });
      oldLineNo++; newLineNo++;
    } else if (edit.type === "delete") {
      result.push({ type: "remove", text: edit.old!, lineNo: oldLineNo });
      oldLineNo++;
    } else {
      result.push({ type: "add", text: edit.new!, lineNo: newLineNo });
      newLineNo++;
    }
  }

  return result;
}

// Show only changed lines plus N lines of context around them
function contextDiff(diff: DiffLine[], context = 3): DiffLine[] {
  const changedIndexes = new Set<number>();
  diff.forEach((line, i) => {
    if (line.type !== "same") {
      for (let j = Math.max(0, i - context); j <= Math.min(diff.length - 1, i + context); j++) {
        changedIndexes.add(j);
      }
    }
  });

  const result: DiffLine[] = [];
  let lastIncluded = -1;
  diff.forEach((line, i) => {
    if (!changedIndexes.has(i)) return;
    if (lastIncluded >= 0 && i > lastIncluded + 1) {
      result.push({ type: "same", text: "⋯" });
    }
    result.push(line);
    lastIncluded = i;
  });
  return result;
}

// ── FileDiff ──────────────────────────────────────────────────────────────────
const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  py: "python", json: "json", html: "html", css: "css", scss: "scss",
  sh: "bash", yml: "yaml", yaml: "yaml", sql: "sql", md: "markdown",
  go: "go", rs: "rust", java: "java", c: "c", cpp: "cpp",
};

function langFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANG_BY_EXT[ext] ?? "text";
}

function FileDiff({ file, selected, onToggleSelect, onOpenArtifact }: {
  file: StagedFile;
  selected: boolean;
  onToggleSelect: () => void;
  onOpenArtifact?: (lang: string, code: string, path?: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [view, setView] = useState<"diff" | "full">("diff");

  const isNew = file.originalContent === null;
  const isDelete = file.action === "delete";
  const diff = !isNew && file.originalContent != null && !isDelete
    ? myersDiff(file.originalContent.split("\n"), (file.content ?? "").split("\n"))
    : null;

  const contextLines = diff ? contextDiff(diff) : null;

  const addedLines = diff?.filter((l) => l.type === "add").length ?? (isDelete ? 0 : (file.content ?? "").split("\n").length);
  const removedLines = diff?.filter((l) => l.type === "remove").length ?? (isDelete ? (file.originalContent ?? "").split("\n").length : 0);

  return (
    <div className={`border rounded-lg overflow-hidden transition-colors ${
      selected ? "border-violet-700/60" : "border-zinc-700 light:border-[#ddd3bd]"
    }`}>
      {/* File header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-zinc-800 light:bg-[#efe9dd] hover:bg-zinc-750 light:hover:bg-[#e5ded1]">
        {/* Checkbox for per-file selection */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          className={`flex-shrink-0 w-4 h-4 rounded border transition-colors ${
            selected
              ? "bg-violet-600 border-violet-500"
              : "border-zinc-600 hover:border-zinc-400 light:border-[#c7bda8] light:hover:border-[#a89e8c]"
          } flex items-center justify-center`}
          aria-label={selected ? "Deselect file" : "Select file"}
        >
          {selected && (
            <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>

        <button
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
          onClick={() => setExpanded((e) => !e)}
        >
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${
            isDelete ? "bg-red-900 light:bg-red-100 text-red-300 light:text-red-700" : isNew ? "bg-teal-900 light:bg-teal-100 text-teal-300 light:text-teal-700" : "bg-amber-900 light:bg-amber-100 text-amber-300 light:text-amber-700"
          }`}>
            {isDelete ? "DEL" : isNew ? "NEW" : "MOD"}
          </span>
          <span className="text-zinc-200 light:text-[#2b2620] text-xs font-mono truncate">{file.path}</span>
        </button>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!isDelete && <span className="text-teal-400 light:text-teal-700 text-xs">+{addedLines}</span>}
          {removedLines > 0 && <span className="text-red-400 light:text-red-600 text-xs">-{removedLines}</span>}
          {onOpenArtifact && !isDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenArtifact(langFromPath(file.path), file.content ?? "", file.path);
              }}
              title="Open full file in split view"
              className="flex items-center justify-center w-6 h-6 rounded text-zinc-500 hover:text-teal-300 hover:bg-zinc-700 light:text-[#8a7f6d] light:hover:text-teal-700 light:hover:bg-[#e5ded1] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6v6M20 4L10 14" />
              </svg>
            </button>
          )}
          <span className="text-zinc-600 light:text-[#a89e8c] text-xs select-none">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Description */}
      <div className="px-4 py-2 bg-zinc-850 light:bg-[#f1ede4] border-b border-zinc-700/60 light:border-[#ddd3bd]">
        <p className="text-zinc-400 light:text-[#6b6255] text-xs">{file.description}</p>
      </div>

      {/* Diff / full content */}
      {expanded && (
        <>
          {diff && !isDelete && (
            <div className="flex gap-2 px-4 py-2 bg-zinc-900 light:bg-white border-b border-zinc-700/60 light:border-[#ddd3bd]">
              <button
                onClick={() => setView("diff")}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${view === "diff" ? "bg-zinc-700 text-zinc-200 light:bg-[#ddd3bd] light:text-[#2b2620]" : "text-zinc-500 hover:text-zinc-300 light:text-[#8a7f6d] light:hover:text-[#2b2620]"}`}
              >
                Diff
              </button>
              <button
                onClick={() => setView("full")}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${view === "full" ? "bg-zinc-700 text-zinc-200 light:bg-[#ddd3bd] light:text-[#2b2620]" : "text-zinc-500 hover:text-zinc-300 light:text-[#8a7f6d] light:hover:text-[#2b2620]"}`}
              >
                Full file
              </button>
            </div>
          )}

          <div className="max-h-72 overflow-y-auto font-mono text-xs">
            {isDelete ? (
              <div className="px-4 py-3 text-red-400 light:text-red-600 text-xs">File marked for deletion</div>
            ) : view === "diff" && contextLines ? (
              <div>
                {contextLines.map((line, i) => (
                  <div
                    key={i}
                    className={`flex gap-3 px-3 py-px whitespace-pre-wrap ${
                      line.type === "add"
                        ? "bg-teal-950 light:bg-teal-50 text-teal-300 light:text-teal-800"
                        : line.type === "remove"
                        ? "bg-red-950 light:bg-red-50 text-red-400 light:text-red-700"
                        : line.text === "⋯"
                        ? "text-zinc-600 light:text-[#a89e8c] bg-zinc-900/50 light:bg-[#f1ede4]"
                        : "text-zinc-500 light:text-[#8a7f6d]"
                    }`}
                  >
                    <span className="select-none opacity-50 w-3 flex-shrink-0">
                      {line.type === "add" ? "+" : line.type === "remove" ? "−" : line.text === "⋯" ? "" : " "}
                    </span>
                    <span className="select-none opacity-30 w-7 text-right flex-shrink-0 tabular-nums">
                      {line.text !== "⋯" && line.lineNo}
                    </span>
                    <span className="flex-1">{line.text}</span>
                  </div>
                ))}
                {(!diff || diff.every((l) => l.type === "same")) && (
                  <div className="px-4 py-3 text-zinc-600 light:text-[#a89e8c] text-xs">No changes detected</div>
                )}
              </div>
            ) : (
              <pre className="px-4 py-3 text-zinc-300 light:text-[#4a4335] whitespace-pre-wrap">{file.content}</pre>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main StagedChanges ────────────────────────────────────────────────────────
export default function StagedChanges({ files, repo, onPush, onDiscard, onOpenArtifact, defaultBranch }: Props) {
  const [commitMsg, setCommitMsg] = useState("feat: AI agent changes");
  const [branch, setBranch]       = useState(defaultBranch ?? "");
  const [pushing, setPushing]     = useState(false);
  const [pushResult, setPushResult] = useState<{ success: boolean; message: string; url?: string } | null>(null);
  // UI improvement #2: per-file selection
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set(files.map((f) => f.path)));

  // Sync branch when defaultBranch prop changes
  useEffect(() => {
    if (defaultBranch) setBranch(defaultBranch);
  }, [defaultBranch]);

  function toggleFile(path: string) {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleAll() {
    if (selectedPaths.size === files.length) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(files.map((f) => f.path)));
    }
  }

  const selectedFiles = files.filter((f) => selectedPaths.has(f.path));
  const allSelected   = selectedPaths.size === files.length;

  async function handlePush() {
    if (!selectedFiles.length) return;
    setPushing(true);
    setPushResult(null);
    try {
      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "push_many",
          repo,
          files: selectedFiles.map((f) => ({ path: f.path, content: f.content, action: f.action })),
          message: commitMsg,
          branch: branch.trim() || defaultBranch || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setPushResult({
          success: true,
          message: `✓ Pushed ${data.files.length} file(s) to ${data.branch} (${data.commit})`,
          url: data.url,
        });
        // Bug fix #6: was calling onPush(() => {}) — now properly clears parent staged state
        onPush(selectedFiles);
      } else {
        setPushResult({ success: false, message: data.error ?? "Push failed" });
      }
    } catch (e) {
      setPushResult({ success: false, message: (e as Error).message });
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className="border-t border-zinc-800 light:border-[#e5ded1] bg-zinc-950 light:bg-[#faf8f4]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 light:border-[#e5ded1]">
        <div className="flex items-center gap-2">
          <span className="text-amber-400 text-sm">⚡</span>
          <span className="text-zinc-200 light:text-[#2b2620] text-sm font-medium">
            {files.length} file{files.length !== 1 ? "s" : ""} staged
          </span>
          {selectedPaths.size < files.length && (
            <span className="text-violet-400 light:text-violet-700 text-xs">
              ({selectedPaths.size} selected)
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Select all toggle */}
          <button
            onClick={toggleAll}
            className="text-zinc-500 hover:text-zinc-300 light:text-[#8a7f6d] light:hover:text-[#2b2620] text-xs transition-colors"
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
          <button
            onClick={onDiscard}
            className="text-zinc-600 hover:text-red-400 light:text-[#a89e8c] light:hover:text-red-600 text-xs transition-colors"
          >
            Discard all
          </button>
        </div>
      </div>

      {/* File diffs */}
      <div className="px-4 py-3 space-y-2 max-h-96 overflow-y-auto">
        {files.map((f) => (
          <FileDiff
            key={f.path}
            file={f}
            selected={selectedPaths.has(f.path)}
            onToggleSelect={() => toggleFile(f.path)}
            onOpenArtifact={onOpenArtifact}
          />
        ))}
      </div>

      {/* Push controls */}
      {!pushResult?.success && (
        <div className="px-3 py-3 border-t border-zinc-800 light:border-[#e5ded1] flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 flex-wrap">
          <input
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            placeholder="Commit message"
            className="flex-1 min-w-48 bg-zinc-800 light:bg-white border border-zinc-700 light:border-[#ddd3bd] rounded-lg px-3 py-2 text-zinc-100 light:text-[#2b2620] text-xs focus:outline-none focus:border-teal-600"
          />
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="Branch (empty = default)"
            className="w-44 bg-zinc-800 light:bg-white border border-zinc-700 light:border-[#ddd3bd] rounded-lg px-3 py-2 text-zinc-100 light:text-[#2b2620] text-xs focus:outline-none focus:border-teal-600 placeholder:text-zinc-600 light:placeholder:text-[#a89e8c]"
          />
          <button
            onClick={handlePush}
            disabled={pushing || !commitMsg.trim() || selectedFiles.length === 0}
            className="bg-teal-700 hover:bg-teal-600 disabled:opacity-40 text-white rounded-lg px-4 py-2 text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            {pushing
              ? <><span className="animate-spin inline-block">⟳</span> Pushing…</>
              : <>↑ Push {selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""} to GitHub</>
            }
          </button>
        </div>
      )}

      {pushResult && (
        <div className={`mx-4 mb-3 rounded-lg px-4 py-3 text-xs ${
          pushResult.success
            ? "bg-teal-950 light:bg-teal-50 border border-teal-800 light:border-teal-300 text-teal-300 light:text-teal-800"
            : "bg-red-950 light:bg-red-50 border border-red-800 light:border-red-300 text-red-300 light:text-red-700"
        }`}>
          {pushResult.message}
          {pushResult.url && (
            <a href={pushResult.url} target="_blank" rel="noopener noreferrer"
              className="underline ml-2 opacity-80 hover:opacity-100">
              View on GitHub →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
