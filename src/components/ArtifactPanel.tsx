"use client";

import { useState, useCallback } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

export interface Artifact {
  id: string;
  path: string;
  lang: string;
  content: string;
}

interface Props {
  artifact: Artifact | null;
  onClose: () => void;
}

function guessFilename(path: string, lang: string): string {
  if (path.includes(".")) return path;
  const extMap: Record<string, string> = {
    typescript: "ts", ts: "ts", tsx: "tsx", javascript: "js", js: "js", jsx: "jsx",
    python: "py", py: "py", json: "json", html: "html", css: "css", bash: "sh",
    sh: "sh", yaml: "yml", yml: "yml", sql: "sql", markdown: "md", md: "md",
  };
  const ext = extMap[lang.toLowerCase()] ?? "txt";
  return `${path}.${ext}`;
}

export default function ArtifactPanel({ artifact, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!artifact) return;
    try {
      await navigator.clipboard.writeText(artifact.content);
    } catch {
      const el = document.createElement("textarea");
      el.value = artifact.content;
      el.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [artifact]);

  const handleDownload = useCallback(() => {
    if (!artifact) return;
    const filename = guessFilename(artifact.path, artifact.lang);
    const blob = new Blob([artifact.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.split("/").pop() || "file.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [artifact]);

  if (!artifact) return null;

  const filename = guessFilename(artifact.path, artifact.lang);
  const lineCount = artifact.content.split("\n").length;

  return (
    <div className="flex flex-col h-full bg-zinc-950 border-l border-zinc-800 w-full md:w-[46%] lg:w-[42%] flex-shrink-0 animate-slide-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-900 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex gap-1.5 flex-shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
            <span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
            <span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
          </span>
          <span className="text-zinc-100 text-sm font-mono truncate">{filename}</span>
          <span className="text-zinc-600 text-xs flex-shrink-0">{lineCount} lines</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={handleCopy}
            title="Copy code"
            className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
              copied ? "text-teal-400 bg-teal-900/30" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            }`}
          >
            {copied ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth={2} />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
                Copy
              </>
            )}
          </button>
          <button
            onClick={handleDownload}
            title="Download file"
            className="flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
          </button>
          <button
            onClick={onClose}
            title="Close"
            className="flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Code body */}
      <div className="flex-1 overflow-auto">
        <SyntaxHighlighter
          language={artifact.lang || "text"}
          style={vscDarkPlus}
          customStyle={{
            margin: 0,
            borderRadius: 0,
            fontSize: "13px",
            minHeight: "100%",
            background: "#0a0a0b",
          }}
          showLineNumbers
          lineNumberStyle={{ color: "#3f3f46", fontSize: "11px", minWidth: "2.8em" }}
        >
          {artifact.content}
        </SyntaxHighlighter>
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-900 flex-shrink-0">
        <p className="text-[11px] text-zinc-600">Copy this into VS Code, or download it directly.</p>
      </div>
    </div>
  );
}