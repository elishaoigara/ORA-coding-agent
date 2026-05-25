"use client";

import { useState, useEffect, useRef } from "react";
import GitHubSidebar from "@/components/GitHubSidebar";
import ChatMessage from "@/components/ChatMessage";
import ConversationList from "@/components/ConversationList";
import StagedChanges from "@/components/StagedChanges";
import PlanApproval from "@/components/PlanApproval";
import LocalFileContext from "@/components/LocalFileContext";

import { useConversations } from "@/hooks/useConversations";
import {
  useKeyboardShortcuts,
  ShortcutHelpModal,
} from "@/hooks/useKeyboardShortcuts";

import {
  buildTokenUsage,
  sumUsage,
  formatTokens,
  formatCost,
} from "@/lib/tokenCost";

import type {
  Message,
  InjectedFile,
  PublicProvider,
  GitHubContext,
} from "@/types";

import type { StagedFile } from "@/lib/agentTools";
import type { AgentPlan } from "@/app/api/agent/route";
import type { TokenUsage } from "@/lib/tokenCost";

const QUICK_PROMPTS = [
  "Write a Python function to parse JSON safely with error handling",
  "Review my code for bugs and suggest improvements",
  "Explain how async/await works with a clear example",
  "Write unit tests for the function above",
];

interface RoutingBadge {
  provider: string;
  model: string;
  reason: string;
}

type AgentPhase =
  | "idle"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "done";

interface ContinueEvent {
  messages: unknown[];
  stagedFiles: StagedFile[];
  progress?: string;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [routingBadges, setRoutingBadges] = useState<
    Record<number, RoutingBadge>
  >({});
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [injectedFiles, setInjectedFiles] = useState<InjectedFile[]>([]);
  const [activeRepo, setActiveRepo] = useState("");

  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("auto");
  const [selectedModel, setSelectedModel] = useState("");

  const [password] = useState("local");

  const [showHistory, setShowHistory] = useState(false);
  const [showGitHub, setShowGitHub] = useState(false);

  const [projectInput, setProjectInput] = useState("");
  const [editingProject, setEditingProject] = useState(false);

  const [agentMode, setAgentMode] = useState(false);
  const [agentPhase, setAgentPhase] =
    useState<AgentPhase>("idle");
  const [agentStatus, setAgentStatus] = useState("");
  const [currentPlan, setCurrentPlan] =
    useState<AgentPlan | null>(null);
  const [stagedFiles, setStagedFiles] =
    useState<StagedFile[]>([]);

  const [showHelp, setShowHelp] = useState(false);
  const [localFiles, setLocalFiles] = useState<
    InjectedFile[]
  >([]);
  const [convUsage, setConvUsage] =
    useState<TokenUsage | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    conversations,
    active,
    activeId,
    syncing,
    newConversation,
    saveConversation,
    saveGitHubContext,
    loadConversation,
    deleteConversation,
    setProject,
  } = useConversations();

  useKeyboardShortcuts({
    onSend: () => !loading && sendMessage(),
    onNewChat: newConversation,
    onToggleAgent: () => setAgentMode((v) => !v),
    onToggleHistory: () => setShowHistory((v) => !v),
    onToggleGitHub: () => setShowGitHub((v) => !v),
    onShowHelp: () => setShowHelp((v) => !v),
  });

  useEffect(() => {
    fetch("/api/provider")
      .then((r) => r.json())
      .then((data: PublicProvider[]) => setProviders(data));
  }, []);

  useEffect(() => {
    if (active) {
      setMessages(active.messages);
      setRoutingBadges({});
      setSelectedProviderId(active.provider || "auto");

      const p = providers.find(
        (p) => p.id === active.provider
      );

      setSelectedModel(
        active.model || p?.defaultModel || ""
      );

      setProjectInput(active.project || "");

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
  }, [activeId, active, providers]);

  const isAuto = selectedProviderId === "auto";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, loading]);

  function handleFilesChange(
    files: InjectedFile[],
    repo: string
  ) {
    setInjectedFiles(files);
    setActiveRepo(repo);

    if (activeId && repo) {
      saveGitHubContext(repo, files);
    }
  }

  async function sendChat(userText: string) {
    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: userText },
    ];

    setMessages(newMessages);
    setLoading(true);

    setMessages((m) => [
      ...m,
      { role: "assistant", content: "" },
    ]);

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
          provider: selectedProviderId,
          injectedFiles,
        }),
      });

      if (!res.ok) {
        const err = await res.json();

        setMessages((m) => [
          ...m.slice(0, -1),
          {
            role: "assistant",
            content: `❌ Error: ${err.error}`,
          },
        ]);

        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value);

        fullText += chunk;

        setMessages((m) => [
          ...m.slice(0, -1),
          {
            role: "assistant",
            content: fullText,
          },
        ]);
      }

      const ghCtx: GitHubContext | undefined =
        activeRepo && injectedFiles.length
          ? {
              repo: activeRepo,
              files: injectedFiles,
              pinnedAt: Date.now(),
            }
          : undefined;

      saveConversation(
        [
          ...newMessages,
          {
            role: "assistant",
            content: fullText,
          },
        ],
        selectedProviderId,
        selectedModel,
        active?.project ?? projectInput,
        ghCtx
      );
    } catch (e) {
      setMessages((m) => [
        ...m.slice(0, -1),
        {
          role: "assistant",
          content: `Network error: ${
            (e as Error).message
          }`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage(text?: string) {
    const userText = (text ?? input).trim();

    if (!userText || loading) return;

    setInput("");

    await sendChat(userText);
  }

  function handleKeyDown(
    e: React.KeyboardEvent
  ) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center gap-3 bg-zinc-950">
        <button
          onClick={() =>
            setShowHistory((s) => !s)
          }
          className="text-zinc-500 hover:text-zinc-200 text-xs"
        >
          🕐
        </button>

        <span className="text-teal-400 font-mono font-bold tracking-tight">
          code
          <span className="text-zinc-400">
            agent
          </span>
        </span>

        <div className="flex items-center gap-2">
          {editingProject ? (
            <input
              value={projectInput}
              onChange={(e) =>
                setProjectInput(e.target.value)
              }
              onBlur={() => {
                setProject(projectInput);
                setEditingProject(false);
              }}
              className="bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-zinc-300 text-xs"
            />
          ) : (
            <button
              onClick={() =>
                setEditingProject(true)
              }
              className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 rounded px-2 py-0.5"
            >
              {active?.project ||
                projectInput ||
                "＋ project"}
            </button>
          )}

          {convUsage &&
            convUsage.totalTokens > 0 && (
              <span className="text-xs text-zinc-600 tabular-nums">
                {formatTokens(
                  convUsage.totalTokens
                )}{" "}
                ·{" "}
                {formatCost(
                  convUsage.estimatedCostUsd
                )}
              </span>
            )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() =>
              setShowGitHub((s) => !s)
            }
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            GitHub
          </button>

          <button
            onClick={() =>
              setShowHelp(true)
            }
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            ⌨
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {showHistory && (
          <div className="w-60 border-r border-zinc-800 bg-zinc-950">
            <ConversationList
              conversations={conversations}
              currentConversationId={activeId ?? undefined}
              onSelectConversation={(conversation) => {
                loadConversation(conversation.id);
              }}
            />
          </div>
        )}

        {showGitHub && (
          <GitHubSidebar
            onFilesChange={handleFilesChange}
            savedContext={
              active?.githubContext
            }
            onClose={() =>
              setShowGitHub(false)
            }
          />
        )}

        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-6 text-center">
                <div>
                  <div className="text-4xl mb-2">
                    ⌘
                  </div>

                  <h2 className="text-zinc-200 font-semibold text-lg">
                    Your AI coding agent
                  </h2>

                  <p className="text-zinc-500 text-sm mt-1 max-w-sm">
                    Chats auto-save. Switch to
                    Agent mode to autonomously
                    edit your repo.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-w-lg w-full">
                  {QUICK_PROMPTS.map((p) => (
                    <button
                      key={p}
                      onClick={() =>
                        sendMessage(p)
                      }
                      className="text-left text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 hover:border-zinc-600 hover:text-zinc-200"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i}>
                  <ChatMessage
                    message={msg}
                    activeRepo={activeRepo}
                  />
                </div>
              ))
            )}

            <div ref={bottomRef} />
          </div>

          {stagedFiles.length > 0 && (
            <StagedChanges
              files={stagedFiles}
              repo={activeRepo}
              onPush={async () => {
                setStagedFiles([]);
              }}
              onDiscard={() => {
                setStagedFiles([]);
              }}
            />
          )}

          <div className="border-t border-zinc-800 px-4 py-3 bg-zinc-950">
            <LocalFileContext
              onFilesLoaded={(files) => {
                setLocalFiles(files);

                setInjectedFiles((prev) => {
                  const localPaths =
                    new Set(
                      files.map((f) => f.path)
                    );

                  return [
                    ...prev.filter(
                      (f) =>
                        !localPaths.has(f.path)
                    ),
                    ...files,
                  ];
                });
              }}
            />

            <div className="flex gap-3 items-end max-w-4xl mx-auto">
              <textarea
                value={input}
                onChange={(e) =>
                  setInput(e.target.value)
                }
                onKeyDown={handleKeyDown}
                placeholder="Ask the coding agent…"
                disabled={loading}
                rows={2}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 text-sm resize-none focus:outline-none placeholder:text-zinc-600"
              />

              <button
                onClick={() =>
                  sendMessage()
                }
                disabled={
                  loading || !input.trim()
                }
                className="bg-teal-700 hover:bg-teal-600 disabled:opacity-40 text-white rounded-xl px-4 py-3 text-sm font-medium"
              >
                {loading ? "…" : "Send"}
              </button>
            </div>
          </div>
        </main>
      </div>

      <ShortcutHelpModal
        open={showHelp}
        onClose={() => setShowHelp(false)}
      />
    </div>
  );
}