"use client";

import { useState, useEffect, useRef } from "react";
import GitHubSidebar from "@/components/GitHubSidebar";
import ChatMessage from "@/components/ChatMessage";
import type { Message, InjectedFile } from "@/types";

interface ProviderInfo {
  name: string;
  models: { id: string; label: string }[];
  defaultModel: string;
}

const QUICK_PROMPTS = [
  "Write a Python function to parse JSON safely with error handling",
  "Review my code for bugs and suggest improvements",
  "Explain how async/await works with a clear example",
  "Write unit tests for the function above",
];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [injectedFiles, setInjectedFiles] = useState<InjectedFile[]>([]);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [password, setPassword] = useState("local");
  const [authed, setAuthed] = useState(true);
  const [authError, setAuthError] = useState("");
  const [showSidebar, setShowSidebar] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/provider")
      .then((r) => r.json())
      .then((data) => {
        setProvider(data);
        setSelectedModel(data.defaultModel);
      });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function checkPassword() {
    if (!password.trim()) { setAuthError("Enter the app password"); return; }
    // We verify by making a real request; the API returns 401 if wrong
    fetch("/api/provider", { headers: { "x-app-password": password } })
      .then((r) => {
        if (r.ok) { setAuthed(true); setAuthError(""); }
        else setAuthError("Wrong password");
      });
  }

  async function sendMessage(text?: string) {
    const userText = (text ?? input).trim();
    if (!userText || loading) return;
    setInput("");

    const newMessages: Message[] = [...messages, { role: "user", content: userText }];
    setMessages(newMessages);
    setLoading(true);

    // Placeholder for streaming assistant response
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-app-password": password,
        },
        body: JSON.stringify({
          messages: newMessages,
          model: selectedModel,
          injectedFiles,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessages((m) => [
          ...m.slice(0, -1),
          { role: "assistant", content: `Error: ${err.error}` },
        ]);
        return;
      }

      // Stream the response token by token
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content ?? "";
            fullText += delta;
            setMessages((m) => [
              ...m.slice(0, -1),
              { role: "assistant", content: fullText },
            ]);
          } catch {
            // Incomplete JSON chunk — skip
          }
        }
      }
    } catch (e) {
      setMessages((m) => [
        ...m.slice(0, -1),
        { role: "assistant", content: `Network error: ${(e as Error).message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ── Auth gate ────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 w-80 flex flex-col gap-4">
          <div className="text-center">
            <div className="text-teal-400 text-2xl mb-1">⌘</div>
            <h1 className="text-zinc-100 font-semibold">AI Coding Agent</h1>
            <p className="text-zinc-500 text-sm mt-1">Enter your app password to continue</p>
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && checkPassword()}
            placeholder="Password"
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-teal-600"
            autoFocus
          />
          {authError && <p className="text-red-400 text-xs text-center">{authError}</p>}
          <button
            onClick={checkPassword}
            className="bg-teal-700 hover:bg-teal-600 text-white rounded-lg py-2 text-sm font-medium transition-colors"
          >
            Sign in
          </button>
          <p className="text-zinc-600 text-xs text-center">
            Set APP_PASSWORD in .env.local
          </p>
        </div>
      </div>
    );
  }

  // ── Main UI ──────────────────────────────────────────────
  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="border-b border-zinc-800 px-4 py-2.5 flex items-center gap-3 flex-shrink-0 bg-zinc-950">
        <button
          onClick={() => setShowSidebar((s) => !s)}
          className="text-zinc-500 hover:text-zinc-200 text-sm"
          title="Toggle GitHub sidebar"
        >
          ☰
        </button>
        <span className="text-teal-400 font-mono font-bold tracking-tight">
          code<span className="text-zinc-400">agent</span>
        </span>
        {provider && (
          <>
            <span className="text-zinc-600 text-xs ml-2">{provider.name}</span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-md text-zinc-300 text-xs px-2 py-1 focus:outline-none focus:border-teal-600"
            >
              {provider.models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </>
        )}
        {injectedFiles.length > 0 && (
          <span className="ml-auto text-xs text-teal-500 bg-teal-950 border border-teal-800 rounded-full px-2 py-0.5">
            {injectedFiles.length} file{injectedFiles.length > 1 ? "s" : ""} in context
          </span>
        )}
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="ml-auto text-zinc-600 hover:text-zinc-300 text-xs"
          >
            clear chat
          </button>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* GitHub sidebar */}
        {showSidebar && (
          <GitHubSidebar onFilesChange={setInjectedFiles} />
        )}

        {/* Chat area */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-6 text-center">
                <div>
                  <div className="text-4xl mb-2">⌘</div>
                  <h2 className="text-zinc-200 font-semibold text-lg">Your AI coding agent</h2>
                  <p className="text-zinc-500 text-sm mt-1 max-w-xs">
                    Ask anything. Load GitHub files from the sidebar to give it context.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
                  {QUICK_PROMPTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => sendMessage(p)}
                      className="text-left text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => <ChatMessage key={i} message={msg} />)
            )}
            {loading && messages[messages.length - 1]?.content === "" && (
              <div className="flex gap-2 text-zinc-500 text-sm">
                <span className="animate-pulse">●</span>
                <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>●</span>
                <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>●</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-zinc-800 px-4 py-3 flex-shrink-0 bg-zinc-950">
            <div className="flex gap-3 items-end max-w-4xl mx-auto">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask the coding agent… (Shift+Enter for new line)"
                rows={2}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 text-sm resize-none focus:outline-none focus:border-teal-600 placeholder:text-zinc-600"
              />
              <button
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                className="bg-teal-700 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-4 py-3 text-sm font-medium transition-colors flex-shrink-0"
              >
                {loading ? "…" : "Send"}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
