"use client";

import { useState, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import PushToGitHub from "./PushToGitHub";
import type { Message } from "@/types";
import { formatTokens, formatCost } from "@/lib/tokenCost";

interface Props {
  message: Message;
  activeRepo?: string;
  onSaveSnippet?: (lang: string, code: string) => void;
}

const RUNNABLE_LANGS = new Set(["javascript", "js", "typescript", "ts"]);

function extractCodeFiles(text: string): { path: string; content: string }[] {
  const results: { path: string; content: string }[] = [];
  const regex = /```(?:\w+)?\n([\s\S]*?)```/g;
  let match;
  let i = 1;
  while ((match = regex.exec(text)) !== null) {
    const content = match[1].trimEnd();
    if (content.length > 20) { results.push({ path: `file_${i}.txt`, content }); i++; }
  }
  return results;
}

// ── Reusable copy button ──────────────────────────────────────────────────────
function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handle = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for older browsers
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      onClick={handle}
      title="Copy"
      className={`flex items-center gap-1 text-xs transition-colors touch-target ${
        copied ? "text-teal-400" : "text-zinc-500 hover:text-zinc-300"
      } ${className}`}
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <span>Copied</span>
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

// ── Inline code runner ────────────────────────────────────────────────────────
interface RunOutputLine { type: "log" | "error"; text: string; }

function useCodeRunner() {
  const [output, setOutput] = useState<RunOutputLine[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback((code: string) => {
    setRunning(true);
    setOutput(null);
    const lines: RunOutputLine[] = [];
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.display = "none";
    document.body.appendChild(iframe);
    const cleanup = () => { window.removeEventListener("message", onMessage); iframe.remove(); };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const { type, logs, message } = event.data ?? {};
      if (type === "result") { for (const log of (logs as string[])) lines.push({ type: "log", text: log }); setOutput([...lines]); }
      else if (type === "error") { lines.push({ type: "error", text: message }); setOutput([...lines]); }
      setRunning(false); cleanup();
    };
    window.addEventListener("message", onMessage);
    const timeout = setTimeout(() => {
      lines.push({ type: "error", text: "Execution timed out (5 s)" });
      setOutput([...lines]); setRunning(false); cleanup();
    }, 5000);
    const escapedCode = code.replace(/`/g, "\\`").replace(/\$/g, "\\$");
    iframe.srcdoc = `<!DOCTYPE html><script>
      const logs = [];
      const origLog = console.log; const origWarn = console.warn; const origInfo = console.info;
      const capture = (...args) => { logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')); };
      console.log = (...args) => { capture(...args); origLog(...args); };
      console.warn = (...args) => { capture('[warn] ' + args.join(' ')); origWarn(...args); };
      console.info = (...args) => { capture('[info] ' + args.join(' ')); origInfo(...args); };
      try { eval(\`${escapedCode}\`); parent.postMessage({ type: 'result', logs }, '*'); }
      catch(e) { parent.postMessage({ type: 'error', message: e.message }, '*'); }
      clearTimeout(${timeout});
    <\/script>`;
    document.body.appendChild(iframe);
  }, []);

  const clear = useCallback(() => setOutput(null), []);
  return { output, running, run, clear };
}

// ── Token usage badge ─────────────────────────────────────────────────────────
function TokenBadge({ message }: { message: Message & { usage?: { totalTokens: number; promptTokens: number; completionTokens: number; estimatedCostUsd: number } } }) {
  const [expanded, setExpanded] = useState(false);
  const usage = message.usage;
  if (!usage) return null;
  return (
    <button
      onClick={() => setExpanded((v) => !v)}
      className="relative text-xs text-zinc-600 hover:text-zinc-400 transition-colors tabular-nums touch-target"
      title="Token usage"
    >
      {formatTokens(usage.totalTokens)} tok
      {expanded && (
        <span className="absolute bottom-full left-0 mb-1 whitespace-nowrap bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300 text-xs z-10 pointer-events-none">
          ↑ {usage.promptTokens.toLocaleString()} in · ↓ {usage.completionTokens.toLocaleString()} out · {formatCost(usage.estimatedCostUsd)}
        </span>
      )}
    </button>
  );
}

// ── Code block ────────────────────────────────────────────────────────────────
function CodeBlock({ lang, code, activeRepo, onSaveSnippet }: {
  lang: string; code: string; activeRepo?: string; onSaveSnippet?: (lang: string, code: string) => void;
}) {
  const { output, running, run, clear } = useCodeRunner();
  const [showPush, setShowPush] = useState(false);
  const [showFullCode, setShowFullCode] = useState(false);
  const isRunnable = RUNNABLE_LANGS.has(lang);
  const codeFiles = extractCodeFiles(code);
  const lineCount = code.split("\n").length;
  const isLongCode = lineCount > 30;

  return (
    <div className="relative my-2">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-zinc-800 rounded-t-lg px-3 py-1.5 border-b border-zinc-700">
        <span className="text-xs text-zinc-400 font-mono">{lang || "code"}</span>
        <div className="flex items-center gap-0.5">
          {isRunnable && (
            <button
              onClick={() => run(code)}
              disabled={running}
              className="text-xs text-teal-400 hover:text-teal-300 px-2 py-1 rounded touch-target"
            >
              {running ? "⟳" : "▶ Run"}
            </button>
          )}
          {onSaveSnippet && (
            <button
              onClick={() => onSaveSnippet(lang, code)}
              className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded touch-target"
              title="Save as snippet"
            >
              Save
            </button>
          )}
          <CopyButton text={code} className="px-2 py-1 rounded" />
        </div>
      </div>

      {/* Code content */}
      <div className="relative">
        {isLongCode && !showFullCode ? (
          <div>
            <SyntaxHighlighter
              language={lang || "text"}
              style={vscDarkPlus}
              customStyle={{ margin: 0, borderRadius: "0 0 0.5rem 0.5rem", fontSize: "12px", maxHeight: "300px", overflow: "hidden" }}
              showLineNumbers={false}
            >
              {code.split("\n").slice(0, 20).join("\n")}
            </SyntaxHighlighter>
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-zinc-900 to-transparent h-16 pointer-events-none" />
            <button
              onClick={() => setShowFullCode(true)}
              className="w-full text-center text-xs text-teal-400 hover:text-teal-300 py-2 bg-zinc-900/80 backdrop-blur-sm touch-target"
            >
              Show all {lineCount} lines
            </button>
          </div>
        ) : (
          <SyntaxHighlighter
            language={lang || "text"}
            style={vscDarkPlus}
            customStyle={{ margin: 0, borderRadius: "0 0 0.5rem 0.5rem", fontSize: "12px", maxHeight: "400px" }}
            showLineNumbers={false}
          >
            {code}
          </SyntaxHighlighter>
        )}
      </div>

      {/* Run output */}
      {output && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-b-lg p-3 mt-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-zinc-500">Output</span>
            <button onClick={clear} className="text-xs text-zinc-600 hover:text-zinc-400 touch-target">Clear</button>
          </div>
          <pre className="text-xs font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
            {output.map((line, i) => (
              <div key={i} className={line.type === "error" ? "text-red-400" : "text-green-400"}>{line.text}</div>
            ))}
          </pre>
        </div>
      )}

      {showPush && activeRepo && codeFiles.length > 0 && (
        <PushToGitHub repo={activeRepo} files={codeFiles} onClose={() => setShowPush(false)} />
      )}
    </div>
  );
}

// ── Main ChatMessage ──────────────────────────────────────────────────────────
export default function ChatMessage({ message, activeRepo, onSaveSnippet }: Props) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-xs text-zinc-500 italic max-w-lg text-center">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} px-2`}>
      <div className="max-w-[85%] md:max-w-[75%]">
        {/* Bubble */}
        <div
          className={`rounded-2xl px-4 py-2.5 ${
            isUser ? "bg-teal-800 text-teal-50" : "bg-zinc-800 text-zinc-200"
          }`}
        >
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children }) {
                    const match = /language-(\w+)/.exec(className || "");
                    const codeString = String(children).replace(/\n$/, "");
                    if (match) {
                      return (
                        <CodeBlock
                          lang={match[1]}
                          code={codeString}
                          activeRepo={activeRepo}
                          onSaveSnippet={onSaveSnippet}
                        />
                      );
                    }
                    return (
                      <code className="bg-zinc-700 rounded px-1 py-0.5 text-xs">{children}</code>
                    );
                  },
                  pre({ children }) { return <>{children}</>; },
                  table({ children }) {
                    return (
                      <div className="overflow-x-auto -mx-2">
                        <table className="min-w-full">{children}</table>
                      </div>
                    );
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Footer: copy + token badge */}
        <div className={`flex items-center gap-1 mt-1 px-1 ${isUser ? "justify-end" : "justify-start"}`}>
          <CopyButton text={message.content} />
          {!isUser && <TokenBadge message={message as any} />}
        </div>
      </div>
    </div>
  );
}