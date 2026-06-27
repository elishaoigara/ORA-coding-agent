"use client";

import { useState, useCallback } from "react";
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

function formatTime(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyButton({
  text,
  className = "",
  iconOnly = false,
}: {
  text: string;
  className?: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handle = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  if (iconOnly) {
    return (
      <button
        onClick={handle}
        title={copied ? "Copied!" : "Copy message"}
        className={`flex items-center justify-center w-7 h-7 rounded-lg transition-all ${
          copied
            ? "text-teal-400 bg-teal-900/30"
            : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700"
        } ${className}`}
      >
        {copied ? (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        )}
      </button>
    );
  }

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
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012 2v1" />
          </svg>
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

// ── Token badge ───────────────────────────────────────────────────────────────
function TokenBadge({ message }: { message: Message }) {
  const [expanded, setExpanded] = useState(false);
  const usage = (message as any).usage as
    | { totalTokens: number; promptTokens: number; completionTokens: number; estimatedCostUsd: number }
    | undefined;
  if (!usage) return null;

  return (
    <button
      onClick={() => setExpanded((v) => !v)}
      className="relative text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors tabular-nums leading-none"
      title="Token usage"
    >
      {formatTokens(usage.totalTokens)} tok · {formatCost(usage.estimatedCostUsd)}
      {expanded && (
        <span className="absolute bottom-full left-0 mb-1.5 whitespace-nowrap bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-300 text-[11px] z-10 pointer-events-none shadow-xl">
          ↑ {usage.promptTokens.toLocaleString()} in &nbsp;·&nbsp; ↓ {usage.completionTokens.toLocaleString()} out &nbsp;·&nbsp; {formatCost(usage.estimatedCostUsd)}
        </span>
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

    let timeoutId: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      // Bug fix #4: cancel the parent-side timeout correctly
      clearTimeout(timeoutId);
      if (iframe.parentNode) iframe.remove();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const { type, logs, message } = event.data ?? {};
      if (type === "result") {
        for (const log of (logs as string[])) lines.push({ type: "log", text: log });
        setOutput([...lines]);
      } else if (type === "error") {
        lines.push({ type: "error", text: message });
        setOutput([...lines]);
      }
      setRunning(false);
      cleanup();
    };

    window.addEventListener("message", onMessage);

    // Bug fix #4: store as number ID, not the object
    timeoutId = setTimeout(() => {
      lines.push({ type: "error", text: "Execution timed out (5 s)" });
      setOutput([...lines]);
      setRunning(false);
      cleanup();
    }, 5000);

    const escapedCode = code.replace(/`/g, "\\`").replace(/\$/g, "\\$");
    // Bug fix #4: removed clearTimeout(${timeout}) from srcdoc — the iframe
    // can't cancel a timeout in the parent window context
    iframe.srcdoc = `<!DOCTYPE html><script>
      const logs = [];
      const origLog = console.log, origWarn = console.warn, origInfo = console.info;
      const capture = (...args) => { logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')); };
      console.log   = (...args) => { capture(...args); origLog(...args); };
      console.warn  = (...args) => { capture('[warn] ' + args.join(' ')); origWarn(...args); };
      console.info  = (...args) => { capture('[info] ' + args.join(' ')); origInfo(...args); };
      try { eval(\`${escapedCode}\`); parent.postMessage({ type: 'result', logs }, '*'); }
      catch(e) { parent.postMessage({ type: 'error', message: e.message }, '*'); }
    <\/script>`;
  }, []);

  const clear = useCallback(() => setOutput(null), []);
  return { output, running, run, clear };
}

// ── Code block ────────────────────────────────────────────────────────────────
function CodeBlock({
  lang,
  code,
  activeRepo,
  onSaveSnippet,
}: {
  lang: string;
  code: string;
  activeRepo?: string;
  onSaveSnippet?: (lang: string, code: string) => void;
}) {
  const { output, running, run, clear } = useCodeRunner();
  const [showPush, setShowPush] = useState(false);
  const [showFullCode, setShowFullCode] = useState(false);
  const isRunnable = RUNNABLE_LANGS.has(lang);
  const codeFiles = extractCodeFiles(code);
  const lineCount = code.split("\n").length;
  const isLongCode = lineCount > 30;

  return (
    <div className="relative my-3 rounded-xl overflow-hidden border border-zinc-700/60 shadow-lg">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-zinc-800/90 px-3 py-2 border-b border-zinc-700/60">
        <div className="flex items-center gap-2">
          {/* Traffic-light dots — purely decorative, matches dev tool feel */}
          <span className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-zinc-600" />
            <span className="w-2.5 h-2.5 rounded-full bg-zinc-600" />
            <span className="w-2.5 h-2.5 rounded-full bg-zinc-600" />
          </span>
          {/* Improved #5: code lang pill with teal accent */}
          <span className="text-[11px] text-teal-300 bg-zinc-900/60 border border-teal-700/40 rounded px-1.5 py-0.5 font-mono tracking-wide">
            {lang || "code"}
          </span>
          <span className="text-[11px] text-zinc-600">{lineCount} lines</span>
        </div>

        <div className="flex items-center gap-0.5">
          {isRunnable && (
            <button
              onClick={() => run(code)}
              disabled={running}
              className="text-xs text-teal-400 hover:text-teal-300 px-2 py-1 rounded hover:bg-zinc-700 transition-colors touch-target"
            >
              {running ? "⟳" : "▶ Run"}
            </button>
          )}
          {onSaveSnippet && (
            <button
              onClick={() => onSaveSnippet(lang, code)}
              className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded hover:bg-zinc-700 transition-colors touch-target"
              title="Save as snippet"
            >
              Save
            </button>
          )}
          <CopyButton text={code} className="px-2 py-1 rounded hover:bg-zinc-700" />
        </div>
      </div>

      {/* Code content */}
      <div className="relative">
        {isLongCode && !showFullCode ? (
          <div>
            <SyntaxHighlighter
              language={lang || "text"}
              style={vscDarkPlus}
              customStyle={{
                margin: 0,
                borderRadius: 0,
                fontSize: "13px",
                maxHeight: "300px",
                overflow: "hidden",
                background: "#111113",
              }}
              showLineNumbers
              lineNumberStyle={{ color: "#3f3f46", fontSize: "11px", minWidth: "2.5em" }}
            >
              {code.split("\n").slice(0, 20).join("\n")}
            </SyntaxHighlighter>
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-zinc-950 to-transparent h-16 pointer-events-none" />
            <button
              onClick={() => setShowFullCode(true)}
              className="w-full text-center text-xs text-teal-400 hover:text-teal-300 py-2.5 bg-zinc-900/80 backdrop-blur-sm touch-target border-t border-zinc-700/50"
            >
              Show all {lineCount} lines ↓
            </button>
          </div>
        ) : (
          <SyntaxHighlighter
            language={lang || "text"}
            style={vscDarkPlus}
            customStyle={{
              margin: 0,
              borderRadius: 0,
              fontSize: "13px",
              maxHeight: "480px",
              background: "#111113",
            }}
            showLineNumbers
            lineNumberStyle={{ color: "#3f3f46", fontSize: "11px", minWidth: "2.5em" }}
          >
            {code}
          </SyntaxHighlighter>
        )}
      </div>

      {/* Run output */}
      {output && (
        <div className="bg-zinc-950 border-t border-zinc-700/60 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">Output</span>
            <button
              onClick={clear}
              className="text-[11px] text-zinc-600 hover:text-zinc-400 touch-target"
            >
              Clear
            </button>
          </div>
          <pre className="text-xs font-mono whitespace-pre-wrap max-h-36 overflow-y-auto">
            {output.map((line, i) => (
              <div
                key={i}
                className={line.type === "error" ? "text-red-400" : "text-emerald-400"}
              >
                {line.type === "error" ? "✗ " : "→ "}
                {line.text}
              </div>
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

// ── Inline code (backtick) ────────────────────────────────────────────────────
// Improvement #5: better contrast for inline code pills
function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="text-teal-300 bg-zinc-800 border border-teal-700/40 rounded px-1.5 py-0.5 text-[12px] font-mono">
      {children}
    </code>
  );
}

// ── Main ChatMessage ──────────────────────────────────────────────────────────
export default function ChatMessage({ message, activeRepo, onSaveSnippet }: Props) {
  const isUser   = message.role === "user";
  const isSystem = message.role === "system";
  const [hovered, setHovered] = useState(false);

  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-xs text-zinc-500 italic max-w-lg text-center">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    // Improvement #1: max-w-2xl centred so long lines don't span full width
    <div className="max-w-2xl mx-auto w-full px-2">
      <div
        className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Avatar dot */}
        <div className={`flex-shrink-0 mt-1 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
          isUser ? "bg-violet-700 text-violet-100" : "bg-zinc-700 text-zinc-300"
        }`}>
          {isUser ? "Y" : "AI"}
        </div>

        <div className={`flex flex-col gap-1 min-w-0 flex-1 ${isUser ? "items-end" : "items-start"}`}>
          {/* Bubble */}
          <div className="relative group w-full">
            <div
              className={`rounded-2xl px-4 py-3 ${
                isUser
                  // Improvement #2: violet tint for user messages instead of teal-800
                  ? "bg-violet-950/50 border border-violet-800/40 text-violet-50 rounded-tr-sm"
                  : "bg-zinc-800/80 border border-zinc-700/50 text-zinc-100 rounded-tl-sm"
              }`}
            >
              {isUser ? (
                // Improvement #4: 15px text, relaxed leading
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
              ) : (
                <div className="prose prose-invert max-w-none text-[15px] leading-relaxed prose-p:leading-relaxed prose-p:my-2 prose-headings:text-zinc-100 prose-headings:font-semibold prose-strong:text-zinc-100 prose-li:my-0.5">
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
                        // Improvement #5: inline code pill
                        return <InlineCode>{children}</InlineCode>;
                      },
                      pre({ children }) {
                        return <>{children}</>;
                      },
                      table({ children }) {
                        return (
                          <div className="overflow-x-auto -mx-2 my-2">
                            <table className="min-w-full text-sm border border-zinc-700 rounded-lg overflow-hidden">
                              {children}
                            </table>
                          </div>
                        );
                      },
                      th({ children }) {
                        return (
                          <th className="px-3 py-2 bg-zinc-800 text-zinc-300 text-xs font-medium text-left border-b border-zinc-700">
                            {children}
                          </th>
                        );
                      },
                      td({ children }) {
                        return (
                          <td className="px-3 py-2 border-b border-zinc-800/60 text-zinc-300">
                            {children}
                          </td>
                        );
                      },
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>

            {/* Improvement #3: inline copy button — appears on hover, top-right corner */}
            <div className={`absolute top-2 ${isUser ? "left-2" : "right-2"} transition-opacity duration-150 ${
              hovered ? "opacity-100" : "opacity-0"
            }`}>
              <CopyButton text={message.content} iconOnly />
            </div>
          </div>

          {/* Footer: timestamp + token info */}
          <div className={`flex items-center gap-2 px-1 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
            {/* Improvement #6: timestamp */}
            {(message as any).createdAt && (
              <span className="text-[11px] text-zinc-600">
                {formatTime((message as any).createdAt)}
              </span>
            )}
            {!isUser && <TokenBadge message={message} />}
          </div>
        </div>
      </div>
    </div>
  );
}