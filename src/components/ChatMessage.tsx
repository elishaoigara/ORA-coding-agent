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
}

// Languages we can run inline in a sandboxed iframe
const RUNNABLE_LANGS = new Set(["javascript", "js", "typescript", "ts"]);

function extractCodeFiles(text: string): { path: string; content: string }[] {
  const results: { path: string; content: string }[] = [];
  const regex = /```(?:\w+)?\n([\s\S]*?)```/g;
  let match;
  let i = 1;
  while ((match = regex.exec(text)) !== null) {
    const content = match[1].trimEnd();
    if (content.length > 20) {
      results.push({ path: `file_${i}.txt`, content });
      i++;
    }
  }
  return results;
}

// ── Inline code runner ────────────────────────────────────────────────────────
interface RunOutputLine {
  type: "log" | "error";
  text: string;
}

function useCodeRunner() {
  const [output, setOutput] = useState<RunOutputLine[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback((code: string) => {
    setRunning(true);
    setOutput(null);

    const lines: RunOutputLine[] = [];

    // Build a sandboxed iframe that posts console output back
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.display = "none";
    document.body.appendChild(iframe);

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      iframe.remove();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const { type, logs, message } = event.data ?? {};

      if (type === "result") {
        for (const log of (logs as string[])) {
          lines.push({ type: "log", text: log });
        }
        setOutput([...lines]);
      } else if (type === "error") {
        lines.push({ type: "error", text: message });
        setOutput([...lines]);
      }

      setRunning(false);
      cleanup();
    };

    window.addEventListener("message", onMessage);

    // Timeout after 5 s
    const timeout = setTimeout(() => {
      lines.push({ type: "error", text: "Execution timed out (5 s)" });
      setOutput([...lines]);
      setRunning(false);
      cleanup();
    }, 5000);

    const escapedCode = code.replace(/`/g, "\\`").replace(/\$/g, "\\$");

    iframe.srcdoc = `<!DOCTYPE html><script>
      const logs = [];
      const origLog = console.log;
      const origWarn = console.warn;
      const origInfo = console.info;
      const capture = (...args) => {
        logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
      };
      console.log = (...args) => { capture(...args); origLog(...args); };
      console.warn = (...args) => { capture('[warn] ' + args.join(' ')); origWarn(...args); };
      console.info = (...args) => { capture('[info] ' + args.join(' ')); origInfo(...args); };
      try {
        eval(\`${escapedCode}\`);
        parent.postMessage({ type: 'result', logs }, '*');
      } catch(e) {
        parent.postMessage({ type: 'error', message: e.message }, '*');
      }
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
      className="group relative text-xs text-zinc-600 hover:text-zinc-400 transition-colors tabular-nums"
      title="Token usage"
    >
      {formatTokens(usage.totalTokens)} tok
      {expanded && (
        <span className="absolute bottom-full left-0 mb-1 whitespace-nowrap bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300 text-xs z-10 pointer-events-none">
          ↑ {usage.promptTokens.toLocaleString()} in
          &nbsp;·&nbsp;
          ↓ {usage.completionTokens.toLocaleString()} out
          &nbsp;·&nbsp;
          {formatCost(usage.estimatedCostUsd)}
        </span>
      )}
    </button>
  );
}

// ── Code block with run button ────────────────────────────────────────────────
function CodeBlock({ lang, code, activeRepo }: { lang: string; code: string; activeRepo?: string }) {
  const [copied, setCopied] = useState(false);
  const { output, running, run, clear } = useCodeRunner();
  const canRun = RUNNABLE_LANGS.has(lang.toLowerCase());

  function copy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-zinc-700">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-zinc-900 px-3 py-1.5 border-b border-zinc-700">
        <span className="text-xs text-zinc-500 font-mono">{lang}</span>
        <div className="flex items-center gap-2">
          {canRun && (
            <button
              onClick={() => output ? clear() : run(code)}
              disabled={running}
              className="text-xs text-teal-600 hover:text-teal-400 transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              {running ? (
                <><span className="animate-spin inline-block text-[10px]">⟳</span> running</>
              ) : output ? (
                "× clear"
              ) : (
                "▶ run"
              )}
            </button>
          )}
          <button
            onClick={copy}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {copied ? "✓ copied" : "copy"}
          </button>
        </div>
      </div>

      {/* Code */}
      <SyntaxHighlighter
        style={vscDarkPlus}
        language={lang}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: 0,
          background: "#111",
          fontSize: "12px",
          maxHeight: "600px",
          overflow: "auto",
        }}
      >
        {code}
      </SyntaxHighlighter>

      {/* Run output */}
      {output !== null && (
        <div className="bg-zinc-950 border-t border-zinc-700 px-3 py-2 font-mono text-xs max-h-48 overflow-y-auto">
          {output.length === 0 ? (
            <span className="text-zinc-600">// no output</span>
          ) : (
            output.map((line, i) => (
              <div key={i} className={line.type === "error" ? "text-red-400" : "text-zinc-300"}>
                {line.type === "error" ? "✗ " : ""}{line.text}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ChatMessage({ message, activeRepo }: Props) {
  const isUser = message.role === "user";
  const [showPush, setShowPush] = useState(false);
  const [copied, setCopied] = useState(false);

  const codeFiles = !isUser ? extractCodeFiles(message.content) : [];
  const hasCode   = codeFiles.length > 0;

  function copyAll() {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
        {!isUser && (
          <div className="w-7 h-7 rounded-full bg-teal-900 border border-teal-700 flex items-center justify-center text-teal-300 text-xs font-bold flex-shrink-0 mt-0.5">
            AI
          </div>
        )}

        <div className="max-w-[82%] flex flex-col gap-1">
          <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? "bg-zinc-700 text-zinc-100 rounded-br-none"
              : "bg-zinc-800 text-zinc-200 rounded-bl-none"
          }`}>
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className ?? "");
                    const isInline = !match;
                    if (isInline) {
                      return (
                        <code className="bg-zinc-900 px-1.5 py-0.5 rounded text-teal-300 text-xs font-mono" {...props}>
                          {children}
                        </code>
                      );
                    }
                    const codeStr = String(children).replace(/\n$/, "");
                    return (
                      <CodeBlock
                        lang={match[1]}
                        code={codeStr}
                        activeRepo={activeRepo}
                      />
                    );
                  },
                  p({ children }) { return <p className="mb-2 last:mb-0">{children}</p>; },
                  ul({ children }) { return <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>; },
                  ol({ children }) { return <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>; },
                  blockquote({ children }) {
                    return <blockquote className="border-l-2 border-teal-700 pl-3 text-zinc-400 my-2">{children}</blockquote>;
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            )}
          </div>

          {/* Action row under AI messages */}
          {!isUser && message.content.length > 0 && (
            <div className="flex items-center gap-3 px-1">
              <button onClick={copyAll} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
                {copied ? "✓ copied" : "copy response"}
              </button>
              {hasCode && activeRepo && (
                <button
                  onClick={() => setShowPush(true)}
                  className="text-xs text-teal-600 hover:text-teal-400 transition-colors flex items-center gap-1"
                >
                  ↑ push to GitHub
                </button>
              )}
              {/* Token badge — inline, right-aligned */}
              <span className="ml-auto">
                <TokenBadge message={message} />
              </span>
            </div>
          )}
        </div>

        {isUser && (
          <div className="w-7 h-7 rounded-full bg-zinc-700 border border-zinc-600 flex items-center justify-center text-zinc-300 text-xs font-bold flex-shrink-0 mt-0.5">
            U
          </div>
        )}
      </div>

      {showPush && activeRepo && (
        <PushToGitHub
          repo={activeRepo}
          files={codeFiles}
          onClose={() => setShowPush(false)}
        />
      )}
    </>
  );
}