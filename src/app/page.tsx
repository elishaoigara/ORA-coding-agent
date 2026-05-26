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

  return (
    <div className="h-screen flex overflow-hidden" style={{background:"#0a0a0a",color:"#e4e4e7"}}>

      {/* ── LEFT SIDEBAR ─────────────────────────────────────────────── */}
      <aside style={{width:"240px",borderRight:"1px solid #1e1e1e",background:"#111",display:"flex",flexDirection:"column",flexShrink:0}}>

        <div style={{padding:"14px 12px 10px",borderBottom:"1px solid #1e1e1e"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"7px"}}>
              <div style={{width:"26px",height:"26px",borderRadius:"6px",background:"linear-gradient(135deg,#14b87a,#0f6e56)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"13px",fontWeight:700,color:"#fff",letterSpacing:"-0.5px"}}>O</div>
              <div>
                <span style={{fontSize:"13px",fontWeight:600,color:"#fff",letterSpacing:"-0.3px"}}>ORA</span>
                <span style={{fontSize:"10px",color:"#555",marginLeft:"5px"}}>coding agent</span>
              </div>
            </div>
            {syncing && <span style={{fontSize:"10px",color:"#555"}} title="Syncing…">↻</span>}
          </div>
          <button
            onClick={handleNewChat}
            style={{width:"100%",display:"flex",alignItems:"center",gap:"7px",background:"#1a1a1a",border:"1px solid #2a2a2a",borderRadius:"8px",padding:"8px 10px",color:"#ccc",fontSize:"12px",cursor:"pointer",transition:"all .15s"}}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor="#14b87a";(e.currentTarget as HTMLElement).style.color="#fff"}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor="#2a2a2a";(e.currentTarget as HTMLElement).style.color="#ccc"}}
          >
            <span style={{fontSize:"16px",color:"#14b87a",lineHeight:1}}>＋</span>
            <span>New chat</span>
            <span style={{marginLeft:"auto",fontSize:"10px",color:"#444",fontFamily:"monospace",background:"#222",border:"1px solid #333",borderRadius:"3px",padding:"1px 4px"}}>⌘K</span>
          </button>
        </div>

        <div style={{padding:"10px 12px 6px",position:"relative"}}>
          <span style={{position:"absolute",left:"22px",top:"50%",transform:"translateY(-50%)",fontSize:"13px",color:"#444",pointerEvents:"none"}}>🔍</span>
          <input
            value={searchQuery}
            onChange={e=>setSearchQuery(e.target.value)}
            placeholder="Search chats…"
            style={{width:"100%",background:"#1a1a1a",border:"1px solid #222",borderRadius:"7px",padding:"6px 8px 6px 28px",fontSize:"12px",color:"#ccc",outline:"none",boxSizing:"border-box"}}
          />
        </div>

        <div style={{flex:1,overflowY:"auto",padding:"0 8px 8px"}}>
          <div style={{fontSize:"10px",color:"#444",textTransform:"uppercase",letterSpacing:".08em",padding:"6px 4px 4px"}}>Recent</div>
          {conversations.length === 0 && (
            <div style={{fontSize:"12px",color:"#444",textAlign:"center",padding:"20px 8px"}}>No chats yet</div>
          )}
          {conversations
            .filter(c => !searchQuery.trim() || c.title.toLowerCase().includes(searchQuery.toLowerCase()) || c.project?.toLowerCase().includes(searchQuery.toLowerCase()) || c.messages.some(m=>m.content.toLowerCase().includes(searchQuery.toLowerCase())))
            .map((conv) => (
              <div
                key={conv.id}
                onClick={() => loadConversation(conv.id)}
                style={{
                  display:"flex",alignItems:"center",gap:"8px",padding:"7px 8px",borderRadius:"7px",cursor:"pointer",marginBottom:"2px",
                  background: activeId === conv.id ? "#0f2e24" : "transparent",
                  border: activeId === conv.id ? "1px solid #1D9E75" : "1px solid transparent",
                  transition:"all .1s",
                }}
                onMouseEnter={e=>{if(activeId!==conv.id)(e.currentTarget as HTMLElement).style.background="#1a1a1a"}}
                onMouseLeave={e=>{if(activeId!==conv.id)(e.currentTarget as HTMLElement).style.background="transparent"}}
              >
                <div style={{width:"6px",height:"6px",borderRadius:"50%",background: activeId===conv.id ? "#14b87a" : "#2a2a2a",flexShrink:0}} />
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:"12px",color: activeId===conv.id ? "#fff" : "#ccc",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{conv.title}</div>
                  <div style={{fontSize:"10px",color:"#555",marginTop:"1px"}}>
                    {conv.project && <span style={{color:"#14b87a",marginRight:"4px"}}>{conv.project}</span>}
                    {new Date(conv.updatedAt).toLocaleDateString()}
                    {conv.systemPrompt && <span style={{marginLeft:"4px",color:"#8b5cf6"}} title="Has system prompt">⚙</span>}
                  </div>
                </div>
                <button
                  onClick={e=>{e.stopPropagation();deleteConversation(conv.id)}}
                  style={{opacity:0,fontSize:"11px",color:"#555",background:"none",border:"none",cursor:"pointer",padding:"2px",borderRadius:"3px",flexShrink:0}}
                  onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.color="#ef4444"}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.color="#555"}}
                  className="conv-del-btn"
                  title="Delete"
                >✕</button>
              </div>
            ))}
        </div>

        <div style={{borderTop:"1px solid #1e1e1e",margin:"0 12px"}} />

        <div style={{padding:"10px 12px 12px"}}>
          <div style={{fontSize:"10px",color:"#444",textTransform:"uppercase",letterSpacing:".08em",marginBottom:"7px"}}>Context</div>
          {activeRepo ? (
            <>
              <div style={{display:"flex",alignItems:"center",gap:"6px",background:"#1a1a1a",border:"1px solid #2a2a2a",borderRadius:"7px",padding:"6px 8px",marginBottom:"5px",cursor:"pointer"}}
                onClick={()=>setShowGitHub(v=>!v)}>
                <span style={{fontSize:"13px"}}>⑂</span>
                <span style={{fontSize:"12px",color:"#ccc",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{activeRepo.split("/")[1]}</span>
                <span style={{fontSize:"10px",background:"#0f2e24",color:"#14b87a",border:"1px solid #1D9E75",borderRadius:"4px",padding:"1px 5px"}}>main</span>
              </div>
              {(pinnedFiles[activeRepo]??[]).slice(0,3).map(f=>(
                <div key={f} style={{display:"flex",alignItems:"center",gap:"5px",padding:"4px 8px",marginBottom:"2px",background:"#161616",border:"1px solid #1e1e1e",borderRadius:"5px"}}>
                  <span style={{fontSize:"11px",color:"#EF9F27"}}>📌</span>
                  <span style={{fontSize:"11px",color:"#888",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{f.split("/").pop()}</span>
                </div>
              ))}
              {injectedFiles.length > 0 && !(pinnedFiles[activeRepo]??[]).length && (
                <div style={{fontSize:"11px",color:"#14b87a",padding:"3px 4px"}}>📎 {injectedFiles.length} file{injectedFiles.length>1?"s":""} in context</div>
              )}
            </>
          ) : (
            <button onClick={()=>setShowGitHub(true)} style={{width:"100%",background:"#1a1a1a",border:"1px dashed #2a2a2a",borderRadius:"7px",padding:"8px",fontSize:"12px",color:"#555",cursor:"pointer",transition:"all .15s"}}
              onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor="#14b87a";(e.currentTarget as HTMLElement).style.color="#ccc"}}
              onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor="#2a2a2a";(e.currentTarget as HTMLElement).style.color="#555"}}
            >
              + Connect GitHub repo
            </button>
          )}
        </div>
      </aside>

      {/* ── MAIN AREA ────────────────────────────────────────────────── */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>

        <header style={{height:"48px",display:"flex",alignItems:"center",gap:"10px",padding:"0 16px",borderBottom:"1px solid #1e1e1e",background:"#111",flexShrink:0}}>
          <div style={{display:"flex",background:"#1a1a1a",border:"1px solid #2a2a2a",borderRadius:"8px",padding:"2px",gap:"2px"}}>
            <button
              onClick={()=>{setAgentMode(false);setCurrentPlan(null);setAgentPhase("idle")}}
              style={{fontSize:"12px",padding:"4px 12px",borderRadius:"6px",border:"none",cursor:"pointer",background:!agentMode?"#2a2a2a":"transparent",color:!agentMode?"#fff":"#666",fontWeight:!agentMode?500:400,transition:"all .15s"}}
            >Chat</button>
            <button
              onClick={()=>setAgentMode(true)}
              style={{fontSize:"12px",padding:"4px 12px",borderRadius:"6px",border:"none",cursor:"pointer",background:agentMode?"#0f2e24":"transparent",color:agentMode?"#14b87a":"#666",fontWeight:agentMode?500:400,transition:"all .15s"}}
            >⚡ Agent</button>
          </div>

          <select value={selectedProviderId} onChange={e=>handleProviderChange(e.target.value)}
            style={{background:"#1a1a1a",border:"1px solid #2a2a2a",borderRadius:"7px",color:"#aaa",fontSize:"12px",padding:"4px 8px",outline:"none",cursor:"pointer"}}>
            <option value="auto">⚡ Auto</option>
            <option disabled>──────</option>
            {providers.map(p=><option key={p.id} value={p.id} disabled={!p.configured}>{p.name}{!p.configured?" (no key)":""}</option>)}
          </select>
          {!isAuto && activeProvider && (
            <select value={selectedModel} onChange={e=>setSelectedModel(e.target.value)}
              style={{background:"#1a1a1a",border:"1px solid #2a2a2a",borderRadius:"7px",color:"#aaa",fontSize:"12px",padding:"4px 8px",outline:"none",cursor:"pointer"}}>
              {(activeProvider?.models??[]).map(m=><option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          )}
          {isAuto && <span style={{fontSize:"11px",color:"#d97706",background:"#1c1206",border:"1px solid #78350f",borderRadius:"20px",padding:"2px 8px"}}>picks best model</span>}

          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:"8px"}}>
            {convUsage && convUsage.totalTokens > 0 && (
              <span style={{fontSize:"11px",color:"#444",fontFamily:"monospace"}}>{formatTokens(convUsage.totalTokens)} · {formatCost(convUsage.estimatedCostUsd)}</span>
            )}
            <button onClick={()=>setShowSystemPrompt(v=>!v)}
              style={{fontSize:"12px",padding:"4px 10px",background:systemPrompt.trim()?"#1e0a3c":"#1a1a1a",border:`1px solid ${systemPrompt.trim()?"#6d28d9":"#2a2a2a"}`,borderRadius:"7px",color:systemPrompt.trim()?"#a78bfa":"#666",cursor:"pointer"}}
              title="System prompt">⚙ prompt</button>
            <button onClick={()=>setShowSnippets(v=>!v)}
              style={{fontSize:"12px",padding:"4px 10px",background:"#1a1a1a",border:`1px solid ${showSnippets?"#b45309":"#2a2a2a"}`,borderRadius:"7px",color:showSnippets?"#f59e0b":"#666",cursor:"pointer"}}
              title="Snippet library">📎 {snippets.length>0?`${snippets.length} snips`:"snippets"}</button>
            <button onClick={exportMarkdown} disabled={messages.length===0}
              style={{fontSize:"12px",padding:"4px 10px",background:"#1a1a1a",border:"1px solid #2a2a2a",borderRadius:"7px",color:messages.length>0?"#666":"#333",cursor:messages.length>0?"pointer":"default"}}
              title="Export as Markdown">↓ .md</button>
            <button onClick={()=>setShowGitHub(s=>!s)}
              style={{fontSize:"12px",padding:"4px 10px",background:showGitHub?"#0f2e24":"#1a1a1a",border:`1px solid ${showGitHub?"#1D9E75":"#2a2a2a"}`,borderRadius:"7px",color:showGitHub?"#14b87a":"#666",cursor:"pointer"}}>
              ⑂ GitHub
            </button>
          </div>
        </header>

        {mobileSettings && (
          <>
            <div className="fixed inset-0 bg-black/60 z-50 md:hidden" onClick={() => setMobileSettings(false)} />
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 border-t border-zinc-700 rounded-t-2xl p-5 space-y-4 md:hidden">
              <div className="flex items-center justify-between mb-1">
                <span className="text-zinc-300 text-sm font-semibold">Settings</span>
                <button onClick={() => setMobileSettings(false)} className="text-zinc-500 hover:text-zinc-200 text-lg">✕</button>
              </div>
            </div>
          </>
        )}

        <div style={{flex:1,display:"flex",overflow:"hidden"}}>

          {showGitHub && (
            <>
              <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setShowGitHub(false)} />
              <div className="fixed md:static inset-y-0 right-0 z-40 md:z-auto shadow-xl md:shadow-none">
                <GitHubSidebar
                  onFilesChange={handleFilesChange}
                  savedContext={active?.githubContext}
                  onClose={() => setShowGitHub(false)}
                  pinnedFiles={pinnedFiles}
                  onTogglePinnedFile={togglePinnedFile}
                />
              </div>
            </>
          )}

          <main style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>

            {showSystemPrompt && (
              <div style={{borderBottom:"1px solid #2d1b69",background:"#130d2e",padding:"12px 16px",flexShrink:0}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"8px"}}>
                  <span style={{fontSize:"12px",color:"#a78bfa",fontWeight:500}}>⚙ System prompt — prepended to every message in this conversation</span>
                  <button onClick={()=>{saveSystemPrompt(systemPrompt);setShowSystemPrompt(false)}} style={{fontSize:"12px",color:"#7c3aed",background:"none",border:"none",cursor:"pointer"}}>Save &amp; close</button>
                </div>
                <textarea value={systemPrompt} onChange={e=>setSystemPrompt(e.target.value)} onBlur={()=>saveSystemPrompt(systemPrompt)}
                  placeholder={`e.g. "This is a React + Supabase project. Always use TypeScript."`}
                  rows={3}
                  style={{width:"100%",background:"#0d0d1a",border:"1px solid #4c1d95",borderRadius:"8px",padding:"8px 12px",fontSize:"12px",color:"#e4e4e7",fontFamily:"monospace",resize:"none",outline:"none",boxSizing:"border-box"}}
                />
              </div>
            )}

            {showSnippets && (
              <div style={{borderBottom:"1px solid #78350f",background:"#1c0d02",padding:"12px 16px",flexShrink:0,maxHeight:"200px",overflowY:"auto"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"8px"}}>
                  <span style={{fontSize:"12px",color:"#f59e0b",fontWeight:500}}>📎 Snippet library</span>
                  <button onClick={()=>setShowSnippets(false)} style={{fontSize:"12px",color:"#555",background:"none",border:"none",cursor:"pointer"}}>✕</button>
                </div>
                {snippets.length === 0 ? (
                  <p style={{fontSize:"12px",color:"#555"}}>No snippets yet — use the 💾 button on any code block to save one.</p>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                    {snippets.map(s=>(
                      <div key={s.id} style={{display:"flex",alignItems:"center",gap:"8px",background:"#111",border:"1px solid #222",borderRadius:"7px",padding:"6px 10px"}}>
                        <span style={{fontSize:"12px",color:"#f59e0b",fontWeight:500,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.label}</span>
                        <span style={{fontSize:"11px",color:"#555",fontFamily:"monospace"}}>{s.lang}</span>
                        <button onClick={()=>insertSnippet(s.code)} style={{fontSize:"11px",color:"#14b87a",background:"#0f2e24",border:"1px solid #1D9E75",borderRadius:"4px",padding:"2px 8px",cursor:"pointer"}}>Insert</button>
                        <button onClick={()=>deleteSnippet(s.id)} style={{fontSize:"11px",color:"#555",background:"none",border:"none",cursor:"pointer"}} onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color="#ef4444"} onMouseLeave={e=>(e.currentTarget as HTMLElement).style.color="#555"}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {agentMode && activeRepo && (
              <div style={{display:"flex",alignItems:"center",gap:"10px",padding:"6px 16px",borderBottom:"1px solid #1e1e1e",background:"#0d0d0d",flexShrink:0,flexWrap:"wrap"}}>
                <label style={{display:"flex",alignItems:"center",gap:"6px",cursor:"pointer"}}>
                  <div onClick={()=>setBranchFirst(v=>!v)}
                    style={{width:"30px",height:"16px",borderRadius:"8px",background:branchFirst?"#1D9E75":"#2a2a2a",position:"relative",cursor:"pointer",transition:"background .2s"}}>
                    <div style={{position:"absolute",top:"2px",width:"12px",height:"12px",background:"#fff",borderRadius:"50%",transition:"transform .2s",transform:branchFirst?"translateX(16px)":"translateX(2px)"}} />
                  </div>
                  <span style={{fontSize:"12px",color:"#888"}}>Branch-first</span>
                </label>
                {branchFirst && agentBranch && (
                  <span style={{fontSize:"11px",color:"#14b87a",fontFamily:"monospace",background:"#0f2e24",border:"1px solid #1D9E75",borderRadius:"4px",padding:"2px 7px"}}>⑂ {agentBranch}</span>
                )}
                {branchFirst && !agentBranch && (
                  <span style={{fontSize:"11px",color:"#555"}}>Auto-creates feature branch before each run</span>
                )}
                {editingProject ? (
                  <input value={projectInput} onChange={e=>setProjectInput(e.target.value)} onBlur={handleProjectSave}
                    onKeyDown={e=>{if(e.key==="Enter")handleProjectSave();if(e.key==="Escape")setEditingProject(false)}}
                    style={{marginLeft:"auto",background:"#1a1a1a",border:"1px solid #14b87a",borderRadius:"5px",padding:"3px 8px",fontSize:"12px",color:"#ccc",outline:"none",width:"120px"}}
                    autoFocus />
                ) : (
                  <button onClick={()=>setEditingProject(true)} style={{marginLeft:"auto",fontSize:"12px",color:"#555",background:"none",border:"1px solid #2a2a2a",borderRadius:"5px",padding:"3px 8px",cursor:"pointer"}}
                    onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color="#ccc"}
                    onMouseLeave={e=>(e.currentTarget as HTMLElement).style.color="#555"}>
                    {active?.project||projectInput||"+ project name"}
                  </button>
                )}
              </div>
            )}

            {agentStatus && (
              <div style={{padding:"7px 16px",background:"#1c0f00",borderBottom:"1px solid #78350f",display:"flex",alignItems:"center",gap:"8px",flexShrink:0}}>
                <span style={{color:"#f59e0b",fontSize:"12px",animation:"spin 1s linear infinite",display:"inline-block"}}>⟳</span>
                <span style={{color:"#d97706",fontSize:"12px",fontFamily:"monospace"}}>{agentStatus}</span>
              </div>
            )}
            {agentPhase==="executing" && !agentStatus && (
              <div style={{padding:"7px 16px",background:"#111",borderBottom:"1px solid #1e1e1e",display:"flex",alignItems:"center",gap:"8px",flexShrink:0}}>
                <span style={{color:"#555",fontSize:"12px"}}>⟳</span>
                <span style={{color:"#555",fontSize:"12px"}}>Writing files…</span>
              </div>
            )}

            <div style={{flex:1,overflowY:"auto",padding:"24px 20px 12px",display:"flex",flexDirection:"column",gap:"20px"}}>
              {messages.length === 0 ? (
                <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"20px",textAlign:"center",padding:"40px 20px"}}>
                  <div>
                    <div style={{fontSize:"36px",marginBottom:"8px"}}>{agentMode?"⚡":"◈"}</div>
                    <h2 style={{fontSize:"18px",fontWeight:600,color:"#fff",marginBottom:"6px"}}>
                      {agentMode ? "ORA Agent" : "ORA Coding Agent"}
                    </h2>
                    <p style={{fontSize:"13px",color:"#555",maxWidth:"340px",lineHeight:1.6}}>
                      {agentMode
                        ? activeRepo
                          ? "Describe a task → ORA plans → you approve → code is written → review diffs → push to GitHub."
                          : "Connect a GitHub repo from the sidebar to start using Agent mode."
                        : "Ask anything about code. Switch to ⚡ Agent mode to autonomously edit your repo."}
                    </p>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",width:"100%",maxWidth:"480px"}}>
                    {(agentMode?AGENT_PROMPTS:QUICK_PROMPTS).map(p=>(
                      <button key={p} onClick={()=>sendMessage(p)}
                        style={{textAlign:"left",fontSize:"12px",color:"#666",background:"#141414",border:"1px solid #1e1e1e",borderRadius:"10px",padding:"10px 12px",cursor:"pointer",lineHeight:1.5,transition:"all .15s"}}
                        onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor="#14b87a";(e.currentTarget as HTMLElement).style.color="#ccc"}}
                        onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor="#1e1e1e";(e.currentTarget as HTMLElement).style.color="#666"}}
                      >{p}</button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg,i)=>(
                  <div key={i}>
                    {msg.role==="assistant" && routingBadges[i] && (
                      <div style={{display:"flex",justifyContent:"flex-start",marginBottom:"4px",marginLeft:"36px"}}>
                        <span style={{fontSize:"11px",color:"#d97706",background:"#1c1206",border:"1px solid #78350f",borderRadius:"20px",padding:"2px 8px"}}>⚡ {routingBadges[i].reason}</span>
                      </div>
                    )}
                    <ChatMessage message={msg} activeRepo={activeRepo} onSaveSnippet={saveSnippet} />
                  </div>
                ))
              )}
              {loading && messages[messages.length-1]?.content==="" && (
                <div style={{display:"flex",gap:"6px",color:"#555",marginLeft:"36px"}}>
                  <span style={{animation:"pulse 1.2s ease-in-out infinite"}}>●</span>
                  <span style={{animation:"pulse 1.2s ease-in-out infinite",animationDelay:"0.2s"}}>●</span>
                  <span style={{animation:"pulse 1.2s ease-in-out infinite",animationDelay:"0.4s"}}>●</span>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {agentPhase==="awaiting_approval" && currentPlan && (
              <PlanApproval plan={currentPlan} task={currentTask} onApprove={executePlan} onReject={rejectPlan} executing={false} />
            )}

            {showStagedChanges && (
              <StagedChanges
                files={stagedFiles}
                repo={activeRepo}
                onPush={async()=>{
                  setStagedFiles([]);setAgentPhase("idle");
                  if(currentPlan&&activeRepo){
                    const branch=(document.querySelector('input[placeholder*="Branch"]') as HTMLInputElement)?.value?.trim();
                    if(branch){
                      const repoRes=await fetch(`/api/github?action=repos`).then(r=>r.json()).catch(()=>[]);
                      const defaultBranch=(repoRes as {full_name:string;default_branch:string}[]).find(r=>r.full_name===activeRepo)?.default_branch??"main";
                      const prBody=[`## Summary\n${currentPlan.summary}`,`## Approach\n${currentPlan.approach}`,`## Files changed`,currentPlan.changes.map((c:{action:string;path:string;reason:string})=>`- **${c.action}** \`${c.path}\`: ${c.reason}`).join("\n"),`---\n*Generated by ORA coding agent*`].join("\n\n");
                      fetch("/api/github",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"create_pr",repo:activeRepo,head:branch,base:defaultBranch,title:currentPlan.summary,body:prBody})}).then(r=>r.json()).then(pr=>{if(pr.url)window.open(pr.url,"_blank")}).catch(console.error);
                    }
                  }
                }}
                onDiscard={()=>{setStagedFiles([]);setAgentPhase("idle")}}
              />
            )}

            <div style={{borderTop:"1px solid #1e1e1e",padding:"10px 16px 14px",background:"#111",flexShrink:0}}>
              {agentMode&&!activeRepo&&(
                <p style={{fontSize:"12px",color:"#d97706",textAlign:"center",marginBottom:"8px"}}>⚠ Connect a GitHub repo from the sidebar to use Agent mode</p>
              )}
              <div style={{display:"flex",gap:"6px",marginBottom:"8px",flexWrap:"wrap",alignItems:"center"}}>
                <LocalFileContext onFilesLoaded={files=>{setLocalFiles(files);setInjectedFiles(prev=>{const lp=new Set(files.map(f=>f.path));return[...prev.filter(f=>!lp.has(f.path)),...files]})}} />
                {agentMode&&activeRepo&&(
                  <button onClick={()=>setBranchFirst(v=>!v)}
                    style={{display:"flex",alignItems:"center",gap:"4px",fontSize:"11px",color:branchFirst?"#14b87a":"#555",background:branchFirst?"#0f2e24":"#1a1a1a",border:`1px solid ${branchFirst?"#1D9E75":"#2a2a2a"}`,borderRadius:"5px",padding:"3px 8px",cursor:"pointer"}}>
                    ⑂ branch-first
                  </button>
                )}
                <span style={{marginLeft:"auto",fontSize:"11px",color:"#333",fontFamily:"monospace"}}>⌘? for shortcuts</span>
              </div>
              <div style={{display:"flex",gap:"8px",alignItems:"flex-end"}}>
                <textarea
                  value={input}
                  onChange={e=>setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    agentPhase==="awaiting_approval" ? "Approve or reject the plan above first…"
                    : agentMode&&activeRepo ? `Describe a task for ${activeRepo.split("/")[1]}…`
                    : agentMode ? "Connect a GitHub repo first…"
                    : isAuto ? "Ask ORA anything — Auto picks the best model…"
                    : "Ask ORA… (Shift+Enter for newline)"
                  }
                  disabled={inputDisabled}
                  rows={2}
                  style={{flex:1,background:"#1a1a1a",border:`1px solid ${agentMode?"#1D9E75":"#2a2a2a"}`,borderRadius:"10px",padding:"10px 14px",fontSize:"13px",color:"#e4e4e7",resize:"none",outline:"none",fontFamily:"inherit",lineHeight:1.5,transition:"border-color .2s",opacity:inputDisabled?0.5:1}}
                  onFocus={e=>(e.currentTarget as HTMLElement).style.borderColor=agentMode?"#14b87a":"#3f3f46"}
                  onBlur={e=>(e.currentTarget as HTMLElement).style.borderColor=agentMode?"#1D9E75":"#2a2a2a"}
                />
                <button
                  onClick={()=>sendMessage()}
                  disabled={inputDisabled||!input.trim()||isAgentBusy}
                  style={{width:"42px",height:"42px",borderRadius:"10px",background:inputDisabled||!input.trim()||isAgentBusy?"#1a1a1a":"#14b87a",border:"none",cursor:inputDisabled||!input.trim()||isAgentBusy?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"18px",color:inputDisabled||!input.trim()||isAgentBusy?"#333":"#000",flexShrink:0,transition:"all .15s"}}
                >
                  {loading?"…":"↑"}
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>

      <style>{`
        .conv-del-btn { opacity: 0 !important; transition: opacity .15s; }
        div:hover > .conv-del-btn { opacity: 1 !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:1} }
        * { scrollbar-width: thin; scrollbar-color: #2a2a2a transparent; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }
        select option { background: #1a1a1a; color: #ccc; }
      `}</style>

      <ShortcutHelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}