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
import { buildTokenUsage, sumUsage, formatCost } from "@/lib/tokenCost";
import type { Message, InjectedFile, PublicProvider, GitHubContext } from "@/types";
import type { StagedFile } from "@/lib/agentTools";
import type { AgentPlan } from "@/app/api/agent/route";
import type { TokenUsage } from "@/lib/tokenCost";

const QUICK_PROMPTS = [
  "Review my code for bugs and suggest improvements",
  "Explain how async/await works with a clear example",
  "Write unit tests for the function above",
  "Refactor this code to be cleaner and more readable",
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

// Icons
const IconMenu = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);
const IconGitHub = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
  </svg>
);
const IconPlus = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);
const IconSend = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
  </svg>
);
const IconChevron = () => (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
  </svg>
);
const IconX = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

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
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [projectInput, setProjectInput]   = useState("");

  const [agentMode, setAgentMode]         = useState(false);
  const [agentPhase, setAgentPhase]       = useState<AgentPhase>("idle");
  const [agentStatus, setAgentStatus]     = useState("");
  const [currentPlan, setCurrentPlan]     = useState<AgentPlan | null>(null);
  const [currentTask, setCurrentTask]     = useState("");
  const [stagedFiles, setStagedFiles]     = useState<StagedFile[]>([]);

  const [showHelp, setShowHelp]           = useState(false);
  const [localFiles, setLocalFiles]       = useState<InjectedFile[]>([]);
  const [convUsage, setConvUsage]         = useState<TokenUsage | null>(null);
  const [systemPrompt, setSystemPrompt]   = useState("");
  const [branchFirst, setBranchFirst]     = useState(false);
  const [agentBranch, setAgentBranch]     = useState("");

  const [snippets, setSnippets] = useState<{id:string;label:string;lang:string;code:string}[]>(() => {
    try { return JSON.parse(localStorage.getItem("codeagent:snippets") ?? "[]"); } catch { return []; }
  });
  const [pinnedFiles, setPinnedFiles] = useState<Record<string,string[]>>(() => {
    try { return JSON.parse(localStorage.getItem("codeagent:pinnedFiles") ?? "{}"); } catch { return {}; }
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const [kbHeight, setKbHeight] = useState(0);

  // Track software keyboard height via visualViewport so input bar stays visible
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const gap = window.innerHeight - vv.height - vv.offsetTop;
      setKbHeight(Math.max(0, gap));
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
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
          if (line.startsWith("event: ")) { currentEvent = line.slice(7).trim(); continue; }
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
          if (last?.role === "assistant") return [...m.slice(0, -1), { ...last, usage: capturedUsage }];
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
    agentText: string; plan?: AgentPlan; staged: StagedFile[]; continuePayload?: ContinueEvent;
  }> {
    const reader  = res.body!.getReader();
    const decoder = new TextDecoder();
    let agentText = "";
    let parsedPlan: AgentPlan | undefined;
    let sseBuffer = "";
    const staged: StagedFile[] = [];
    let receivedDone = false;
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
          if (event.type === "progress" || event.type === "tool_call") setAgentStatus(event.text ?? "");
          if (event.type === "text") {
            agentText += event.text ?? "";
            setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: agentText }]);
          }
          if (event.type === "plan") parsedPlan = event.plan;
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
            continuePayload = { messages: event.messages ?? [], stagedFiles: event.stagedFiles ?? [], progress: event.progress };
            if (staged.length > 0) {
              const existing = new Set(continuePayload.stagedFiles.map((f) => f.path));
              for (const f of staged) { if (!existing.has(f.path)) continuePayload.stagedFiles.push(f); }
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
                if (last?.role === "assistant" && !last.content.trim())
                  return [...m.slice(0, -1), { role: "assistant", content: fallback }];
                return m;
              });
            }
          }
        } catch { /* incomplete JSON */ }
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
          if (last?.role === "assistant" && !last.content.trim())
            return [...m.slice(0, -1), { role: "assistant", content: fallback }];
          return m;
        });
      }
    }
    return { agentText, plan: parsedPlan, staged, continuePayload };
  }

  async function callAgentApi(params: {
    phase: "plan" | "execute"; task: string; plan?: AgentPlan;
    resumeMessages?: unknown[]; resumeStagedFiles?: StagedFile[];
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
        { role: "assistant", content: "⚠️ Open the GitHub panel and select a repo first." },
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
      } catch { console.warn("Branch creation failed"); }
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
      if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? "Agent request failed"); }
      const { agentText, plan } = await readAgentStream(res);
      if (plan) { setCurrentPlan(plan); setAgentPhase("awaiting_approval"); }
      else setAgentPhase("done");
      saveConversation([...newMessages, { role: "assistant", content: agentText }], selectedProviderId, selectedModel, active?.project ?? projectInput);
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
    const newMessages = [...messages, approvalMsg];
    setMessages(newMessages);
    setMessages((m) => [...m, { role: "assistant", content: "" }]);
    let resumeMessages: unknown[] | undefined;
    let resumeStagedFiles: StagedFile[] | undefined;
    let finalText = "";
    let batchCount = 0;
    const MAX_BATCHES = 20;
    try {
      while (batchCount < MAX_BATCHES) {
        batchCount++;
        const res = await callAgentApi({ phase: "execute", task: taskSnapshot, plan: approvedPlan, resumeMessages, resumeStagedFiles });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? "Agent request failed"); }
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
          resumeMessages = continuePayload.messages;
          resumeStagedFiles = continuePayload.stagedFiles;
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        break;
      }
      setAgentPhase("done");
      saveConversation([...newMessages, { role: "assistant", content: finalText }], selectedProviderId, selectedModel, active?.project ?? projectInput);
    } catch (e) {
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `❌ ${(e as Error).message}` }]);
      setAgentPhase("idle");
    } finally {
      setLoading(false);
      setAgentStatus("");
    }
  }

  async function sendMessage(text?: string) {
    const userText = (text ?? input).trim();
    if (!userText || loading || isAgentBusy) return;
    setInput("");
    if (agentMode) await startPlanning(userText);
    else await sendChat(userText);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function handleNewChat() {
    newConversation();
    setMessages([]); setRoutingBadges({}); setProjectInput(""); setSystemPrompt("");
    setInjectedFiles([]); setActiveRepo(""); setStagedFiles([]); setCurrentPlan(null);
    setAgentPhase("idle"); setConvUsage(null); setAgentBranch("");
  }

  function saveSnippet(lang: string, code: string) {
    const label = prompt("Label for this snippet:", `${lang} snippet`) ?? "";
    if (!label.trim()) return;
    const updated = [...snippets, { id: crypto.randomUUID(), label: label.trim(), lang, code }];
    setSnippets(updated);
    localStorage.setItem("codeagent:snippets", JSON.stringify(updated));
  }

  const closeAll = useCallback(() => {
    setShowHistory(false); setShowGitHub(false); setShowModelPicker(false);
  }, []);

  useEffect(() => { closeAll(); }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const isAgentBusy   = agentPhase === "planning" || agentPhase === "executing";
  const inputDisabled = loading || (agentMode && !activeRepo) || agentPhase === "awaiting_approval";

  // Model label for pill
  const modelLabel = isAuto
    ? "Auto"
    : (activeProvider?.models.find((m) => m.id === selectedModel)?.label ?? selectedModel ?? "Model");
  const providerLabel = isAuto ? "Auto" : (activeProvider?.name ?? selectedProviderId);

  return (
    <div className="flex h-dvh bg-zinc-950 overflow-hidden">

      {/* ── Backdrop ─────────────────────────────────────────────────────── */}
      {(showHistory || showGitHub || showModelPicker) && (
        <div className="mobile-overlay" onClick={closeAll} />
      )}

      {/* ── History sidebar ───────────────────────────────────────────────── */}
      <div className={`sidebar-left ${showHistory ? "open" : ""} md:static md:transform-none md:w-60 md:flex md:flex-col md:border-r md:border-zinc-800 md:bg-transparent`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
          <span className="text-zinc-100 text-sm font-semibold tracking-tight">History</span>
          <div className="flex items-center gap-1">
            <button
              onClick={handleNewChat}
              className="touch-target text-zinc-500 hover:text-zinc-200 transition-colors"
              aria-label="New chat"
            >
              <IconPlus />
            </button>
            <button onClick={() => setShowHistory(false)} className="touch-target text-zinc-500 hover:text-zinc-200 md:hidden">
              <IconX />
            </button>
          </div>
        </div>
        <ConversationList
          conversations={conversations}
          onSelectConversation={(conv) => { loadConversation(conv.id); setShowHistory(false); }}
          onDeleteConversation={deleteConversation}
          currentConversationId={activeId ?? undefined}
        />
      </div>

      {/* ── Main area ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* ── Top bar ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-900/90 backdrop-blur-sm flex-shrink-0">
          {/* Left: menu + title */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="touch-target text-zinc-500 hover:text-zinc-200 md:hidden flex-shrink-0"
              aria-label="History"
            >
              <IconMenu />
            </button>
            <span className="text-zinc-300 text-sm font-medium truncate">
              {active?.title || "New chat"}
            </span>
            {syncing && <span className="text-zinc-600 text-xs animate-pulse flex-shrink-0">⟳</span>}
          </div>

          {/* Right: model pill + mode + github + new */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Model/provider pill — always visible */}
            <button
              onClick={() => setShowModelPicker((v) => !v)}
              className="model-pill"
              aria-label="Select model"
            >
              <span className="max-w-[90px] truncate">{providerLabel}</span>
              <span className="text-zinc-600">·</span>
              <span className="max-w-[80px] truncate text-zinc-400">{modelLabel}</span>
              <IconChevron />
            </button>

            {/* Agent / Chat toggle */}
            <button
              onClick={() => setAgentMode((v) => !v)}
              className={`touch-target rounded-lg px-2.5 text-xs font-medium transition-colors ${
                agentMode
                  ? "bg-violet-700 text-violet-100 agent-active"
                  : "text-zinc-500 hover:text-zinc-200 bg-zinc-800"
              }`}
              style={{ minWidth: 0 }}
            >
              {agentMode ? "Agent" : "Chat"}
            </button>

            {/* GitHub */}
            <button
              onClick={() => setShowGitHub((v) => !v)}
              className={`touch-target rounded-lg transition-colors ${
                showGitHub || activeRepo ? "text-teal-400 bg-teal-900/30" : "text-zinc-500 hover:text-zinc-200"
              }`}
              aria-label="GitHub"
            >
              <IconGitHub />
            </button>

            {/* New chat (desktop) */}
            <button
              onClick={handleNewChat}
              className="touch-target text-zinc-500 hover:text-zinc-200 hidden md:flex"
              aria-label="New chat"
            >
              <IconPlus />
            </button>
          </div>
        </div>

        {/* ── Model picker dropdown ─────────────────────────────────────── */}
        {showModelPicker && (
          <div className="bottom-sheet md:absolute md:top-14 md:right-3 md:bottom-auto md:max-h-[500px] md:w-80 md:border md:border-zinc-700 md:rounded-xl md:shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 sticky top-0 bg-zinc-900 z-10">
              <span className="text-zinc-100 text-sm font-semibold">Model</span>
              <button onClick={() => setShowModelPicker(false)} className="touch-target text-zinc-500 hover:text-zinc-200">
                <IconX />
              </button>
            </div>
            <div className="p-3 space-y-1 overflow-y-auto">
              {/* Auto option */}
              <button
                onClick={() => { handleProviderChange("auto"); setShowModelPicker(false); }}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  selectedProviderId === "auto"
                    ? "bg-violet-800/40 text-violet-200 border border-violet-700/50"
                    : "text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                <div className="font-medium">Auto routing</div>
                <div className="text-xs text-zinc-500 mt-0.5">Smart model selection per task</div>
              </button>

              {providers.map((p) => (
                <div key={p.id}>
                  <div className="px-3 pt-3 pb-1 text-xs text-zinc-600 font-medium uppercase tracking-wider">
                    {p.name} {!p.configured && <span className="text-zinc-700">(not configured)</span>}
                  </div>
                  {p.models.map((m) => (
                    <button
                      key={m.id}
                      disabled={!p.configured}
                      onClick={() => {
                        setSelectedProviderId(p.id);
                        setSelectedModel(m.id);
                        setShowModelPicker(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                        selectedProviderId === p.id && selectedModel === m.id
                          ? "bg-violet-800/40 text-violet-200 border border-violet-700/50"
                          : "text-zinc-300 hover:bg-zinc-800"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {/* System prompt section */}
            <div className="px-4 pb-4 pt-2 border-t border-zinc-800">
              <label className="text-zinc-500 text-xs font-medium block mb-2">System prompt</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                onBlur={() => { if (activeId) saveSystemPrompt(systemPrompt); }}
                rows={2}
                placeholder="Custom instructions..."
                className="input-field w-full px-3 py-2 text-sm placeholder:text-zinc-600 resize-none"
              />
            </div>
          </div>
        )}

        {/* ── Messages ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 space-y-4 mobile-scroll">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-5">
              <div>
                <h1 className="text-3xl font-bold text-zinc-100 tracking-tight">ORA</h1>
                <p className="text-zinc-600 text-sm mt-1">
                  {agentMode ? "Agent mode — select a repo to begin" : "Your AI coding agent"}
                </p>
              </div>

              {/* Current model indicator */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-full text-xs text-zinc-500">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500 flex-shrink-0" />
                {providerLabel} · {modelLabel}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
                {(agentMode ? AGENT_PROMPTS : QUICK_PROMPTS).map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(prompt)}
                    className="text-left text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 hover:bg-zinc-800 hover:border-zinc-700 hover:text-zinc-200 transition-all leading-relaxed"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              {agentMode && !activeRepo && (
                <button
                  onClick={() => setShowGitHub(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-teal-900/30 border border-teal-700/50 rounded-xl text-teal-400 text-sm hover:bg-teal-900/50 transition-colors"
                >
                  <IconGitHub />
                  Connect a repository
                </button>
              )}
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
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex gap-1">
                <div className="thinking-dot" />
                <div className="thinking-dot" />
                <div className="thinking-dot" />
              </div>
              {agentStatus && (
                <span className="text-zinc-500 text-xs truncate max-w-[200px]">{agentStatus}</span>
              )}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Staged changes ────────────────────────────────────────────── */}
        {stagedFiles.length > 0 && (
          <StagedChanges
            files={stagedFiles}
            repo={activeRepo}
            onPush={() => {}}
            onDiscard={() => setStagedFiles([])}
          />
        )}

        {currentPlan && agentPhase === "awaiting_approval" && (
          <PlanApproval
            plan={currentPlan}
            task={currentTask}
            onApprove={(plan) => executePlan(plan)}
            onReject={() => { setCurrentPlan(null); setAgentPhase("idle"); }}
            executing={false}
          />
        )}

        {/* ── Input bar ─────────────────────────────────────────────────── */}
        <div
          className="border-t border-zinc-800 bg-zinc-900/90 backdrop-blur-sm flex-shrink-0"
          style={{ paddingBottom: kbHeight > 0 ? kbHeight : undefined }}
        >
          <div className="px-3 md:px-4 py-2.5 pb-safe">

            {/* Context chips */}
            {(injectedFiles.length > 0 || localFiles.length > 0 || agentMode || activeRepo) && (
              <div className="flex items-center gap-1.5 mb-2 overflow-x-auto pb-1 scrollbar-hide">
                {activeRepo && (
                  <span className="flex items-center gap-1 text-xs text-teal-400 bg-teal-900/30 border border-teal-800/50 rounded-full px-2.5 py-1 whitespace-nowrap flex-shrink-0">
                    <IconGitHub />
                    {activeRepo.split("/").pop()}
                  </span>
                )}
                {injectedFiles.length > 0 && (
                  <span className="text-xs text-zinc-400 bg-zinc-800 rounded-full px-2.5 py-1 whitespace-nowrap flex-shrink-0">
                    {injectedFiles.length} file{injectedFiles.length !== 1 ? "s" : ""}
                  </span>
                )}
                {localFiles.length > 0 && (
                  <span className="text-xs text-blue-400 bg-blue-900/30 rounded-full px-2.5 py-1 whitespace-nowrap flex-shrink-0">
                    {localFiles.length} local
                  </span>
                )}
                {agentMode && (
                  <span className="text-xs text-violet-400 bg-violet-900/30 rounded-full px-2.5 py-1 whitespace-nowrap flex-shrink-0">
                    Agent
                  </span>
                )}
                {convUsage && (
                  <span className="text-xs text-zinc-600 ml-auto flex-shrink-0 whitespace-nowrap">
                    {formatCost(convUsage.estimatedCostUsd)}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-end gap-2">
              {/* Local file attach */}
              <LocalFileContext
                onFilesLoaded={(files) => setLocalFiles((prev) => [...prev, ...files])}
              />

              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    // Auto-grow
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                  }}
                  onFocus={() => {
                    // Give keyboard time to open then scroll to bottom
                    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 320);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    inputDisabled && agentMode && !activeRepo
                      ? "Select a repo first →"
                      : agentMode
                      ? "Tell the agent what to do..."
                      : "Ask anything about your code..."
                  }
                  rows={1}
                  disabled={inputDisabled}
                  className="input-field w-full px-3.5 py-3 text-sm placeholder:text-zinc-600 resize-none min-h-[46px] max-h-[120px] disabled:opacity-40"
                  style={{ fontSize: "16px" }}
                />
              </div>

              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading || inputDisabled}
                className={`flex items-center justify-center rounded-xl px-4 py-3 text-sm font-medium transition-all flex-shrink-0 ${
                  !input.trim() || loading || inputDisabled
                    ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                    : agentMode
                    ? "bg-violet-700 hover:bg-violet-600 text-white"
                    : "bg-teal-700 hover:bg-teal-600 text-white"
                }`}
                aria-label="Send"
              >
                <IconSend />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── GitHub sidebar ────────────────────────────────────────────────── */}
      <div className={`sidebar-right ${showGitHub ? "open" : ""} md:static md:transform-none md:w-72 md:flex md:flex-col md:border-l md:border-zinc-800 md:bg-transparent`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
          <span className="text-zinc-100 text-sm font-semibold">GitHub</span>
          <button onClick={() => setShowGitHub(false)} className="touch-target text-zinc-500 hover:text-zinc-200">
            <IconX />
          </button>
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

      <ShortcutHelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}