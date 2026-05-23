"use client";

import { useState, useEffect, useRef } from "react";
import GitHubSidebar from "@/components/GitHubSidebar";
import ChatMessage from "@/components/ChatMessage";
import ConversationList from "@/components/ConversationList";
import { useConversations } from "@/hooks/useConversations";
import type { Message, InjectedFile, PublicProvider, GitHubContext } from "@/types";

const QUICK_PROMPTS = [
  "Write a Python function to parse JSON safely with error handling",
  "Review my code for bugs and suggest improvements",
  "Explain how async/await works with a clear example",
  "Write unit tests for the function above",
];

interface RoutingBadge { provider: string; model: string; reason: string; }

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [routingBadges, setRoutingBadges] = useState<Record<number, RoutingBadge>>({});
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [injectedFiles, setInjectedFiles] = useState<InjectedFile[]>([]);
  const [activeRepo, setActiveRepo] = useState("");
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("auto");
  const [selectedModel, setSelectedModel] = useState("");
  const [password] = useState("local");
  const [authed] = useState(true);
  const [showHistory, setShowHistory] = useState(true);
  const [showGitHub, setShowGitHub] = useState(false);
  const [projectInput, setProjectInput] = useState("");
  const [editingProject, setEditingProject] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    conversations, active, activeId,
    newConversation, saveConversation, saveGitHubContext,
    loadConversation, deleteConversation, setProject,
  } = useConversations();

  useEffect(() => {
    fetch("/api/provider").then((r) => r.json()).then((data: PublicProvider[]) => setProviders(data));
  }, []);

  // Restore conversation state (messages, provider, GitHub context) when switching
  useEffect(() => {
    if (active) {
      setMessages(active.messages);
      setRoutingBadges({});
      setSelectedProviderId(active.provider || "auto");
      const p = providers.find((p) => p.id === active.provider);
      setSelectedModel(active.model || p?.defaultModel || "");
      setProjectInput(active.project || "");
      // Restore GitHub context so push button works even when sidebar is closed
      if (active.githubContext) {
        setActiveRepo(active.githubContext.repo);
        setInjectedFiles(active.githubContext.files);
      }
    } else {
      setMessages([]);
      setRoutingBadges({});
      setProjectInput("");
      setInjectedFiles([]);
      setActiveRepo("");
    }
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleProviderChange(providerId: string) {
    setSelectedProviderId(providerId);
    if (providerId === "auto") { setSelectedModel(""); return; }
    const p = providers.find((p) => p.id === providerId);
    if (p) setSelectedModel(p.defaultModel);
  }

  const isAuto = selectedProviderId === "auto";
  const activeProvider = providers.find((p) => p.id === selectedProviderId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Called by GitHubSidebar whenever files change
  function handleFilesChange(files: InjectedFile[], repo: string) {
    setInjectedFiles(files);
    setActiveRepo(repo);
    // Persist GitHub context to current conversation if one is open
    if (activeId && repo) {
      saveGitHubContext(repo, files);
    }
  }

  async function sendMessage(text?: string) {
    const userText = (text ?? input).trim();
    if (!userText || loading) return;
    setInput("");

    const newMessages: Message[] = [...messages, { role: "user", content: userText }];
    setMessages(newMessages);
    setLoading(true);
    const assistantIndex = newMessages.length;
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-app-password": password },
        body: JSON.stringify({ messages: newMessages, model: selectedModel, provider: selectedProviderId, injectedFiles }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `❌ Error: ${err.error}` }]);
        return;
      }

      if (isAuto) {
        const routedProvider = res.headers.get("X-Routed-Provider") ?? "";
        const routedModel = res.headers.get("X-Routed-Model") ?? "";
        const routeReason = res.headers.get("X-Route-Reason") ?? "";
        if (routedProvider) {
          setRoutingBadges((b) => ({ ...b, [assistantIndex]: { provider: routedProvider, model: routedModel, reason: routeReason } }));
        }
      }

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
            setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: fullText }]);
          } catch { /* incomplete chunk */ }
        }
      }

      const finalMessages: Message[] = [...newMessages, { role: "assistant", content: fullText }];
      const ghCtx: GitHubContext | undefined = activeRepo && injectedFiles.length
        ? { repo: activeRepo, files: injectedFiles, pinnedAt: Date.now() }
        : undefined;
      saveConversation(finalMessages, selectedProviderId, selectedModel, active?.project ?? projectInput, ghCtx);

    } catch (e) {
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `Network error: ${(e as Error).message}` }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function handleNewChat() { newConversation(); setMessages([]); setRoutingBadges({}); setProjectInput(""); setInjectedFiles([]); setActiveRepo(""); }

  function handleProjectSave() { setProject(projectInput); setEditingProject(false); }

  if (!authed) return null;

  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden">
      <header className="border-b border-zinc-800 px-4 py-2.5 flex items-center gap-3 flex-shrink-0 bg-zinc-950">
        <button onClick={() => setShowHistory((s) => !s)} className="text-zinc-500 hover:text-zinc-200 text-xs" title="Chat history">🕐</button>
        <span className="text-teal-400 font-mono font-bold tracking-tight">code<span className="text-zinc-400">agent</span></span>

        <div className="flex items-center gap-1">
          {editingProject ? (
            <input value={projectInput} onChange={(e) => setProjectInput(e.target.value)}
              onBlur={handleProjectSave}
              onKeyDown={(e) => { if (e.key === "Enter") handleProjectSave(); if (e.key === "Escape") setEditingProject(false); }}
              placeholder="Project name…"
              className="bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-zinc-300 text-xs w-32 focus:outline-none focus:border-teal-600" autoFocus />
          ) : (
            <button onClick={() => setEditingProject(true)} className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 rounded px-2 py-0.5 transition-colors">
              {active?.project || projectInput || "＋ project"}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 ml-1">
          <select value={selectedProviderId} onChange={(e) => handleProviderChange(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-md text-zinc-300 text-xs px-2 py-1 focus:outline-none focus:border-teal-600">
            <option value="auto">⚡ Auto</option>
            <option disabled>──────────</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.configured}>{p.name}{!p.configured ? " (no key)" : ""}</option>
            ))}
          </select>
          {!isAuto && activeProvider && (
            <>
              <span className="text-zinc-700 text-xs">/</span>
              <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded-md text-zinc-300 text-xs px-2 py-1 focus:outline-none focus:border-teal-600">
                {activeProvider.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </>
          )}
          {isAuto && <span className="text-xs text-amber-400 bg-amber-950 border border-amber-800 rounded-full px-2 py-0.5">picks best model</span>}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {injectedFiles.length > 0 && (
            <span className="text-xs text-teal-500 bg-teal-950 border border-teal-800 rounded-full px-2 py-0.5">
              📌 {injectedFiles.length} file{injectedFiles.length > 1 ? "s" : ""} in context
            </span>
          )}
          <button onClick={() => setShowGitHub((s) => !s)}
            className={`text-xs transition-colors ${showGitHub ? "text-teal-400" : "text-zinc-500 hover:text-zinc-300"}`}>
            GitHub
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {showHistory && (
          <div className="w-60 border-r border-zinc-800 flex flex-col bg-zinc-950 flex-shrink-0">
            <div className="px-3 py-2 border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">History</div>
            <ConversationList conversations={conversations} activeId={activeId} onSelect={loadConversation} onNew={handleNewChat} onDelete={deleteConversation} />
          </div>
        )}

        {showGitHub && (
          <GitHubSidebar
            onFilesChange={handleFilesChange}
            savedContext={active?.githubContext}
          />
        )}

        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-6 text-center">
                <div>
                  <div className="text-4xl mb-2">⌘</div>
                  <h2 className="text-zinc-200 font-semibold text-lg">Your AI coding agent</h2>
                  <p className="text-zinc-500 text-sm mt-1 max-w-sm">
                    Chats are saved automatically. Open GitHub to pin files — they stay across sessions.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
                  {QUICK_PROMPTS.map((p) => (
                    <button key={p} onClick={() => sendMessage(p)}
                      className="text-left text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 hover:border-zinc-600 hover:text-zinc-200 transition-colors">
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i}>
                  {msg.role === "assistant" && routingBadges[i] && (
                    <div className="flex justify-start mb-1 ml-10">
                      <span className="text-xs text-amber-400 bg-amber-950 border border-amber-800 rounded-full px-2 py-0.5">
                        ⚡ {routingBadges[i].reason}
                      </span>
                    </div>
                  )}
                  <ChatMessage message={msg} activeRepo={activeRepo} />
                </div>
              ))
            )}
            {loading && messages[messages.length - 1]?.content === "" && (
              <div className="flex gap-2 text-zinc-500 text-sm ml-10">
                <span className="animate-pulse">●</span>
                <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>●</span>
                <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>●</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-zinc-800 px-4 py-3 flex-shrink-0 bg-zinc-950">
            <div className="flex gap-3 items-end max-w-4xl mx-auto">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
                placeholder={isAuto ? "Ask anything — Auto picks the best model…" : "Ask the coding agent… (Shift+Enter for newline)"}
                rows={2} className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 text-sm resize-none focus:outline-none focus:border-teal-600 placeholder:text-zinc-600" />
              <button onClick={() => sendMessage()} disabled={loading || !input.trim()}
                className="bg-teal-700 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-4 py-3 text-sm font-medium transition-colors flex-shrink-0">
                {loading ? "…" : "Send"}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}