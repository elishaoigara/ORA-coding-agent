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
  onOpenArtifact?: (lang: string, code: string, path?: string) => void;
  /** Only passed for the most recent assistant message — regenerates that reply. */
  onRegenerate?: () => void;
}

const EXT_BY_LANG: Record<string, string> = {
  typescript: "ts", ts: "ts", tsx: "tsx", javascript: "js", js: "js", jsx: "jsx",
  python: "py", py: "py", json: "json", html: "html", css: "css", bash: "sh",
  sh: "sh", shell: "sh", yaml: "yml", yml: "yml", sql: "sql", markdown: "md",
  md: "md", go: "go", rust: "rs", rs: "rs", java: "java", c: "c", cpp: "cpp",
};

// Tries to pull an explicit filename out of the code itself, e.g. a leading
// "// path/to/File.tsx" or "# path/to/file.py" comment line — common when
// models label files inline. Falls back to a generic name by language.
function guessFilename(lang: string, code: string, index: number): string {
  const firstLine = code.split("\n", 1)[0]?.trim() ?? "";
  const commentMatch = firstLine.match(/^(?:\/\/|#|--)\s*([\w./-]+\.\w{1,10})\s*$/);
  if (commentMatch) return commentMatch[1];
  const ext = EXT_BY_LANG[lang.toLowerCase()] ?? "txt";
  return `file_${index}.${ext}`;
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

// ── Regenerate button ─────────────────────────────────────────────────────────
function RegenerateButton({ onClick }: { onClick: () => void }) {
  const [spinning, setSpinning] = useState(false);
  return (
    <button
      onClick={() => { setSpinning(true); onClick(); setTimeout(() => setSpinning(false), 600); }}
      title="Regenerate response"
      className="flex items-center gap-1 text-[11px] text-zinc-600 hover:text-zinc-300 light:text-[#a89e8c] light:hover:text-[#4a4335] transition-colors touch-target"
    >
      <svg
        className={`w-3 h-3 ${spinning ? "animate-spin" : ""}`}
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      Regenerate
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
  onOpenArtifact,
  fileIndex,
}: {
  lang: string;
  code: string;
  activeRepo?: string;
  onSaveSnippet?: (lang: string, code: string) => void;
  onOpenArtifact?: (lang: string, code: string, path?: string) => void;
  fileIndex: number;
}) {
  const { output, running, run, clear } = useCodeRunner();
  const [showPush, setShowPush] = useState(false);
  const [showFullCode, setShowFullCode] = useState(false);
  const isRunnable = RUNNABLE_LANGS.has(lang);
  const codeFiles = extractCodeFiles(code);
  const lineCount = code.split("\n").length;
  const isLongCode = lineCount > 30;
  const filename = guessFilename(lang, code, fileIndex);

  // ── Claude-style file card ────────────────────────────────────────────────
  // For substantial code blocks, show a compact clickable card that opens the
  // full file in the side panel instead of dumping it inline in the chat.
  if (onOpenArtifact && lineCount > 6) {
    return (
      <div className="relative my-3">
        <button
          onClick={() => onOpenArtifact(lang, code, filename)}
          className="w-full flex items-center gap-3 rounded-xl border border-zinc-700/60 light:border-[#ddd3bd] bg-zinc-800/60 light:bg-[#efe9dd] hover:bg-zinc-800 hover:border-zinc-600 light:hover:bg-[#e5ded1] light:hover:border-[#c7bda8] px-4 py-3 text-left transition-colors group"
        >
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-zinc-900 light:bg-white text-teal-400 light:text-teal-600 flex-shrink-0">
            <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 2v6h6" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-zinc-100 light:text-[#2b2620] text-sm font-mono truncate">{filename}</div>
            <div className="text-zinc-500 light:text-[#8a7f6d] text-xs">{lineCount} lines · click to view</div>
          </div>
          <svg className="w-4 h-4 text-zinc-500 light:text-[#a89e8c] group-hover:text-zinc-300 light:group-hover:text-[#4a4335] flex-shrink-0 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    );
  }

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
    <code className="text-teal-300 light:text-teal-700 bg-zinc-800 light:bg-teal-50 border border-teal-700/40 light:border-teal-300 rounded px-1.5 py-0.5 text-[12px] font-mono">
      {children}
    </code>
  );
}

// ── Main ChatMessage ──────────────────────────────────────────────────────────
export default function ChatMessage({ message, activeRepo, onSaveSnippet, onOpenArtifact, onRegenerate }: Props) {
  const isUser   = message.role === "user";
  const isSystem = message.role === "system";
  const [hovered, setHovered] = useState(false);
  let codeBlockIndex = 0;

  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <div className="bg-zinc-900 light:bg-white border border-zinc-800 light:border-[#e5ded1] rounded-lg px-4 py-2 text-xs text-zinc-500 light:text-[#8a7f6d] italic max-w-lg text-center">
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
          isUser ? "bg-violet-700 text-violet-100" : "bg-zinc-700 light:bg-[#ddd3bd] text-zinc-300 light:text-[#4a4335]"
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
                  ? "bg-violet-950/50 light:bg-violet-50 border border-violet-800/40 light:border-violet-200 text-violet-50 light:text-violet-900 rounded-tr-sm"
                  : "bg-zinc-800/80 light:bg-white border border-zinc-700/50 light:border-[#e5ded1] text-zinc-100 light:text-[#2b2620] rounded-tl-sm"
              }`}
            >
              {isUser ? (
                // Improvement #4: 15px text, relaxed leading
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
              ) : (
                <div className="prose prose-invert light:prose-slate max-w-none text-[15px] leading-relaxed prose-p:leading-relaxed prose-p:my-2 prose-headings:text-zinc-100 light:prose-headings:text-[#2b2620] prose-headings:font-semibold prose-strong:text-zinc-100 light:prose-strong:text-[#2b2620] prose-li:my-0.5">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ className, children }) {
                        const match = /language-(\w+)/.exec(className || "");
                        const codeString = String(children).replace(/\n$/, "");
                        if (match) {
                          codeBlockIndex += 1;
                          return (
                            <CodeBlock
                              lang={match[1]}
                              code={codeString}
                              activeRepo={activeRepo}
                              onSaveSnippet={onSaveSnippet}
                              onOpenArtifact={onOpenArtifact}
                              fileIndex={codeBlockIndex}
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
                            <table className="min-w-full text-sm border border-zinc-700 light:border-[#ddd3bd] rounded-lg overflow-hidden">
                              {children}
                            </table>
                          </div>
                        );
                      },
                      th({ children }) {
                        return (
                          <th className="px-3 py-2 bg-zinc-800 light:bg-[#efe9dd] text-zinc-300 light:text-[#4a4335] text-xs font-medium text-left border-b border-zinc-700 light:border-[#ddd3bd]">
                            {children}
                          </th>
                        );
                      },
                      td({ children }) {
                        return (
                          <td className="px-3 py-2 border-b border-zinc-800/60 light:border-[#e5ded1] text-zinc-300 light:text-[#4a4335]">
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

          {/* Footer: timestamp + token info + regenerate */}
          <div className={`flex items-center gap-3 px-1 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
            {/* Improvement #6: timestamp */}
            {(message as any).createdAt && (
              <span className="text-[11px] text-zinc-600 light:text-[#a89e8c]">
                {formatTime((message as any).createdAt)}
              </span>
            )}
            {!isUser && <TokenBadge message={message} />}
            {!isUser && onRegenerate && <RegenerateButton onClick={onRegenerate} />}
          </div>
        </div>
      </div>
    </div>
  );
}