"use client";

import { useState } from "react";
import type { StagedFile } from "@/lib/agentTools";

interface Props {
  files: StagedFile[];
  repo: string;
  onPush: (files: StagedFile[]) => void;
  onDiscard: () => void;
}

// Simple line diff — returns array of { type: "same"|"add"|"remove", text: string }
function diffLines(original: string, modified: string) {
  const oldLines = original.split("\n");
  const newLines = modified.split("\n");
  const result: { type: "same" | "add" | "remove"; text: string }[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === undefined) {
      result.push({ type: "add", text: newLine });
    } else if (newLine === undefined) {
      result.push({ type: "remove", text: oldLine });
    } else if (oldLine === newLine) {
      result.push({ type: "same", text: newLine });
    } else {
      result.push({ type: "remove", text: oldLine });
      result.push({ type: "add", text: newLine });
    }
  }
  return result;
}

function FileDiff({ file }: { file: StagedFile }) {
  const [expanded, setExpanded] = useState(true);
  const [view, setView] = useState<"diff" | "full">("diff");

  const isNew = file.originalContent === null;
  const diff = !isNew && file.originalContent
    ? diffLines(file.originalContent, file.content)
    : null;

  const addedLines   = diff?.filter((l) => l.type === "add").length ?? file.content.split("\n").length;
  const removedLines = diff?.filter((l) => l.type === "remove").length ?? 0;

  return (
    <div className="border border-zinc-700 rounded-lg overflow-hidden">
      {/* File header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 bg-zinc-800 cursor-pointer hover:bg-zinc-750"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3">
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
            isNew ? "bg-teal-900 text-teal-300" : "bg-amber-900 text-amber-300"
          }`}>
            {isNew ? "NEW" : "MODIFIED"}
          </span>
          <span className="text-zinc-200 text-xs font-mono">{file.path}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-teal-400 text-xs">+{addedLines}</span>
          {removedLines > 0 && <span className="text-red-400 text-xs">-{removedLines}</span>}
          <span className="text-zinc-600 text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Description */}
      <div className="px-4 py-2 bg-zinc-850 border-b border-zinc-700">
        <p className="text-zinc-400 text-xs">{file.description}</p>
      </div>

      {/* Diff/content */}
      {expanded && (
        <>
          {diff && (
            <div className="flex gap-2 px-4 py-2 bg-zinc-900 border-b border-zinc-700">
              <button
                onClick={() => setView("diff")}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${view === "diff" ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                Diff
              </button>
              <button
                onClick={() => setView("full")}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${view === "full" ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                Full file
              </button>
            </div>
          )}

          <div className="max-h-72 overflow-y-auto font-mono text-xs">
            {view === "diff" && diff ? (
              <div>
                {diff.map((line, i) => (
                  <div
                    key={i}
                    className={`px-4 py-px whitespace-pre-wrap ${
                      line.type === "add"
                        ? "bg-teal-950 text-teal-300"
                        : line.type === "remove"
                        ? "bg-red-950 text-red-400 line-through opacity-70"
                        : "text-zinc-500"
                    }`}
                  >
                    <span className="select-none mr-3 opacity-50">
                      {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                    </span>
                    {line.text}
                  </div>
                ))}
              </div>
            ) : (
              <pre className="px-4 py-3 text-zinc-300 whitespace-pre-wrap">{file.content}</pre>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function StagedChanges({ files, repo, onPush, onDiscard }: Props) {
  const [commitMsg, setCommitMsg] = useState("feat: AI agent changes");
  const [branch, setBranch] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ success: boolean; message: string; url?: string } | null>(null);

  async function handlePush() {
    setPushing(true);
    setPushResult(null);
    try {
      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "push_many",
          repo,
          files: files.map((f) => ({ path: f.path, content: f.content })),
          message: commitMsg,
          branch: branch.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setPushResult({
          success: true,
          message: `✓ Pushed ${data.files.length} file(s) to ${data.branch} (${data.commit})`,
          url: data.url,
        });
        onPush(files);
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
    <div className="border-t border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-amber-400 text-sm">⚡</span>
          <span className="text-zinc-200 text-sm font-medium">
            {files.length} file{files.length !== 1 ? "s" : ""} staged for review
          </span>
          <span className="text-zinc-600 text-xs">— review before pushing</span>
        </div>
        <button
          onClick={onDiscard}
          className="text-zinc-600 hover:text-red-400 text-xs transition-colors"
        >
          discard all
        </button>
      </div>

      {/* File diffs */}
      <div className="px-4 py-3 space-y-2 max-h-96 overflow-y-auto">
        {files.map((f) => (
          <FileDiff key={f.path} file={f} />
        ))}
      </div>

      {/* Push controls */}
      {!pushResult?.success && (
        <div className="px-3 py-3 border-t border-zinc-800 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 flex-wrap">
          <input
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            placeholder="Commit message"
            className="flex-1 min-w-48 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-xs focus:outline-none focus:border-teal-600"
          />
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="Branch (empty = default)"
            className="w-44 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-xs focus:outline-none focus:border-teal-600 placeholder:text-zinc-600"
          />
          <button
            onClick={handlePush}
            disabled={pushing || !commitMsg.trim()}
            className="bg-teal-700 hover:bg-teal-600 disabled:opacity-40 text-white rounded-lg px-4 py-2 text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            {pushing ? <><span className="animate-spin inline-block">⟳</span> Pushing…</> : <>↑ Push to GitHub</>}
          </button>
        </div>
      )}

      {pushResult && (
        <div className={`mx-4 mb-3 rounded-lg px-4 py-3 text-xs ${
          pushResult.success
            ? "bg-teal-950 border border-teal-800 text-teal-300"
            : "bg-red-950 border border-red-800 text-red-300"
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