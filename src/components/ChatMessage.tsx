"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Message } from "@/types";

interface Props {
  message: Message;
}

export default function ChatMessage({ message }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-teal-900 border border-teal-700 flex items-center justify-center text-teal-300 text-xs font-bold flex-shrink-0 mt-0.5">
          AI
        </div>
      )}

      <div
        className={`max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-zinc-700 text-zinc-100 rounded-br-none"
            : "bg-zinc-800 text-zinc-200 rounded-bl-none"
        }`}
      >
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
                return (
                  <div className="my-3 rounded-lg overflow-hidden border border-zinc-700">
                    <div className="flex items-center justify-between bg-zinc-900 px-3 py-1.5 border-b border-zinc-700">
                      <span className="text-xs text-zinc-500 font-mono">{match[1]}</span>
                      <button
                        onClick={() => navigator.clipboard.writeText(String(children))}
                        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        copy
                      </button>
                    </div>
                    <SyntaxHighlighter
                      style={vscDarkPlus}
                      language={match[1]}
                      PreTag="div"
                      customStyle={{ margin: 0, borderRadius: 0, background: "#111", fontSize: "12px" }}
                    >
                      {String(children).replace(/\n$/, "")}
                    </SyntaxHighlighter>
                  </div>
                );
              },
              p({ children }) {
                return <p className="mb-2 last:mb-0">{children}</p>;
              },
              ul({ children }) {
                return <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>;
              },
              ol({ children }) {
                return <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>;
              },
              blockquote({ children }) {
                return (
                  <blockquote className="border-l-2 border-teal-700 pl-3 text-zinc-400 my-2">
                    {children}
                  </blockquote>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
      </div>

      {isUser && (
        <div className="w-7 h-7 rounded-full bg-zinc-700 border border-zinc-600 flex items-center justify-center text-zinc-300 text-xs font-bold flex-shrink-0 mt-0.5">
          U
        </div>
      )}
    </div>
  );
}
