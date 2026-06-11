"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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

  // ── Daily workflow booster state ─────────────────────────────────────────────
  const [systemPrompt, setSystemPrompt]   = useState("");
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [branchFirst, setBranchFirst]     = useState(false);
  const [agentBranch, setAgentBranch]     = useState("");
  const [searchQuery, setSearchQuery]     = useState("");
  const [snippets, setSnippets]           = useState<{id:string;label:string;lang:string;code:string}[]>(() => {
    try { return JSON.parse(localStorage.getItem("codeagent:snippets") ?? "[]"); } catch { return []; }
  });
  const [showSnippets, setShowSnippets]   = useState(false);
  const [pinnedFiles, setPinnedFiles]     = useState<Record<string,string[]>>(() => {
    try { return JSON.parse(localStorage.getItem("codeagent:pinnedFiles") ?? "{}"); } catch { return {}; }
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const {
    conversations, active, activeId, syncing,
    newConversation, saveConversation, saveGitHubContext,
    loadConversation, deleteConversation, setProject, saveSystemPrompt,
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
      setSystemPrompt(active.systemPrompt || "");
      if (active.githubContext) {
        setActiveRepo(active.githubContext.repo);
        setInjectedFiles(active.githubContext.files);
      }
    } else {
      setMessages([]);
      setRoutingBadges({});
      setProjectInput("");
      setSystemPrompt("");
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

    const messagesWithSys: Message[] = systemPrompt.trim()
      ? [{ role: "system", content: systemPrompt.trim() }, ...newMessages]
      : newMessages;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-app-password": password },
        body: JSON.stringify({
          messages: messagesWithSys,
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

    if (branchFirst && activeRepo) {
      const slug = userText.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/-$/, "");
      const newBranch = `agent/${slug}-${Date.now().toString(36)}`;
      try {
        await fetch("/api/github", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create_branch", repo: activeRepo, branchName: newBranch }),
        });
        setAgentBranch(newBranch);
      } catch {
        console.warn("Branch creation failed, continuing on default branch");
      }
    } else {
      setAgentBranch("");
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
    setSystemPrompt("");
    setInjectedFiles([]);
    setActiveRepo("");
    setStagedFiles([]);
    setCurrentPlan(null);
    setAgentPhase("idle");
    setConvUsage(null);
    setAgentBranch("");
  }

  function exportMarkdown() {
    const lines: string[] = [];
    if (active?.project) lines.push(`# ${active.project}\n`);
    lines.push(`*Exported ${new Date().toLocaleString()}*\n`);
    if (systemPrompt.trim()) lines.push(`\n> **System prompt:** ${systemPrompt.trim()}\n`);
    messages.forEach((m) => {
      lines.push(`\n---\n**${m.role === "user" ? "You" : "Assistant"}:**\n\n${m.content}`);
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${(active?.project || active?.title || "chat").replace(/\s+/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function saveSnippet(lang: string, code: string) {
    const label = prompt("Label for this snippet:", `${lang} snippet`) ?? "";
    if (!label.trim()) return;
    const updated = [...snippets, { id: crypto.randomUUID(), label: label.trim(), lang, code }];
    setSnippets(updated);
    localStorage.setItem("codeagent:snippets", JSON.stringify(updated));
  }

  function deleteSnippet(id: string) {
    const updated = snippets.filter((s) => s.id !== id);
    setSnippets(updated);
    localStorage.setItem("codeagent:snippets", JSON.stringify(updated));
  }

  function insertSnippet(code: string) {
    setInput((prev) => prev + (prev ? "\n" : "") + "```\n" + code + "\n```");
    setShowSnippets(false);
  }

  function togglePinnedFile(repo: string, filePath: string) {
    setPinnedFiles((prev) => {
      const current = prev[repo] ?? [];
      const updated = current.includes(filePath)
        ? current.filter((p) => p !== filePath)
        : [...current, filePath];
      const next = { ...prev, [repo]: updated };
      localStorage.setItem("codeagent:pinnedFiles", JSON.stringify(next));
      return next;
    });
  }

  function handleProjectSave() { setProject(projectInput); setEditingProject(false); }

  const isAgentBusy       = agentPhase === "planning" || agentPhase === "executing";
  const inputDisabled     = loading || (agentMode && !activeRepo) || agentPhase === "awaiting_approval";
  const showStagedChanges = stagedFiles.length > 0 && agentPhase !== "awaiting_approval";

  // ── Mobile menu handlers ──────────────────────────────────────────────────
  const closeAllMobileMenus = useCallback(() => {
    setShowHistory(false);
    setShowGitHub(false);
    setMobileSettings(false);
    setShowSystemPrompt(false);
    setShowSnippets(false);
  }, []);

  // Close mobile menus on conversation switch
  useEffect(() => {
    closeAllMobileMenus();
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-dvh bg-zinc-950 overflow-hidden">
      {/* ── Mobile overlay ───────────────────────────────────────────────── */}
      {(showHistory || showGitHub || mobileSettings || showSystemPrompt || showSnippets) && (
        <div
          className="mobile-overlay md:hidden"
          onClick={closeAllMobileMenus}
        />
      )}

      {/* ── History sidebar (mobile: overlay) ────────────────────────────── */}
      <div className={`
        ${isMobile ? 'fixed inset-y-0 left-0 z-50 w-[85vw] max-w-[360px] bg-zinc-900 border-r border-zinc-800 transform transition-transform duration-300 ease-in-out' : 'w-64 border-r border-zinc-800 flex-shrink-0 hidden md:flex'}
        ${isMobile && !showHistory ? '-translate-x-full' : 'translate-x-0'}
        flex flex-col
      `}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-zinc-200 text-sm font-semibold">History</h2>
          {isMobile && (
            <button
              onClick={() => setShowHistory(false)}
              className="text-zinc-500 hover:text-zinc-300 p-2 touch-target"
              aria-label="Close history"
            >
              ✕
            </button>
          )}
        </div>
        <ConversationList
          conversations={conversations}
          onSelectConversation={(conv) => {
            loadConversation(conv.id);
            if (isMobile) setShowHistory(false);
          }}
          onDeleteConversation={deleteConversation}
          currentConversationId={activeId ?? undefined}
        />
      </div>

      {/* ── Main chat area ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ── Top bar ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            {/* Mobile menu buttons */}
            <button
              onClick={() => setShowHistory(true)}
              className="md:hidden p-2 text-zinc-400 hover:text-zinc-200 touch-target"
              aria-label="Open history"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <span className="text-zinc-300 text-sm font-medium truncate max-w-[120px] md:max-w-[200px]">
              {active?.title || "New chat"}
            </span>
            {syncing && <span className="text-zinc-600 text-xs animate-pulse">⟳</span>}
          </div>

          <div className="flex items-center gap-1">
            {/* Agent mode toggle */}
            <button
              onClick={() => setAgentMode((v) => !v)}
              className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors touch-target ${
                agentMode
                  ? "bg-purple-700 text-purple-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {agentMode ? "🤖 Agent" : "💬 Chat"}
            </button>

            {/* GitHub button */}
            <button
              onClick={() => setShowGitHub((v) => !v)}
              className={`p-2 rounded-lg transition-colors touch-target ${
                showGitHub ? "bg-zinc-800 text-teal-400" : "text-zinc-500 hover:text-zinc-300"
              }`}
              aria-label="Toggle GitHub sidebar"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
            </button>

            {/* Settings button (mobile) */}
            <button
              onClick={() => setMobileSettings(true)}
              className="md:hidden p-2 text-zinc-500 hover:text-zinc-300 touch-target"
              aria-label="Open settings"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            {/* New chat button */}
            <button
              onClick={newConversation}
              className="p-2 text-zinc-500 hover:text-zinc-300 touch-target"
              aria-label="New conversation"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Messages area ──────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-3 md:px-4 py-4 space-y-4 mobile-scroll">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="mb-6">
                <h1 className="text-2xl md:text-3xl font-bold text-zinc-100 mb-2">ORA</h1>
                <p className="text-zinc-500 text-sm">Your AI coding agent</p>
              </div>

              {/* Quick prompts */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg mb-4">
                {(agentMode ? AGENT_PROMPTS : QUICK_PROMPTS).map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(prompt)}
                    className="text-left text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-lg p-3 hover:bg-zinc-800 hover:border-zinc-700 transition-colors touch-target"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              {/* Provider info */}
              <div className="text-xs text-zinc-600">
                {isAuto ? "Auto-routing" : activeProvider?.name || "No provider"} ·{" "}
                {isAuto ? "smart model selection" : selectedModel || "default"}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatMessage
              key={msg.id ?? i}
              message={msg}
              activeRepo={activeRepo}
              onSaveSnippet={saveSnippet}
            />
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-zinc-500 text-sm px-4">
              <span className="animate-pulse">⟳</span>
              <span>{agentStatus || "Thinking..."}</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Staged changes / Plan approval ─────────────────────────────── */}
        {stagedFiles.length > 0 && (
          <StagedChanges
            files={stagedFiles}
            repo={activeRepo}
            onPush={(files) => {
              // Handle push
            }}
            onDiscard={() => setStagedFiles([])}
          />
        )}

        {currentPlan && agentPhase === "awaiting_approval" && (
          <PlanApproval
            plan={currentPlan}
            task={currentTask}
            onApprove={(plan) => {
              // Handle approval
            }}
            onReject={() => {
              setCurrentPlan(null);
              setAgentPhase("idle");
            }}
            executing={false}
          />
        )}

        {/* ── Input area ─────────────────────────────────────────────────── */}
        <div className="border-t border-zinc-800 bg-zinc-900/80 backdrop-blur-sm pb-safe">
          <div className="px-3 md:px-4 py-2">
            {/* Context indicators */}
            <div className="flex items-center gap-2 mb-2 overflow-x-auto">
              {injectedFiles.length > 0 && (
                <span className="text-xs text-teal-400 bg-teal-900/30 rounded-full px-2 py-0.5 whitespace-nowrap">
                  📄 {injectedFiles.length} file{injectedFiles.length !== 1 ? "s" : ""}
                </span>
              )}
              {localFiles.length > 0 && (
                <span className="text-xs text-blue-400 bg-blue-900/30 rounded-full px-2 py-0.5 whitespace-nowrap">
                  📁 {localFiles.length} local
                </span>
              )}
              {agentMode && (
                <span className="text-xs text-purple-400 bg-purple-900/30 rounded-full px-2 py-0.5 whitespace-nowrap">
                  🤖 Agent mode
                </span>
              )}
              {activeRepo && (
                <span className="text-xs text-zinc-500 truncate max-w-[120px]">
                  {activeRepo.split("/").pop()}
                </span>
              )}
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder={agentMode ? "Tell the agent what to do..." : "Ask anything about your code..."}
                  rows={1}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-zinc-100 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-teal-600 resize-none min-h-[44px] max-h-[120px]"
                  style={{ fontSize: "16px" }}
                />
              </div>
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading}
                className="bg-teal-700 hover:bg-teal-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-colors touch-target flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                <span className="hidden sm:inline">Send</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── GitHub sidebar (mobile: overlay) ─────────────────────────────── */}
      <div className={`
        ${isMobile ? 'fixed inset-y-0 right-0 z-50 w-[85vw] max-w-[360px] bg-zinc-900 border-l border-zinc-800 transform transition-transform duration-300 ease-in-out' : 'w-80 border-l border-zinc-800 flex-shrink-0 hidden md:flex'}
        ${isMobile && !showGitHub ? 'translate-x-full' : 'translate-x-0'}
        flex flex-col
      `}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-zinc-200 text-sm font-semibold">GitHub</h2>
          {isMobile && (
            <button
              onClick={() => setShowGitHub(false)}
              className="text-zinc-500 hover:text-zinc-300 p-2 touch-target"
              aria-label="Close GitHub sidebar"
            >
              ✕
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          <GitHubSidebar
            onFilesChange={handleFilesChange}
            savedContext={active?.githubContext}
            onClose={() => setShowGitHub(false)}
            pinnedFiles={pinnedFiles}
            onTogglePinnedFile={(repo, filePath) => {
              setPinnedFiles((prev) => {
                const current = prev[repo] || [];
                const updated = current.includes(filePath)
                  ? current.filter((f) => f !== filePath)
                  : [...current, filePath];
                const next = { ...prev, [repo]: updated };
                localStorage.setItem("codeagent:pinnedFiles", JSON.stringify(next));
                return next;
              });
            }}
          />
        </div>
      </div>

      {/* ── Mobile settings bottom sheet ─────────────────────────────────── */}
      {isMobile && mobileSettings && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="mobile-overlay" onClick={() => setMobileSettings(false)} />
          <div className="mobile-bottom-sheet w-full">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <h2 className="text-zinc-200 text-sm font-semibold">Settings</h2>
              <button
                onClick={() => setMobileSettings(false)}
                className="text-zinc-500 hover:text-zinc-300 p-2 touch-target"
              >
                ✕
              </button>
            </div>
            <div className="p-4 space-y-4">
              {/* Provider selector */}
              <div>
                <label className="text-zinc-400 text-xs mb-1 block">Provider</label>
                <select
                  value={selectedProviderId}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-100 text-sm focus:outline-none focus:border-teal-600"
                >
                  <option value="auto">🤖 Auto (smart routing)</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.configured}>
                      {p.configured ? p.name : `${p.name} (not configured)`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Model selector */}
              {!isAuto && activeProvider && (
                <div>
                  <label className="text-zinc-400 text-xs mb-1 block">Model</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-100 text-sm focus:outline-none focus:border-teal-600"
                  >
                    {activeProvider.models.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Project */}
              <div>
                <label className="text-zinc-400 text-xs mb-1 block">Project</label>
                <input
                  value={projectInput}
                  onChange={(e) => setProjectInput(e.target.value)}
                  onBlur={() => {
                    if (activeId) setProject(projectInput);
                  }}
                  placeholder="e.g. my-app"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-100 text-sm focus:outline-none focus:border-teal-600 placeholder:text-zinc-600"
                />
              </div>

              {/* System prompt */}
              <div>
                <label className="text-zinc-400 text-xs mb-1 block">System prompt</label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  onBlur={() => {
                    if (activeId) saveSystemPrompt(systemPrompt);
                  }}
                  rows={3}
                  placeholder="Custom instructions for the AI..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-100 text-sm focus:outline-none focus:border-teal-600 placeholder:text-zinc-600 resize-none"
                />
              </div>

              {/* Local files */}
              <div>
                <label className="text-zinc-400 text-xs mb-1 block">Local files</label>
                <LocalFileContext onFilesLoaded={(files) => {
                  setLocalFiles((prev) => [...prev, ...files]);
                  setMobileSettings(false);
                }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Help modal ───────────────────────────────────────────────────── */}
      <ShortcutHelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}