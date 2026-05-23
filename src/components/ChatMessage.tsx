"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import PushToGitHub from "./PushToGitHub";
import type { Message } from "@/types";

interface Props {
  message: Message;
  activeRepo?: string;
}

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

export default function ChatMessage({ message, activeRepo }: Props) {
  const isUser = message.role === "user";
  const [showPush, setShowPush] = useState(false);
  const [copied, setCopied] = useState(false);

  const codeFiles = !isUser ? extractCodeFiles(message.content) : [];
  const hasCode = codeFiles.length > 0;

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

        <div className={`max-w-[82%] flex flex-col gap-1`}>
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
                      <div className="my-3 rounded-lg overflow-hidden border border-zinc-700">
                        <div className="flex items-center justify-between bg-zinc-900 px-3 py-1.5 border-b border-zinc-700">
                          <span className="text-xs text-zinc-500 font-mono">{match[1]}</span>
                          <button
                            onClick={() => navigator.clipboard.writeText(codeStr)}
                            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                          >
                            copy
                          </button>
                        </div>
                        <SyntaxHighlighter
                          style={vscDarkPlus}
                          language={match[1]}
                          PreTag="div"
                          customStyle={{ margin: 0, borderRadius: 0, background: "#111", fontSize: "12px", maxHeight: "600px", overflow: "auto" }}
                        >
                          {codeStr}
                        </SyntaxHighlighter>
                      </div>
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

          {/* Action buttons under AI messages */}
          {!isUser && message.content.length > 0 && (
            <div className="flex items-center gap-2 px-1">
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
