"use client";

import { useState, useEffect, useRef } from "react";
import GitHubSidebar from "@/components/GitHubSidebar";
import ChatMessage from "@/components/ChatMessage";
import ConversationList from "@/components/ConversationList";
import StagedChanges from "@/components/StagedChanges";
import PlanApproval from "@/components/PlanApproval";
import { useConversations } from "@/hooks/useConversations";
import type { Message, InjectedFile, PublicProvider, GitHubContext } from "@/types";
import type { StagedFile } from "@/lib/agentTools";
import type { AgentPlan } from "@/app/api/agent/route";

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

export default function Home() {
  const [messages, setMessages]       = useState<Message[]>([]);
  const [routingBadges, setRoutingBadges] = useState<Record<number, RoutingBadge>>({});
  const [input, setInput]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [injectedFiles, setInjectedFiles] = useState<InjectedFile[]>([]);
  const [activeRepo, setActiveRepo]   = useState("");
  const [providers, setProviders]     = useState<PublicProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("auto");
  const [selectedModel, setSelectedModel] = useState("");
  const [password]                    = useState("local");
  const [showHistory, setShowHistory] = useState(true);
  const [showGitHub, setShowGitHub]   = useState(false);
  const [projectInput, setProjectInput] = useState("");
  const [editingProject, setEditingProject] = useState(false);

  // Agent state
  const [agentMode, setAgentMode]     = useState(false);
  const [agentPhase, setAgentPhase]   = useState<AgentPhase>("idle");
  const [agentStatus, setAgentStatus] = useState("");
  const [currentPlan, setCurrentPlan] = useState<AgentPlan | null>(null);
  const [currentTask, setCurrentTask] = useState("");
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    conversations, active, activeId,
    newConversation, saveConversation, saveGitHubContext,
    loadConversation, deleteConversation, setProject,
  } = useConversations();

  useEffect(() => {
    fetch("/api/provider").then((r) => r.json()).then((data: PublicProvider[]) => setProviders(data));
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

  const isAuto = selectedProviderId === "auto";
  const activeProvider = providers.find((p) => p.id === selectedProviderId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, stagedFiles, currentPlan]);

  function handleFilesChange(files: InjectedFile[], repo: string) {
    setInjectedFiles(files);
    setActiveRepo(repo);
    if (activeId && repo) saveGitHubContext(repo, files);
  }

  // ── Normal chat ──────────────────────────────────────────────────────────────
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
        body: JSON.stringify({ messages: newMessages, model: selectedModel, provider: selectedProviderId, injectedFiles }),
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

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n").filter((l) => l.startsWith("data: "))) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta?.content ?? "";
            fullText += delta;
            setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: fullText }]);
          } catch { /* incomplete chunk */ }
        }
      }

      const ghCtx: GitHubContext | undefined = activeRepo && injectedFiles.length
        ? { repo: activeRepo, files: injectedFiles, pinnedAt: Date.now() } : undefined;
      saveConversation([...newMessages, { role: "assistant", content: fullText }],
        selectedProviderId, selectedModel, active?.project ?? projectInput, ghCtx);
    } catch (e) {
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `Network error: ${(e as Error).message}` }]);
    } finally {
      setLoading(false);
    }
  }

  // ── Shared agent SSE reader ──────────────────────────────────────────────────
  async function runAgentStream(
    phase: "plan" | "execute",
    task: string,
    plan?: AgentPlan
  ): Promise<{ agentText: string; plan?: AgentPlan; staged: StagedFile[] }> {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task,
        repo: activeRepo,
        phase,
        plan,
        provider: isAuto ? "qwen" : selectedProviderId,
        model: isAuto ? "qwen3-coder-plus"
          : selectedModel === "deepseek-reasoner" ? "deepseek-chat" : selectedModel,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? "Agent request failed");
    }

    const reader  = res.body!.getReader();
    const decoder = new TextDecoder();
    let agentText = "";
    let parsedPlan: AgentPlan | undefined;
    const staged: StagedFile[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n").filter((l) => l.startsWith("data: "))) {
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
            staged.push(...(event.files ?? []));
            setStagedFiles((s) => [...s, ...(event.files ?? [])]);
          }

          if (event.type === "error") {
            const errMsg = `❌ ${event.text}`;
            setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: errMsg }]);
            agentText = errMsg;
          }

          if (event.type === "done") {
            setAgentStatus("");
            // Final safety net for blank assistant message
            setMessages((m) => {
              const last = m[m.length - 1];
              if (last?.role === "assistant" && !last.content.trim()) {
                const fallback = phase === "plan"
                  ? "Analysis complete. See the plan below."
                  : staged.length > 0
                    ? "Execution complete. Review the staged changes below and push when ready."
                    : "⚠️ Execution finished but no files were staged. Try re-running or switch to Qwen3 Max.";
                agentText = fallback;
                return [...m.slice(0, -1), { role: "assistant", content: fallback }];
              }
              return m;
            });
          }
        } catch { /* incomplete JSON */ }
      }
    }

    return { agentText, plan: parsedPlan, staged };
  }

  // ── Phase 1: Plan ────────────────────────────────────────────────────────────
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
      const { agentText, plan } = await runAgentStream("plan", userText);

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

  // ── Phase 2: Execute (called when user approves plan) ────────────────────────
  async function executePlan(approvedPlan: AgentPlan) {
    setAgentPhase("executing");
    setLoading(true);
    setStagedFiles([]);
    // FIX: clear the plan panel immediately so the UI doesn't go blank —
    // the plan card disappears and the executing status bar takes over.
    setCurrentPlan(null);

    const approvalMsg: Message = {
      role: "user",
      content: "✓ Plan approved — execute it now.",
    };
    const newMessages = [...messages, approvalMsg];
    setMessages(newMessages);
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    // Snapshot task now — currentTask is a closure over React state and is safe here,
    // but capturing it explicitly makes the intent clear and avoids stale-closure risk.
    const taskSnapshot = currentTask;

    try {
      const { agentText, staged } = await runAgentStream("execute", taskSnapshot, approvedPlan);

      // FIX: set phase to "done" so StagedChanges panel renders.
      // Previously this was correct but currentPlan was cleared in finally AFTER
      // setAgentPhase("done"), meaning the plan panel would flicker back briefly.
      // Now currentPlan is cleared above before execution starts.
      setAgentPhase("done");

      saveConversation(
        [...newMessages, { role: "assistant", content: agentText }],
        selectedProviderId, selectedModel, active?.project ?? projectInput
      );

      // If somehow staged files came back from the stream but setStagedFiles
      // inside runAgentStream didn't fire (race condition), set them here as a safety net.
      if (staged.length > 0) {
        setStagedFiles((existing) => existing.length > 0 ? existing : staged);
      }
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
    setMessages((m) => [
      ...m,
      { role: "assistant", content: "Plan rejected. Describe what you'd like to change about the approach and I'll re-plan." },
    ]);
  }

  async function sendMessage(text?: string) {
    const userText = (text ?? input).trim();
    if (!userText || loading) return;
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
  }

  function handleProjectSave() { setProject(projectInput); setEditingProject(false); }

  const isAgentBusy = agentPhase === "planning" || agentPhase === "executing";

  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden">
      <header className="border-b border-zinc-800 px-4 py-2.5 flex items-center gap-3 flex-shrink-0 bg-zinc-950">
        <button onClick={() => setShowHistory((s) => !s)} className="text-zinc-500 hover:text-zinc-200 text-xs">🕐</button>
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

        <div className="flex items-center bg-zinc-800 border border-zinc-700 rounded-lg p-0.5 gap-0.5">
          <button onClick={() => { setAgentMode(false); setCurrentPlan(null); setAgentPhase("idle"); }}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${!agentMode ? "bg-zinc-600 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
            Chat
          </button>
          <button onClick={() => setAgentMode(true)}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${agentMode ? "bg-teal-800 text-teal-100" : "text-zinc-500 hover:text-zinc-300"}`}>
            ⚡ Agent
          </button>
        </div>

        <div className="flex items-center gap-2">
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
            <ConversationList conversations={conversations} activeId={activeId}
              onSelect={loadConversation} onNew={handleNewChat} onDelete={deleteConversation} />
          </div>
        )}

        {showGitHub && <GitHubSidebar onFilesChange={handleFilesChange} savedContext={active?.githubContext} />}

        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Agent status bar — shown while planning or executing */}
          {agentStatus && (
            <div className="px-4 py-2 bg-amber-950 border-b border-amber-900 flex items-center gap-2 flex-shrink-0">
              <span className="animate-spin text-amber-400 text-xs inline-block">⟳</span>
              <span className="text-amber-300 text-xs">{agentStatus}</span>
            </div>
          )}

          {/* Executing indicator — shown when agentStatus is blank mid-execution */}
          {agentPhase === "executing" && !agentStatus && (
            <div className="px-4 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center gap-2 flex-shrink-0">
              <span className="animate-spin text-teal-400 text-xs inline-block">⟳</span>
              <span className="text-zinc-400 text-xs">Executing plan — writing files…</span>
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
                        ? `Give a task. Agent reads your codebase → shows a plan → you approve → it writes the code → you review diffs → push to GitHub.`
                        : "Open the GitHub sidebar and select a repo first."
                      : "Chats are saved automatically. Switch to Agent mode to autonomously edit your repo."}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
                  {(agentMode ? AGENT_PROMPTS : QUICK_PROMPTS).map((p) => (
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

          {/* Plan approval panel — shown after planning phase */}
          {agentPhase === "awaiting_approval" && currentPlan && (
            <PlanApproval
              plan={currentPlan}
              task={currentTask}
              onApprove={executePlan}
              onReject={rejectPlan}
              executing={false}
            />
          )}

          {/* Staged changes panel — shown after execution completes with files */}
          {stagedFiles.length > 0 && agentPhase !== "awaiting_approval" && agentPhase !== "executing" && (
            <StagedChanges
              files={stagedFiles}
              repo={activeRepo}
              onPush={() => { setStagedFiles([]); setAgentPhase("idle"); }}
              onDiscard={() => { setStagedFiles([]); setAgentPhase("idle"); }}
            />
          )}

          <div className="border-t border-zinc-800 px-4 py-3 flex-shrink-0 bg-zinc-950">
            {agentMode && !activeRepo && (
              <p className="text-amber-500 text-xs mb-2 text-center">
                ⚠ Select a GitHub repo from the sidebar before using Agent mode
              </p>
            )}
            <div className="flex gap-3 items-end max-w-4xl mx-auto">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  agentMode
                    ? agentPhase === "awaiting_approval"
                      ? "Approve or reject the plan above first…"
                      : activeRepo
                      ? `Describe a task for ${activeRepo.split("/")[1]}…`
                      : "Select a repo first…"
                    : isAuto ? "Ask anything — Auto picks the best model…"
                    : "Ask the coding agent… (Shift+Enter for newline)"
                }
                disabled={isAgentBusy || agentPhase === "awaiting_approval"}
                rows={2}
                className={`flex-1 bg-zinc-800 border rounded-xl px-4 py-3 text-zinc-100 text-sm resize-none focus:outline-none placeholder:text-zinc-600 disabled:opacity-50 ${
                  agentMode ? "border-teal-800 focus:border-teal-600" : "border-zinc-700 focus:border-teal-600"
                }`}
              />
              <button
                onClick={() => sendMessage()}
                disabled={loading || !input.trim() || (agentMode && !activeRepo) || agentPhase === "awaiting_approval"}
                className="bg-teal-700 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-4 py-3 text-sm font-medium transition-colors flex-shrink-0"
              >
                {loading ? "…" : agentMode ? "Run" : "Send"}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}