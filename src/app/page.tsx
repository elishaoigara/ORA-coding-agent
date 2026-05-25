"use client";

import { useState, useEffect, useRef } from "react";
import GitHubSidebar from "@/components/GitHubSidebar";
import ChatMessage from "@/components/ChatMessage";
import ConversationList from "@/components/ConversationList";
import StagedChanges from "@/components/StagedChanges";
import PlanApproval from "@/components/PlanApproval";
import LocalFileContext from "@/components/LocalFileContext";
import { useConversations } from "@/hooks/useConversations";
import { useKeyboardShortcuts, ShortcutHelpModal } from "@/hooks/useKeyboardShortcuts";
import { buildTokenUsage, sumUsage, formatTokens, formatCost } from "@/lib/tokenCost";
import type { Message, InjectedFile, PublicProvider, GitHubContext } from "@/types";
import type { StagedFile } from "@/lib/agentTools";
import type { AgentPlan } from "@/app/api/agent/route";
import type { TokenUsage } from "@/lib/tokenCost";

const QUICK_PROMPTS = [
  "Write a Python function to parse JSON safely with error handling",
  "Review my code for bugs and suggest improvements",
  "Explain how async/await works with a clear example",
  "Write unit tests for the function above",
];

const AGENT_PROMPTS = [
  "Add a logout button to my app",
  "Fix all TypeScript errors in the codebase",
  "Add form validation to all input fields",
  "Add loading states to all async operations",
];

interface RoutingBadge { provider: string; model: string; reason: string; }

type AgentPhase = "idle" | "planning" | "awaiting_approval" | "executing" | "done";

interface ContinueEvent {
  messages: unknown[];
  stagedFiles: StagedFile[];
  progress?: string;
}

export default function Home() {
  const [messages, setMessages]           = useState<Message[]>([]);
  const [routingBadges, setRoutingBadges] = useState<Record<number, RoutingBadge>>({});
  const [input, setInput]                 = useState("");
  const [loading, setLoading]             = useState(false);
  const [injectedFiles, setInjectedFiles] = useState<InjectedFile[]>([]);
  const [activeRepo, setActiveRepo]       = useState("");
  const [providers, setProviders]         = useState<PublicProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("auto");
  const [selectedModel, setSelectedModel] = useState("");
  const [password]                        = useState("local");
  const [showHistory, setShowHistory]     = useState(false);
  const [showGitHub, setShowGitHub]       = useState(false);
  const [mobileSettings, setMobileSettings] = useState(false);
  const [projectInput, setProjectInput]   = useState("");
  const [editingProject, setEditingProject] = useState(false);

  const [agentMode, setAgentMode]         = useState(false);
  const [agentPhase, setAgentPhase]       = useState<AgentPhase>("idle");
  const [agentStatus, setAgentStatus]     = useState("");
  const [currentPlan, setCurrentPlan]     = useState<AgentPlan | null>(null);
  const [currentTask, setCurrentTask]     = useState("");
  const [stagedFiles, setStagedFiles]     = useState<StagedFile[]>([]);

  const [showHelp, setShowHelp]           = useState(false);
  const [localFiles, setLocalFiles]       = useState<InjectedFile[]>([]);
  const [convUsage, setConvUsage]         = useState<TokenUsage | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    conversations, active, activeId, syncing,
    newConversation, saveConversation, saveGitHubContext,
    loadConversation, deleteConversation, setProject,
  } = useConversations();

  useKeyboardShortcuts({
    onSend:          () => !loading && sendMessage(),
    onNewChat:       newConversation,
    onToggleAgent:   () => setAgentMode((v) => !v),
    onToggleHistory: () => setShowHistory((v) => !v),
    onToggleGitHub:  () => setShowGitHub((v) => !v),
    onShowHelp:      () => setShowHelp((v) => !v),
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
      const p = providers.find((p) => p.id === active.provider);
      setSelectedModel(active.model || p?.defaultModel || "");
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
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleProviderChange(providerId: string) {
    setSelectedProviderId(providerId);
    if (providerId === "auto") { setSelectedModel(""); return; }
    const p = providers.find((p) => p.id === providerId);
    if (p) setSelectedModel(p.defaultModel);
  }

  const isAuto         = selectedProviderId === "auto";
  const activeProvider = providers.find((p) => p.id === selectedProviderId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, stagedFiles, currentPlan]);

  function handleFilesChange(files: InjectedFile[], repo: string) {
    setInjectedFiles(files);
    setActiveRepo(repo);
    if (activeId && repo) saveGitHubContext(repo, files);
  }

  async function sendChat(userText: string) {
    const newMessages: Message[] = [...messages, { role: "user", content: userText }];
    setMessages(newMessages);
    setLoading(true);
    const assistantIndex = newMessages.length;
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-app-password": password },
        body: JSON.stringify({
          messages: newMessages,
          model: selectedModel,
          provider: selectedProviderId,
          injectedFiles,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `❌ Error: ${err.error}` }]);
        return;
      }

      if (isAuto) {
        const rp = res.headers.get("X-Routed-Provider") ?? "";
        const rm = res.headers.get("X-Routed-Model") ?? "";
        const rr = res.headers.get("X-Route-Reason") ?? "";
        if (rp) setRoutingBadges((b) => ({ ...b, [assistantIndex]: { provider: rp, model: rm, reason: rr } }));
      }

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText  = "";
      let sseLineBuffer = "";
      let capturedUsage: TokenUsage | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseLineBuffer += decoder.decode(value, { stream: true });
        const rawLines = sseLineBuffer.split("\n");
        sseLineBuffer = rawLines.pop() ?? "";

        let currentEvent = "";
        for (const line of rawLines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
            continue;
          }
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") { currentEvent = ""; continue; }
            try {
              const parsed = JSON.parse(data);
              if (currentEvent === "usage") {
                const resolvedModel = res.headers.get("X-Routed-Model") ?? "";
                const resolvedProv  = res.headers.get("X-Routed-Provider") ?? selectedProviderId;
                capturedUsage = buildTokenUsage(parsed, resolvedProv, resolvedModel);
              } else {
                const delta = parsed.choices?.[0]?.delta?.content ?? "";
                fullText += delta;
                setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: fullText }]);
              }
            } catch { /* incomplete chunk */ }
            currentEvent = "";
          }
        }
      }

      if (capturedUsage) {
        setMessages((m) => {
          const last = m[m.length - 1];
          if (last?.role === "assistant") {
            return [...m.slice(0, -1), { ...last, usage: capturedUsage }];
          }
          return m;
        });
        setConvUsage((prev) => sumUsage([prev, capturedUsage]));
      }

      const ghCtx: GitHubContext | undefined = activeRepo && injectedFiles.length
        ? { repo: activeRepo, files: injectedFiles, pinnedAt: Date.now() } : undefined;
      saveConversation(
        [...newMessages, { role: "assistant", content: fullText }],
        selectedProviderId, selectedModel, active?.project ?? projectInput, ghCtx
      );
    } catch (e) {
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `Network error: ${(e as Error).message}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function readAgentStream(res: Response): Promise<{
    agentText: string;
    plan?: AgentPlan;
    staged: StagedFile[];
    continuePayload?: ContinueEvent;
  }> {
    const reader  = res.body!.getReader();
    const decoder = new TextDecoder();
    let agentText            = "";
    let parsedPlan: AgentPlan | undefined;
    let sseBuffer            = "";
    const staged: StagedFile[]   = [];
    let receivedDone         = false;
    let continuePayload: ContinueEvent | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const rawLines = sseBuffer.split("\n");
      sseBuffer = rawLines.pop() ?? "";

      for (const line of rawLines.filter((l) => l.startsWith("data: "))) {
        try {
          const event = JSON.parse(line.slice(6));

          if (event.type === "progress" || event.type === "tool_call") {
            setAgentStatus(event.text ?? "");
          }
          if (event.type === "text") {
            agentText += event.text ?? "";
            setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: agentText }]);
          }
          if (event.type === "plan") {
            parsedPlan = event.plan;
          }
          if (event.type === "staged") {
            const incoming: StagedFile[] = event.files ?? [];
            staged.push(...incoming);
            setStagedFiles((s) => {
              const existing = new Set(s.map((f) => f.path));
              const newOnes  = incoming.filter((f) => !existing.has(f.path));
              return newOnes.length > 0 ? [...s, ...newOnes] : s;
            });
          }
          if (event.type === "error") {
            const errMsg = `❌ ${event.text}`;
            setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: errMsg }]);
            agentText = errMsg;
          }
          if (event.type === "continue") {
            continuePayload = {
              messages:    event.messages    ?? [],
              stagedFiles: event.stagedFiles ?? [],
              progress:    event.progress,
            };
            if (staged.length > 0) {
              const existing = new Set(continuePayload.stagedFiles.map((f) => f.path));
              for (const f of staged) {
                if (!existing.has(f.path)) continuePayload.stagedFiles.push(f);
              }
            }
            setAgentStatus(continuePayload.progress ?? "Continuing…");
          }
          if (event.type === "done") {
            receivedDone = true;
            setAgentStatus("");
            if (!agentText.trim()) {
              const fallback = staged.length > 0
                ? "Execution complete. Review the staged changes below and push when ready."
                : "⚠️ Agent finished but staged no files. Try switching to DeepSeek V3 or re-run the task.";
              agentText = fallback;
              setMessages((m) => {
                const last = m[m.length - 1];
                if (last?.role === "assistant" && !last.content.trim()) {
                  return [...m.slice(0, -1), { role: "assistant", content: fallback }];
                }
                return m;
              });
            }
          }
        } catch { /* incomplete JSON chunk */ }
      }
    }

    if (!receivedDone && !continuePayload) {
      setAgentStatus("");
      if (!agentText.trim()) {
        const fallback = staged.length > 0
          ? "Execution complete. Review the staged changes below."
          : "⚠️ The request timed out mid-execution. Check if any files were staged below, or try a smaller task.";
        agentText = fallback;
        setMessages((m) => {
          const last = m[m.length - 1];
          if (last?.role === "assistant" && !last.content.trim()) {
            return [...m.slice(0, -1), { role: "assistant", content: fallback }];
          }
          return m;
        });
      }
    }

    return { agentText, plan: parsedPlan, staged, continuePayload };
  }

  async function callAgentApi(params: {
    phase: "plan" | "execute";
    task: string;
    plan?: AgentPlan;
    resumeMessages?: unknown[];
    resumeStagedFiles?: StagedFile[];
  }): Promise<Response> {
    return fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task:              params.task,
        repo:              activeRepo,
        phase:             params.phase,
        plan:              params.plan,
        provider:          isAuto ? "qwen" : selectedProviderId,
        model:             isAuto ? "qwen3-coder-plus" : selectedModel === "deepseek-reasoner" ? "deepseek-chat" : selectedModel,
        resumeMessages:    params.resumeMessages,
        resumeStagedFiles: params.resumeStagedFiles,
      }),
    });
  }

  async function startPlanning(userText: string) {
    if (!activeRepo) {
      setMessages((m) => [...m,
        { role: "user", content: userText },
        { role: "assistant", content: "⚠️ Open the GitHub sidebar and select a repo first." },
      ]);
      return;
    }

    setCurrentTask(userText);
    setCurrentPlan(null);
    setStagedFiles([]);
    setAgentPhase("planning");
    setLoading(true);

    const newMessages: Message[] = [...messages, { role: "user", content: userText }];
    setMessages(newMessages);
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const res = await callAgentApi({ phase: "plan", task: userText });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Agent request failed");
      }

      const { agentText, plan } = await readAgentStream(res);

      if (plan) {
        setCurrentPlan(plan);
        setAgentPhase("awaiting_approval");
      } else {
        setAgentPhase("done");
      }

      saveConversation(
        [...newMessages, { role: "assistant", content: agentText }],
        selectedProviderId, selectedModel, active?.project ?? projectInput
      );
    } catch (e) {
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `❌ ${(e as Error).message}` }]);
      setAgentPhase("idle");
    } finally {
      setLoading(false);
      setAgentStatus("");
    }
  }

  async function executePlan(approvedPlan: AgentPlan) {
    setAgentPhase("executing");
    setLoading(true);
    setStagedFiles([]);
    setCurrentPlan(null);

    const taskSnapshot = currentTask;
    const approvalMsg: Message = { role: "user", content: "✓ Plan approved — execute it now." };
    const newMessages  = [...messages, approvalMsg];
    setMessages(newMessages);
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    let resumeMessages:    unknown[]    | undefined;
    let resumeStagedFiles: StagedFile[] | undefined;
    let finalText  = "";
    let batchCount = 0;
    const MAX_BATCHES = 20;

    try {
      while (batchCount < MAX_BATCHES) {
        batchCount++;

        const res = await callAgentApi({
          phase: "execute",
          task:  taskSnapshot,
          plan:  approvedPlan,
          resumeMessages,
          resumeStagedFiles,
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? "Agent request failed");
        }

        const { agentText, staged, continuePayload } = await readAgentStream(res);

        if (agentText && !agentText.startsWith("❌")) finalText = agentText;

        if (staged.length > 0) {
          setStagedFiles((existing) => {
            const existingPaths = new Set(existing.map((f) => f.path));
            const newOnes = staged.filter((f) => !existingPaths.has(f.path));
            return newOnes.length > 0 ? [...existing, ...newOnes] : existing;
          });
        }

        if (continuePayload) {
          resumeMessages    = continuePayload.messages;
          resumeStagedFiles = continuePayload.stagedFiles;
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }

        break;
      }

      setAgentPhase("done");

      saveConversation(
        [...newMessages, { role: "assistant", content: finalText }],
        selectedProviderId, selectedModel, active?.project ?? projectInput
      );
    } catch (e) {
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `❌ ${(e as Error).message}` }]);
      setAgentPhase("idle");
    } finally {
      setLoading(false);
      setAgentStatus("");
    }
  }

  function rejectPlan() {
    setCurrentPlan(null);
    setAgentPhase("idle");
    setMessages((m) => [...m,
      { role: "assistant", content: "Plan rejected. Describe what you'd like to change and I'll re-plan." },
    ]);
  }

  async function sendMessage(text?: string) {
    const userText = (text ?? input).trim();
    if (!userText || loading || isAgentBusy) return;
    setInput("");
    if (agentMode) {
      await startPlanning(userText);
    } else {
      await sendChat(userText);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function handleNewChat() {
    newConversation();
    setMessages([]);
    setRoutingBadges({});
    setProjectInput("");
    setInjectedFiles([]);
    setActiveRepo("");
    setStagedFiles([]);
    setCurrentPlan(null);
    setAgentPhase("idle");
    setConvUsage(null);
  }

  function handleProjectSave() { setProject(projectInput); setEditingProject(false); }

  const isAgentBusy       = agentPhase === "planning" || agentPhase === "executing";
  const inputDisabled     = loading || (agentMode && !activeRepo) || agentPhase === "awaiting_approval";
  const showStagedChanges = stagedFiles.length > 0 && agentPhase !== "awaiting_approval";

  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-zinc-800 px-3 md:px-4 py-2.5 flex items-center gap-2 md:gap-3 flex-shrink-0 bg-zinc-950 min-w-0">
        <button onClick={() => setShowHistory((s) => !s)} className="text-zinc-500 hover:text-zinc-200 text-xs">🕐</button>
        <span className="text-teal-400 font-mono font-bold tracking-tight">
          code<span className="text-zinc-400">agent</span>
        </span>

        <div className="hidden md:flex items-center gap-2">
          {editingProject ? (
            <input
              value={projectInput}
              onChange={(e) => setProjectInput(e.target.value)}
              onBlur={handleProjectSave}
              onKeyDown={(e) => { if (e.key === "Enter") handleProjectSave(); if (e.key === "Escape") setEditingProject(false); }}
              placeholder="Project name…"
              className="bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-zinc-300 text-xs w-32 focus:outline-none focus:border-teal-600"
              autoFocus
            />
          ) : (
            <button
              onClick={() => setEditingProject(true)}
              className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 rounded px-2 py-0.5 transition-colors"
            >
              {active?.project || projectInput || "＋ project"}
            </button>
          )}

          {convUsage && convUsage.totalTokens > 0 && (
            <span className="text-xs text-zinc-600 tabular-nums">
              {formatTokens(convUsage.totalTokens)} · {formatCost(convUsage.estimatedCostUsd)}
            </span>
          )}
        </div>

        {/* Mode toggle */}
        <div className="flex items-center bg-zinc-800 border border-zinc-700 rounded-lg p-0.5 gap-0.5 flex-shrink-0">
          <button
            onClick={() => { setAgentMode(false); setCurrentPlan(null); setAgentPhase("idle"); }}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${!agentMode ? "bg-zinc-600 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            Chat
          </button>
          <button
            onClick={() => setAgentMode(true)}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${agentMode ? "bg-teal-800 text-teal-100" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            ⚡ Agent
          </button>
        </div>

        {/* Provider + model — desktop only */}
        <div className="hidden md:flex items-center gap-2">
          <select
            value={selectedProviderId}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-md text-zinc-300 text-xs px-2 py-1 focus:outline-none focus:border-teal-600"
          >
            <option value="auto">⚡ Auto</option>
            <option disabled>──────────</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.configured}>
                {p.name}{!p.configured ? " (no key)" : ""}
              </option>
            ))}
          </select>
          {!isAuto && activeProvider && (
            <>
              <span className="text-zinc-700 text-xs">/</span>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded-md text-zinc-300 text-xs px-2 py-1 focus:outline-none focus:border-teal-600"
              >
                {(activeProvider?.models ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </>
          )}
          {isAuto && (
            <span className="text-xs text-amber-400 bg-amber-950 border border-amber-800 rounded-full px-2 py-0.5">
              picks best model
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 md:gap-3 min-w-0">
          {activeRepo && (
            <span className="text-xs text-zinc-500 bg-zinc-800 border border-zinc-700 rounded-full px-2 py-0.5 font-mono truncate max-w-36">
              {activeRepo.split("/")[1]}
            </span>
          )}
          {injectedFiles.length > 0 && (
            <span className="text-xs text-teal-500 bg-teal-950 border border-teal-800 rounded-full px-2 py-0.5">
              📌 {injectedFiles.length} file{injectedFiles.length > 1 ? "s" : ""}
            </span>
          )}
          {syncing && (
            <span className="text-zinc-600 text-xs hidden md:inline" title="Syncing to GitHub Gist…">↻</span>
          )}
          <button
            onClick={() => setShowGitHub((s) => !s)}
            className={`text-xs transition-colors ${showGitHub ? "text-teal-400" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            GitHub
          </button>
          <button
            onClick={() => setMobileSettings(true)}
            className="md:hidden text-zinc-500 hover:text-zinc-200 px-1.5 py-1 text-sm"
            title="Provider settings"
          >
            ⋮
          </button>
        </div>
      </header>

      {/* Mobile settings bottom sheet */}
      {mobileSettings && (
        <>
          <div className="fixed inset-0 bg-black/60 z-50 md:hidden" onClick={() => setMobileSettings(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 border-t border-zinc-700 rounded-t-2xl p-5 space-y-4 md:hidden">
            <div className="flex items-center justify-between mb-1">
              <span className="text-zinc-300 text-sm font-semibold">Settings</span>
              <button onClick={() => setMobileSettings(false)} className="text-zinc-500 hover:text-zinc-200 text-lg">✕</button>
            </div>
            <div>
              <label className="text-zinc-500 text-xs mb-1 block">Project</label>
              {editingProject ? (
                <input value={projectInput} onChange={(e) => setProjectInput(e.target.value)}
                  onBlur={handleProjectSave}
                  onKeyDown={(e) => { if (e.key === "Enter") handleProjectSave(); if (e.key === "Escape") setEditingProject(false); }}
                  placeholder="Project name…"
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-zinc-300 text-sm focus:outline-none focus:border-teal-600"
                  autoFocus />
              ) : (
                <button onClick={() => setEditingProject(true)}
                  className="w-full text-left text-sm text-zinc-400 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 hover:border-zinc-500">
                  {active?.project || projectInput || "＋ Add project name"}
                </button>
              )}
            </div>
            <div>
              <label className="text-zinc-500 text-xs mb-1 block">Provider</label>
              <select value={selectedProviderId} onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 text-sm px-3 py-2 focus:outline-none focus:border-teal-600">
                <option value="auto">⚡ Auto</option>
                <option disabled>──────────</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.configured}>
                    {p.name}{!p.configured ? " (no key)" : ""}
                  </option>
                ))}
              </select>
            </div>
            {!isAuto && activeProvider && (
              <div>
                <label className="text-zinc-500 text-xs mb-1 block">Model</label>
                <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 text-sm px-3 py-2 focus:outline-none focus:border-teal-600">
                  {(activeProvider?.models ?? []).map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
            )}
            {convUsage && convUsage.totalTokens > 0 && (
              <p className="text-zinc-600 text-xs text-center">
                {formatTokens(convUsage.totalTokens)} · {formatCost(convUsage.estimatedCostUsd)}
              </p>
            )}
            {syncing && <p className="text-zinc-600 text-xs text-center">↻ Syncing to GitHub Gist…</p>}
          </div>
        </>
      )}

      <div className="flex flex-1 overflow-hidden">
        {showHistory && (
          <div className="fixed md:static inset-y-0 left-0 z-40 w-72 md:w-60 border-r border-zinc-800 flex flex-col bg-zinc-950 flex-shrink-0 shadow-xl md:shadow-none">
            <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
              <span className="text-zinc-500 text-xs uppercase tracking-wider">History</span>
              <button onClick={() => setShowHistory(false)} className="md:hidden text-zinc-600 hover:text-zinc-300 text-sm">✕</button>
            </div>
            <ConversationList
  conversations={conversations}
  currentConversationId={activeId ?? undefined}
  onSelectConversation={(conversation) => loadConversation(conversation.id)}
/>
          </div>
        )}

        {showHistory && (
          <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setShowHistory(false)} />
        )}

        {showGitHub && (
          <>
            <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setShowGitHub(false)} />
            <div className="fixed md:static inset-y-0 right-0 z-40 md:z-auto shadow-xl md:shadow-none">
              <GitHubSidebar
                onFilesChange={handleFilesChange}
                savedContext={active?.githubContext}
                onClose={() => setShowGitHub(false)}
              />
            </div>
          </>
        )}

        <main className="flex-1 flex flex-col overflow-hidden">
          {agentStatus && (
            <div className="px-4 py-2 bg-amber-950 border-b border-amber-900 flex items-center gap-2 flex-shrink-0">
              <span className="animate-spin text-amber-400 text-xs inline-block">⟳</span>
              <span className="text-amber-300 text-xs font-mono">{agentStatus}</span>
            </div>
          )}

          {agentPhase === "executing" && !agentStatus && (
            <div className="px-4 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center gap-2 flex-shrink-0">
              <span className="animate-spin text-zinc-500 text-xs inline-block">⟳</span>
              <span className="text-zinc-500 text-xs">Writing files…</span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-6 text-center">
                <div>
                  <div className="text-4xl mb-2">{agentMode ? "⚡" : "⌘"}</div>
                  <h2 className="text-zinc-200 font-semibold text-lg">
                    {agentMode ? "Agent mode" : "Your AI coding agent"}
                  </h2>
                  <p className="text-zinc-500 text-sm mt-1 max-w-sm">
                    {agentMode
                      ? activeRepo
                        ? "Agent reads your codebase → shows plan → you approve → writes code → you review diffs → push to GitHub."
                        : "Open the GitHub sidebar and select a repo first."
                      : "Chats auto-save. Switch to Agent mode to autonomously edit your repo."}
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-w-lg w-full px-2 md:px-0">
                  {(agentMode ? AGENT_PROMPTS : QUICK_PROMPTS).map((p) => (
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

          {agentPhase === "awaiting_approval" && currentPlan && (
            <PlanApproval
              plan={currentPlan}
              task={currentTask}
              onApprove={executePlan}
              onReject={rejectPlan}
              executing={false}
            />
          )}

          {showStagedChanges && (
            <StagedChanges
              files={stagedFiles}
              repo={activeRepo}
              onPush={async () => {
                setStagedFiles([]);
                setAgentPhase("idle");
                if (currentPlan && activeRepo) {
                  const branch = (document.querySelector('input[placeholder*="Branch"]') as HTMLInputElement)?.value?.trim();
                  if (branch) {
                    const repoRes = await fetch(`/api/github?action=repos`).then(r => r.json()).catch(() => []);
                    const defaultBranch = (repoRes as { full_name: string; default_branch: string }[])
                      .find(r => r.full_name === activeRepo)?.default_branch ?? "main";
                    const prBody = [
                      `## Summary\n${currentPlan.summary}`,
                      `## Approach\n${currentPlan.approach}`,
                      `## Files changed`,
                      currentPlan.changes.map((c: { action: string; path: string; reason: string }) => `- **${c.action}** \`${c.path}\`: ${c.reason}`).join("\n"),
                      `---\n*Generated by ORA coding agent*`,
                    ].join("\n\n");
                    fetch("/api/github", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "create_pr",
                        repo: activeRepo,
                        head: branch,
                        base: defaultBranch,
                        title: currentPlan.summary,
                        body: prBody,
                      }),
                    }).then(r => r.json()).then(pr => {
                      if (pr.url) window.open(pr.url, "_blank");
                    }).catch(console.error);
                  }
                }
              }}
              onDiscard={() => { setStagedFiles([]); setAgentPhase("idle"); }}
            />
          )}

          <div className="border-t border-zinc-800 px-3 md:px-4 py-3 pb-safe flex-shrink-0 bg-zinc-950">
            {agentMode && !activeRepo && (
              <p className="text-amber-500 text-xs mb-2 text-center">
                ⚠ Select a GitHub repo from the sidebar before using Agent mode
              </p>
            )}
            <LocalFileContext
              onFilesLoaded={(files) => {
                setLocalFiles(files);
                setInjectedFiles((prev) => {
                  const localPaths = new Set(files.map((f) => f.path));
                  return [...prev.filter((f) => !localPaths.has(f.path)), ...files];
                });
              }}
            />
            <div className="flex gap-3 items-end max-w-4xl mx-auto">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  agentPhase === "awaiting_approval"
                    ? "Approve or reject the plan above first…"
                    : agentMode && activeRepo
                    ? `Describe a task for ${activeRepo.split("/")[1]}…`
                    : agentMode
                    ? "Select a repo first…"
                    : isAuto
                    ? "Ask anything — Auto picks the best model…"
                    : "Ask the coding agent… (Shift+Enter for newline)"
                }
                disabled={inputDisabled}
                rows={2}
                className={`flex-1 bg-zinc-800 border rounded-xl px-4 py-3 text-zinc-100 text-sm resize-none focus:outline-none placeholder:text-zinc-600 disabled:opacity-50 ${
                  agentMode ? "border-teal-800 focus:border-teal-600" : "border-zinc-700 focus:border-teal-600"
                }`}
              />
              <button
                onClick={() => sendMessage()}
                disabled={inputDisabled || !input.trim() || isAgentBusy}
                className="bg-teal-700 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-4 py-3 text-sm font-medium transition-colors flex-shrink-0"
              >
                {loading ? "…" : agentMode ? "Run" : "Send"}
              </button>
            </div>
          </div>
        </main>
      </div>

      <ShortcutHelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}