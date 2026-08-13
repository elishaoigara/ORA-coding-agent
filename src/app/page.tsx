"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import GitHubSidebar from "@/components/GitHubSidebar";
import ChatMessage from "@/components/ChatMessage";
import ConversationList from "@/components/ConversationList";
import StagedChanges from "@/components/StagedChanges";
import PlanApproval from "@/components/PlanApproval";
import LocalFileContext from "@/components/LocalFileContext";
import ArtifactPanel, { type Artifact } from "@/components/ArtifactPanel";
import ErrorBoundary from "@/components/ErrorBoundary";
import AuthGate from "@/components/AuthGate";
import { useConversations } from "@/hooks/useConversations";
import { useKeyboardShortcuts, ShortcutHelpModal } from "@/hooks/useKeyboardShortcuts";
import { buildTokenUsage, sumUsage, formatCost } from "@/lib/tokenCost";
import { resolveModel, type ProviderId } from "@/lib/providers";
import { useTheme, ThemeToggleButton } from "@/lib/theme";
import { SYSTEM_PROMPT_TEMPLATES } from "@/lib/promptTemplates";
import type { Message, InjectedFile, PublicProvider, GitHubContext } from "@/types";
import type { StagedFile } from "@/lib/agentTools";
import type { AgentPlan } from "@/lib/agent/types";
import type { TokenUsage } from "@/lib/tokenCost";
import { readSse } from "@/lib/readSse";

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

interface AgentStreamEvent {
  type: "meta" | "progress" | "tool_call" | "text" | "plan" | "staged" | "error" | "continue" | "done";
  text?: string;
  plan?: AgentPlan;
  files?: StagedFile[];
  messages?: unknown[];
  stagedFiles?: StagedFile[];
  progress?: string;
}

function upsertStagedFiles(current: StagedFile[], incoming: StagedFile[]): StagedFile[] {
  const byPath = new Map(current.map((file) => [file.path, file]));
  for (const file of incoming) byPath.set(file.path, file);
  return Array.from(byPath.values());
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

function formatContextWindow(tokens?: number): string | null {
  if (!tokens) return null;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M ctx`;
  return `${Math.round(tokens / 1_000)}K ctx`;
}

// Bug fix #9: SSR-safe localStorage helpers
function lsGet(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function lsSet(key: string, value: string) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, value); } catch { /* quota */ }
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
const IconStop = () => (
  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);

function Workspace() {
  const [messages, setMessages]           = useState<Message[]>([]);
  const [routingBadges, setRoutingBadges] = useState<Record<number, RoutingBadge>>({});
  const [input, setInput]                 = useState("");
  const [loading, setLoading]             = useState(false);
  const [injectedFiles, setInjectedFiles] = useState<InjectedFile[]>([]);
  const [activeRepo, setActiveRepo]       = useState("");
  const [providers, setProviders]         = useState<PublicProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("auto");
  const [selectedModel, setSelectedModel] = useState("");
  const [showHistory, setShowHistory]     = useState(false);
  const [showGitHub, setShowGitHub]       = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [projectInput, setProjectInput]   = useState("");

  const [agentMode, setAgentMode]         = useState(false);
  const [agentPhase, setAgentPhase]       = useState<AgentPhase>("idle");
  const [agentStatus, setAgentStatus]     = useState("");
  const [agentIteration, setAgentIteration] = useState(0); // UI improvement #1
  const [currentPlan, setCurrentPlan]     = useState<AgentPlan | null>(null);
  const [currentTask, setCurrentTask]     = useState("");
  const [stagedFiles, setStagedFiles]     = useState<StagedFile[]>([]);
  const [artifact, setArtifact]           = useState<Artifact | null>(null);

  const openArtifact = useCallback((lang: string, code: string, path?: string) => {
    setArtifact({ id: `${Date.now()}`, path: path ?? "file", lang, content: code });
  }, []);

  const [showHelp, setShowHelp]           = useState(false);
  const [localFiles, setLocalFiles]       = useState<InjectedFile[]>([]);
  const [convUsage, setConvUsage]         = useState<TokenUsage | null>(null);
  const [systemPrompt, setSystemPrompt]   = useState("");
  const [branchFirst, setBranchFirst]     = useState(false);
  const [agentBranch, setAgentBranch]     = useState(""); // UI improvement #7

  // Bug fix #9: SSR-safe localStorage initialisation
  const [snippets, setSnippets] = useState<{id:string;label:string;lang:string;code:string}[]>(() => {
    try { return JSON.parse(lsGet("codeagent:snippets", "[]")); } catch { return []; }
  });
  const [pinnedFiles, setPinnedFiles] = useState<Record<string,string[]>>(() => {
    try { return JSON.parse(lsGet("codeagent:pinnedFiles", "{}")); } catch { return {}; }
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const [kbHeight, setKbHeight] = useState(0);
  const abortRef  = useRef<AbortController | null>(null);

  // Track software keyboard height via visualViewport
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
    loadConversation, deleteConversation, saveSystemPrompt,
    forceSync,
  } = useConversations();

  const { toggleTheme } = useTheme();

  useKeyboardShortcuts({
    onSend:          () => !loading && sendMessage(),
    onNewChat:       handleNewChat,
    onToggleAgent:   () => !loading && setAgentMode((v) => !v),
    onToggleHistory: () => setShowHistory((v) => !v),
    onToggleGitHub:  () => setShowGitHub((v) => !v),
    onShowHelp:      () => setShowHelp((v) => !v),
    onToggleTheme:   toggleTheme,
  });

  useEffect(() => {
    fetch("/api/provider")
      .then((r) => r.json())
      .then((data: PublicProvider[]) => setProviders(data));
  }, []);

  // Bug fix #8: providers in deps array so model resolves correctly after fetch
  useEffect(() => {
    if (active) {
      setMessages(active.messages);
      setConvUsage(sumUsage(active.messages.map((message) => message.usage ?? null)));
      setRoutingBadges({});
      setSelectedProviderId(active.provider || "auto");
      const p = providers.find((p) => p.id === active.provider);
      setSelectedModel(active.model || p?.defaultModel || "");
      setProjectInput(active.project || "");
      setSystemPrompt(active.systemPrompt || "");
      if (active.githubContext) {
        setActiveRepo(active.githubContext.repo);
        setInjectedFiles(active.githubContext.files);
      } else {
        setActiveRepo("");
        setInjectedFiles([]);
      }
    } else {
      setMessages([]);
      setConvUsage(null);
      setRoutingBadges({});
      setProjectInput("");
      setSystemPrompt("");
      setInjectedFiles([]);
      setActiveRepo("");
    }
  }, [active, providers]);

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

  const handleFilesChange = useCallback((files: InjectedFile[], repo: string) => {
    setInjectedFiles(files);
    setActiveRepo(repo);
    if (activeId && repo) saveGitHubContext(repo, files);
  }, [activeId, saveGitHubContext]);

  async function sendChat(userText: string, baseMessages?: Message[]) {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    const now = Date.now();
    const newMessages: Message[] = [
      ...(baseMessages ?? messages),
      { role: "user", content: userText, createdAt: now },
    ];
    setMessages([...newMessages, { role: "assistant", content: "", createdAt: now }]);
    setLoading(true);
    const assistantIndex = newMessages.length;
    const messagesWithSystem: Message[] = systemPrompt.trim()
      ? [{ role: "system", content: systemPrompt.trim() }, ...newMessages]
      : newMessages;
    const contextFiles = Array.from(
      new Map([...injectedFiles, ...localFiles].map((file) => [file.path, file])).values()
    );
    let fullText = "";
    let capturedUsage: TokenUsage | null = null;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: messagesWithSystem,
          model: resolveModel(selectedModel, selectedProviderId as ProviderId),
          provider: selectedProviderId,
          injectedFiles: contextFiles,
        }),
      });

      if (!response.ok) {
        throw new Error(await responseError(response, "Chat request failed"));
      }

      if (isAuto) {
        const provider = response.headers.get("X-Routed-Provider") ?? "";
        const model = response.headers.get("X-Routed-Model") ?? "";
        const reason = response.headers.get("X-Route-Reason") ?? "";
        if (provider) {
          setRoutingBadges((badges) => ({
            ...badges,
            [assistantIndex]: { provider, model, reason },
          }));
        }
      }

      await readSse(response, ({ event, data }) => {
        if (data === "[DONE]") return;
        const payload = JSON.parse(data) as {
          error?: string;
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };

        if (event === "error") {
          throw new Error(payload.error || "The provider stream failed");
        }
        if (event === "usage") {
          const routedModel = response.headers.get("X-Routed-Model") || selectedModel;
          const routedProvider = response.headers.get("X-Routed-Provider") || selectedProviderId;
          capturedUsage = buildTokenUsage(payload, routedProvider, routedModel);
          return;
        }

        const delta = payload.choices?.[0]?.delta?.content ?? "";
        if (!delta) return;
        fullText += delta;
        setMessages((current) => [
          ...current.slice(0, -1),
          { role: "assistant", content: fullText, createdAt: now },
        ]);
      });

      if (!fullText.trim()) throw new Error("The provider returned an empty response");

      const finalAssistant: Message = {
        role: "assistant",
        content: fullText,
        createdAt: now,
        ...(capturedUsage ? { usage: capturedUsage } : {}),
      };
      setMessages((current) => [...current.slice(0, -1), finalAssistant]);
      if (capturedUsage) {
        setConvUsage((previous) => sumUsage([previous, capturedUsage]));
      }

      const githubContext: GitHubContext | undefined = activeRepo
        ? { repo: activeRepo, files: injectedFiles, pinnedAt: Date.now() }
        : undefined;
      saveConversation(
        [...newMessages, finalAssistant],
        selectedProviderId,
        selectedModel,
        active?.project ?? projectInput,
        githubContext
      );
    } catch (error) {
      const stopped = error instanceof Error && error.name === "AbortError";
      const content = stopped
        ? fullText
          ? `${fullText}\n\n_Stopped._`
          : "Generation stopped."
        : `❌ ${error instanceof Error ? error.message : "Chat request failed"}`;
      setMessages((current) => [
        ...current.slice(0, -1),
        { role: "assistant", content, createdAt: now },
      ]);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }

  /**
   * Regenerates the most recent assistant reply: drops it (and the user
   * message that prompted it) from state, then resends that same user text
   * against the truncated history. Passing `baseMessages` explicitly (rather
   * than letting sendChat read the `messages` closure) avoids a stale-state
   * race — setMessages() here wouldn't have committed yet by the time
   * sendChat's own closure captured `messages` on the same tick.
   */
  async function regenerateLastResponse() {
    if (loading || isAgentBusy) return;
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    const userText = messages[lastUserIdx].content ?? "";
    const truncated = messages.slice(0, lastUserIdx);
    setMessages(truncated);
    await sendChat(userText, truncated);
  }

  async function readAgentStream(response: Response): Promise<{
    agentText: string;
    plan?: AgentPlan;
    staged: StagedFile[];
    continuePayload?: ContinueEvent;
  }> {
    let agentText = "";
    let parsedPlan: AgentPlan | undefined;
    let staged: StagedFile[] = [];
    let receivedDone = false;
    let streamError = "";
    let continuePayload: ContinueEvent | undefined;

    await readSse(response, ({ data }) => {
      const event = JSON.parse(data) as AgentStreamEvent;
      if (event.type === "progress" || event.type === "tool_call") {
        setAgentStatus(event.text ?? "");
      } else if (event.type === "text") {
        agentText += event.text ?? "";
        setMessages((current) => [
          ...current.slice(0, -1),
          { role: "assistant", content: agentText, createdAt: Date.now() },
        ]);
      } else if (event.type === "plan") {
        parsedPlan = event.plan;
      } else if (event.type === "staged") {
        const incoming = event.files ?? [];
        staged = upsertStagedFiles(staged, incoming);
        setStagedFiles((current) => upsertStagedFiles(current, incoming));
      } else if (event.type === "error") {
        streamError = event.text || "Agent execution failed";
      } else if (event.type === "continue") {
        continuePayload = {
          messages: event.messages ?? [],
          stagedFiles: upsertStagedFiles(staged, event.stagedFiles ?? []),
          progress: event.progress,
        };
        setAgentStatus(event.progress ?? "Continuing…");
      } else if (event.type === "done") {
        receivedDone = true;
        setAgentStatus("");
      }
    });

    if (streamError) throw new Error(streamError);

    if (receivedDone && !agentText.trim()) {
      agentText = staged.length > 0
        ? "Execution complete. Review the staged changes below and push when ready."
        : parsedPlan
          ? "Plan ready for review."
          : "The agent completed without staging files.";
      setMessages((current) => {
        const last = current[current.length - 1];
        if (last?.role !== "assistant" || last.content.trim()) return current;
        return [...current.slice(0, -1), { ...last, content: agentText }];
      });
    }

    if (!receivedDone && !continuePayload) {
      throw new Error("The agent stream ended before completion");
    }

    return { agentText, plan: parsedPlan, staged, continuePayload };
  }

  async function callAgentApi(params: {
    phase: "plan" | "execute";
    task: string;
    plan?: AgentPlan;
    branch?: string;
    resumeMessages?: unknown[];
    resumeStagedFiles?: StagedFile[];
  }): Promise<Response> {
    return fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abortRef.current?.signal,
      body: JSON.stringify({
        task: params.task,
        repo: activeRepo,
        phase: params.phase,
        plan: params.plan,
        branch: params.branch || undefined,
        provider: selectedProviderId,
        model: isAuto
          ? undefined
          : resolveModel(selectedModel, selectedProviderId as ProviderId),
        resumeMessages: params.resumeMessages,
        resumeStagedFiles: params.resumeStagedFiles,
      }),
    });
  }

  async function startPlanning(userText: string) {
    if (!activeRepo) {
      setMessages((current) => [
        ...current,
        { role: "user", content: userText, createdAt: Date.now() },
        {
          role: "assistant",
          content: "Open the GitHub panel and select a repository before using Agent mode.",
          createdAt: Date.now(),
        },
      ]);
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    let workingBranch = "";

    setCurrentTask(userText);
    setCurrentPlan(null);
    setStagedFiles([]);
    setAgentIteration(0);
    setAgentPhase("planning");
    setLoading(true);
    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: userText, createdAt: Date.now() },
    ];
    setMessages([...newMessages, { role: "assistant", content: "", createdAt: Date.now() }]);

    try {
      if (branchFirst) {
        const slug = userText
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .slice(0, 40)
          .replace(/-$/, "") || "changes";
        workingBranch = `agent/${slug}-${Date.now().toString(36)}`;
        setAgentStatus(`Creating ${workingBranch}…`);
        const branchResponse = await fetch("/api/github", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            action: "create_branch",
            repo: activeRepo,
            branchName: workingBranch,
          }),
        });
        if (!branchResponse.ok) {
          throw new Error(await responseError(branchResponse, "Could not create the agent branch"));
        }
        setAgentBranch(workingBranch);
      } else {
        setAgentBranch("");
      }

      const response = await callAgentApi({
        phase: "plan",
        task: userText,
        branch: workingBranch,
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "Agent request failed"));
      }
      const result = await readAgentStream(response);
      if (!result.plan) throw new Error("The agent did not return a valid plan");

      setCurrentPlan(result.plan);
      setAgentPhase("awaiting_approval");
      saveConversation(
        [...newMessages, { role: "assistant", content: result.agentText, createdAt: Date.now() }],
        selectedProviderId,
        selectedModel,
        active?.project ?? projectInput,
        { repo: activeRepo, files: injectedFiles, pinnedAt: Date.now() }
      );
    } catch (error) {
      const stopped = error instanceof Error && error.name === "AbortError";
      setMessages((current) => [
        ...current.slice(0, -1),
        {
          role: "assistant",
          content: stopped
            ? "Agent stopped."
            : `❌ ${error instanceof Error ? error.message : "Planning failed"}`,
          createdAt: Date.now(),
        },
      ]);
      setAgentPhase("idle");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
      setAgentStatus("");
    }
  }

  async function executePlan(approvedPlan: AgentPlan) {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setAgentPhase("executing");
    setLoading(true);
    setStagedFiles([]);
    setCurrentPlan(null);
    setAgentIteration(0);

    const taskSnapshot = currentTask;
    const approvalMessage: Message = {
      role: "user",
      content: "Plan approved — execute it now.",
      createdAt: Date.now(),
    };
    const newMessages = [...messages, approvalMessage];
    setMessages([...newMessages, { role: "assistant", content: "", createdAt: Date.now() }]);

    let resumeMessages: unknown[] | undefined;
    let resumeStagedFiles: StagedFile[] | undefined;
    let finalText = "";
    let batchCount = 0;
    let needsContinuation = false;
    const maxBatches = 20;

    try {
      do {
        batchCount += 1;
        setAgentIteration(batchCount);
        const response = await callAgentApi({
          phase: "execute",
          task: taskSnapshot,
          plan: approvedPlan,
          branch: agentBranch,
          resumeMessages,
          resumeStagedFiles,
        });
        if (!response.ok) {
          throw new Error(await responseError(response, "Agent request failed"));
        }

        const result = await readAgentStream(response);
        if (result.agentText) finalText = result.agentText;
        if (result.staged.length > 0) {
          setStagedFiles((current) => upsertStagedFiles(current, result.staged));
        }

        needsContinuation = Boolean(result.continuePayload);
        if (result.continuePayload) {
          resumeMessages = result.continuePayload.messages;
          resumeStagedFiles = result.continuePayload.stagedFiles;
        }
      } while (needsContinuation && batchCount < maxBatches && !controller.signal.aborted);

      if (needsContinuation) {
        throw new Error(
          "The agent reached the maximum batch limit. Review the staged files; the approved plan may be incomplete."
        );
      }

      setAgentPhase("done");
      saveConversation(
        [...newMessages, { role: "assistant", content: finalText, createdAt: Date.now() }],
        selectedProviderId,
        selectedModel,
        active?.project ?? projectInput,
        { repo: activeRepo, files: injectedFiles, pinnedAt: Date.now() }
      );
    } catch (error) {
      const stopped = error instanceof Error && error.name === "AbortError";
      setMessages((current) => {
        const last = current[current.length - 1];
        const prefix = last?.role === "assistant" ? last.content : "";
        const detail = stopped
          ? "Agent stopped. Any files already staged are preserved for review."
          : `❌ ${error instanceof Error ? error.message : "Agent execution failed"}`;
        return [
          ...current.slice(0, -1),
          { role: "assistant", content: prefix ? `${prefix}\n\n${detail}` : detail, createdAt: Date.now() },
        ];
      });
      setAgentPhase("idle");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
      setAgentStatus("");
      setAgentIteration(0);
    }
  }

  async function sendMessage(text?: string) {
    const userText = (text ?? input).trim();
    // Bug fix #2: explicitly check isAgentBusy, don't just rely on loading flag
    if (!userText || loading || isAgentBusy || agentPhase === "awaiting_approval") return;
    setInput("");
    if (agentMode) await startPlanning(userText);
    else await sendChat(userText);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function stopCurrentRequest() {
    setAgentStatus("Stopping…");
    abortRef.current?.abort();
  }

  function handleNewChat() {
    abortRef.current?.abort();
    newConversation();
    setMessages([]); setRoutingBadges({}); setProjectInput(""); setSystemPrompt("");
    setInjectedFiles([]); setLocalFiles([]); setActiveRepo(""); setStagedFiles([]); setCurrentPlan(null);
    setAgentPhase("idle"); setConvUsage(null); setAgentBranch(""); setAgentIteration(0);
  }

  function saveSnippet(lang: string, code: string) {
    const label = prompt("Label for this snippet:", `${lang} snippet`) ?? "";
    if (!label.trim()) return;
    const updated = [...snippets, { id: crypto.randomUUID(), label: label.trim(), lang, code }];
    setSnippets(updated);
    lsSet("codeagent:snippets", JSON.stringify(updated));
  }

  const closeAll = useCallback(() => {
    setShowHistory(false); setShowGitHub(false); setShowModelPicker(false);
  }, []);

  useEffect(() => { closeAll(); }, [activeId, closeAll]);

  useEffect(() => {
    if (!showModelPicker) return;

    const closeModelPicker = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-model-picker-panel], [data-model-picker-trigger]")) return;
      setShowModelPicker(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowModelPicker(false);
    };

    document.addEventListener("pointerdown", closeModelPicker);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeModelPicker);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [showModelPicker]);

  // Bug fix #2: explicit isAgentBusy check
  const isAgentBusy   = agentPhase === "planning" || agentPhase === "executing";
  const inputDisabled = loading || isAgentBusy || (agentMode && !activeRepo) || agentPhase === "awaiting_approval";

  // Model label for pill
  const modelLabel = isAuto
    ? "Auto"
    : (activeProvider?.models.find((m) => m.id === selectedModel)?.label ?? selectedModel ?? "Model");
  const providerLabel = isAuto ? "Auto" : (activeProvider?.name ?? selectedProviderId);
  const contextWindow = activeProvider?.models.find((model) => model.id === selectedModel)?.contextWindow;

  // UI improvement #1: format agent progress label
  const agentProgressLabel = agentPhase === "planning"
    ? "Planning…"
    : agentPhase === "executing"
    ? `Executing${agentIteration > 1 ? ` (batch ${agentIteration})` : ""}…`
    : "";

  return (
    <ErrorBoundary>
    <div className="flex h-dvh bg-zinc-950 light:bg-[#f8f5f0] overflow-hidden">

      {/* ── Backdrop ─────────────────────────────────────────────────────── */}
      {/* md:hidden: on desktop the sidebars are permanently docked (md:visible)
          and the model picker is a small anchored dropdown, so a full-screen
          dimmed backdrop has nothing to justify and would otherwise cover the
          whole app and swallow every click until manually dismissed. */}
      {(showHistory || showGitHub || showModelPicker) && (
        <div className="mobile-overlay md:hidden" onClick={closeAll} />
      )}

      {/* ── History sidebar ───────────────────────────────────────────────── */}
      <div className={`sidebar-left ${showHistory ? "open" : ""} md:static md:transform-none md:visible md:w-60 md:flex md:flex-col md:border-r md:border-zinc-800 light:md:border-[#e5ded1] md:bg-transparent`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 light:border-[#e5ded1] flex-shrink-0">
          <span className="text-zinc-100 light:text-[#2b2620] text-sm font-semibold tracking-tight">History</span>
          <div className="flex items-center gap-1">
            <button
              onClick={handleNewChat}
              className="touch-target text-zinc-500 hover:text-zinc-200 light:text-[#8a7f6d] light:hover:text-[#2b2620] transition-colors"
              aria-label="New chat"
            >
              <IconPlus />
            </button>
            <button onClick={() => setShowHistory(false)} className="touch-target text-zinc-500 hover:text-zinc-200 light:text-[#8a7f6d] light:hover:text-[#2b2620] md:hidden">
              <IconX />
            </button>
          </div>
        </div>
        <ConversationList
          conversations={conversations}
          onSelectConversation={(conv) => { loadConversation(conv.id); setShowHistory(false); }}
          onDeleteConversation={deleteConversation}
          currentConversationId={activeId ?? undefined}
          syncing={syncing}
          onForceSync={forceSync}
        />
      </div>

      {/* ── Main area ─────────────────────────────────────────────────────── */}
      <div className="relative flex-1 flex flex-col min-w-0">

        {/* ── Top bar ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 light:border-[#e5ded1] bg-zinc-900/90 light:bg-white/90 backdrop-blur-sm flex-shrink-0">
          {/* Left: menu + title */}
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="touch-target text-zinc-500 hover:text-zinc-200 light:text-[#8a7f6d] light:hover:text-[#2b2620] md:hidden flex-shrink-0"
            aria-label="History"
          >
            <IconMenu />
          </button>
          <span
            className="text-zinc-300 light:text-[#4a4335] text-sm font-medium truncate flex-1 min-w-0"
            title={active?.title || "New chat"}
          >
            {active?.title || "New chat"}
          </span>
          {syncing && (
            <span className="text-violet-400 text-xs flex-shrink-0 animate-pulse">↕</span>
          )}

          {/* Right: theme + model pill + mode + github + new */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <ThemeToggleButton />

            <button
              type="button"
              data-model-picker-trigger
              onClick={() => setShowModelPicker((visible) => !visible)}
              className="model-pill"
              aria-label="Select model"
              aria-haspopup="dialog"
              aria-expanded={showModelPicker}
              title={`${providerLabel} · ${modelLabel}`}
            >
              {/* On mobile show only provider to save space */}
              <span className="max-w-[52px] truncate text-zinc-300 light:text-[#4a4335]">{providerLabel}</span>
              <span className="hidden sm:inline text-zinc-600 light:text-[#a89e8c] flex-shrink-0">·</span>
              <span className="hidden sm:inline max-w-[72px] truncate text-zinc-500 light:text-[#8a7f6d]">{modelLabel}</span>
              <IconChevron />
            </button>

            <button
              onClick={() => setAgentMode((v) => !v)}
              disabled={loading}
              className={`touch-target disabled:opacity-50 rounded-lg px-2.5 text-xs font-medium transition-colors ${
                agentMode
                  ? "bg-violet-700 text-violet-100 agent-active"
                  : "text-zinc-500 hover:text-zinc-200 bg-zinc-800 light:text-[#8a7f6d] light:bg-[#efe9dd] light:hover:text-[#2b2620]"
              }`}
              style={{ minWidth: 0 }}
            >
              {agentMode ? "Agent" : "Chat"}
            </button>

            {agentMode && (
              <button
                type="button"
                onClick={() => setBranchFirst((enabled) => !enabled)}
                className={`touch-target rounded-lg text-xs transition-colors ${
                  branchFirst
                    ? "bg-teal-900/40 text-teal-300 light:bg-teal-50 light:text-teal-700"
                    : "bg-zinc-800 text-zinc-500 hover:text-zinc-200 light:bg-[#efe9dd] light:text-[#8a7f6d]"
                }`}
                aria-pressed={branchFirst}
                aria-label="Create a branch before agent changes"
                title={branchFirst ? "Branch-first safety enabled" : "Enable branch-first safety"}
              >
                ⎇
              </button>
            )}

            <button
              onClick={() => setShowGitHub((v) => !v)}
              className={`touch-target rounded-lg transition-colors ${
                showGitHub || activeRepo ? "text-teal-400 bg-teal-900/30" : "text-zinc-500 hover:text-zinc-200 light:text-[#8a7f6d] light:hover:text-[#2b2620]"
              }`}
              aria-label="GitHub"
            >
              <IconGitHub />
            </button>

            <button
              onClick={handleNewChat}
              className="touch-target text-zinc-500 hover:text-zinc-200 light:text-[#8a7f6d] light:hover:text-[#2b2620] hidden md:flex"
              aria-label="New chat"
            >
              <IconPlus />
            </button>
          </div>
        </div>

        {/* ── Agent progress bar (UI improvement #1) ───────────────────── */}
        {isAgentBusy && (
          <div className="flex-shrink-0 border-b border-zinc-800 light:border-[#e5ded1] bg-zinc-900/80 light:bg-white/80">
            <div className="agent-progress-bar" />
            <div className="flex items-center gap-3 px-4 py-2">
              <div className="flex gap-1">
                <div className="thinking-dot" />
                <div className="thinking-dot" />
                <div className="thinking-dot" />
              </div>
              <span className="text-zinc-400 light:text-[#4a4335] text-xs font-medium">{agentProgressLabel}</span>
              {agentStatus && (
                <span className="text-zinc-500 light:text-[#8a7f6d] text-xs truncate max-w-[300px] flex-1">{agentStatus}</span>
              )}
              {agentIteration > 0 && (
                <span className="text-zinc-600 light:text-[#a89e8c] text-xs ml-auto">
                  {agentIteration}/{20} batches
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Model picker dropdown ─────────────────────────────────────── */}
        {showModelPicker && (
          <div
            data-model-picker-panel
            role="dialog"
            aria-label="Model and instructions"
            className="model-picker-panel flex flex-col overflow-hidden border border-zinc-700 bg-zinc-900 shadow-2xl light:border-[#e5ded1] light:bg-white"
          >
            <div className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-3 light:border-[#e5ded1] light:bg-white">
              <span className="text-zinc-100 light:text-[#2b2620] text-sm font-semibold">Model</span>
              <button onClick={() => setShowModelPicker(false)} className="touch-target text-zinc-500 hover:text-zinc-200 light:text-[#8a7f6d] light:hover:text-[#2b2620]">
                <IconX />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
              {/* Auto option */}
              <button
                onClick={() => { handleProviderChange("auto"); setShowModelPicker(false); }}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  selectedProviderId === "auto"
                    ? "bg-violet-800/40 text-violet-200 border border-violet-700/50"
                    : "text-zinc-300 hover:bg-zinc-800 light:text-[#4a4335] light:hover:bg-[#efe9dd]"
                }`}
              >
                <div className="font-medium">Auto routing</div>
                <div className="text-xs text-zinc-500 light:text-[#8a7f6d] mt-0.5">Smart model selection per task</div>
              </button>

              {providers.map((p) => (
                <div key={p.id}>
                  <div className="px-3 pt-3 pb-1 text-xs text-zinc-600 light:text-[#a89e8c] font-medium uppercase tracking-wider">
                    {p.name} {!p.configured && <span className="text-zinc-700 light:text-[#c7bda8]">(not configured)</span>}
                  </div>
                  {p.models.map((m) => {
                    const contextHint = formatContextWindow(m.contextWindow);
                    return (
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
                            : "text-zinc-300 hover:bg-zinc-800 light:text-[#4a4335] light:hover:bg-[#efe9dd]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate">{m.label}</span>
                          {contextHint && (
                            <span className="flex-shrink-0 text-[11px] text-zinc-600 light:text-[#a89e8c]">
                              {contextHint}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* System prompt section */}
            <div className="flex-shrink-0 border-t border-zinc-800 px-4 pb-4 pt-3 light:border-[#e5ded1]">
              <div className="flex items-center justify-between mb-2">
                <label className="text-zinc-500 light:text-[#8a7f6d] text-xs font-medium">System prompt</label>
                <select
                  value=""
                  onChange={(e) => {
                    const tpl = SYSTEM_PROMPT_TEMPLATES.find((t) => t.id === e.target.value);
                    if (tpl) {
                      setSystemPrompt(tpl.prompt);
                      if (activeId) saveSystemPrompt(tpl.prompt);
                    }
                  }}
                  className="bg-zinc-800 light:bg-[#efe9dd] border border-zinc-700 light:border-[#ddd3bd] rounded text-[11px] text-zinc-400 light:text-[#6b6255] px-1.5 py-1 focus:outline-none max-w-[140px]"
                  aria-label="Insert a system prompt template"
                >
                  <option value="">Templates…</option>
                  {SYSTEM_PROMPT_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
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
            <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-4 py-8">
              {/* Hero — smaller on mobile */}
              <div>
                <h1 className="text-4xl font-extrabold text-zinc-100 light:text-[#2b2620] tracking-tight">ORA</h1>
                <p className="text-zinc-500 light:text-[#8a7f6d] text-sm mt-1">
                  {agentMode ? "Agent mode — connect a repo to begin" : "Your AI coding agent"}
                </p>
              </div>

              {/* Model pill */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 light:bg-white border border-zinc-800 light:border-[#e5ded1] rounded-full text-xs text-zinc-500 light:text-[#8a7f6d]">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500 flex-shrink-0" />
                <span className="truncate max-w-[180px]">{providerLabel} · {modelLabel}</span>
              </div>

              {/* Prompt chips — 2-col even on mobile */}
              <div className="grid grid-cols-2 gap-2 w-full max-w-sm mt-1">
                {(agentMode ? AGENT_PROMPTS : QUICK_PROMPTS).map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(prompt)}
                    className="text-left text-xs text-zinc-400 light:text-[#6b6255] bg-zinc-900/80 light:bg-white border border-zinc-800 light:border-[#e5ded1] rounded-2xl p-3 hover:bg-zinc-800 hover:border-zinc-700 hover:text-zinc-200 light:hover:bg-[#efe9dd] light:hover:border-[#ddd3bd] light:hover:text-[#2b2620] active:scale-95 transition-all leading-relaxed"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              {agentMode && !activeRepo && (
                <button
                  onClick={() => setShowGitHub(true)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-teal-900/30 light:bg-teal-50 border border-teal-700/50 light:border-teal-300 rounded-xl text-teal-400 light:text-teal-700 text-sm hover:bg-teal-900/50 light:hover:bg-teal-100 active:scale-95 transition-all"
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
              routingBadge={routingBadges[i]}
              activeRepo={activeRepo}
              onSaveSnippet={saveSnippet}
              onOpenArtifact={openArtifact}
              onRegenerate={
                msg.role === "assistant" && i === messages.length - 1 && !loading && !isAgentBusy
                  ? regenerateLastResponse
                  : undefined
              }
            />
          ))}

          {/* Loading dots — only shown when NOT in agent mode (agent has the top bar) */}
          {loading && !isAgentBusy && (
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex gap-1">
                <div className="thinking-dot" />
                <div className="thinking-dot" />
                <div className="thinking-dot" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Staged changes ────────────────────────────────────────────── */}
        {stagedFiles.length > 0 && (
          <ErrorBoundary fallbackLabel="the staged changes panel">
            <StagedChanges
              files={stagedFiles}
              repo={activeRepo}
              defaultBranch={agentBranch}
              onOpenArtifact={openArtifact}
              onPush={(pushedFiles) => {
                // Bug fix #6: properly clear pushed files from staged state
                setStagedFiles((prev) => {
                  const pushedPaths = new Set(pushedFiles.map((f) => f.path));
                  return prev.filter((f) => !pushedPaths.has(f.path));
                });
              }}
              onDiscard={() => setStagedFiles([])}
            />
          </ErrorBoundary>
        )}

        {currentPlan && agentPhase === "awaiting_approval" && (
          <ErrorBoundary fallbackLabel="the plan approval panel">
            <PlanApproval
              plan={currentPlan}
              task={currentTask}
              onApprove={(plan) => executePlan(plan)}
              onReject={() => { setCurrentPlan(null); setAgentPhase("idle"); }}
              executing={false}
            />
          </ErrorBoundary>
        )}

        {/* ── Input bar ─────────────────────────────────────────────────── */}
        <div
          className="border-t border-zinc-800 light:border-[#e5ded1] bg-zinc-900/90 light:bg-white/90 backdrop-blur-sm flex-shrink-0"
          style={{ paddingBottom: kbHeight > 0 ? kbHeight : undefined }}
        >
          <div className="px-3 md:px-4 py-2.5 pb-safe">

            {/* Context chips */}
            {(injectedFiles.length > 0 || localFiles.length > 0 || agentMode || activeRepo || agentBranch) && (
              <div className="flex items-center gap-1.5 mb-2 overflow-x-auto pb-1 scrollbar-hide">
                {activeRepo && (
                  <span className="flex items-center gap-1 text-xs text-teal-400 bg-teal-900/30 light:bg-teal-50 light:text-teal-700 border border-teal-800/50 light:border-teal-300 rounded-full px-2.5 py-1 whitespace-nowrap flex-shrink-0">
                    <IconGitHub />
                    {activeRepo.split("/").pop()}
                  </span>
                )}
                {/* UI improvement #7: show agent branch chip when branchFirst is active */}
                {agentBranch && (
                  <span className="flex items-center gap-1 text-xs text-violet-400 bg-violet-900/30 light:bg-violet-50 light:text-violet-700 border border-violet-800/50 light:border-violet-300 rounded-full px-2.5 py-1 whitespace-nowrap flex-shrink-0">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                    </svg>
                    {agentBranch}
                  </span>
                )}
                {injectedFiles.length > 0 && (
                  <span className="text-xs text-zinc-400 light:text-[#6b6255] bg-zinc-800 light:bg-[#efe9dd] rounded-full px-2.5 py-1 whitespace-nowrap flex-shrink-0">
                    {injectedFiles.length} file{injectedFiles.length !== 1 ? "s" : ""}
                  </span>
                )}
                {localFiles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setLocalFiles([])}
                    title="Remove local file context"
                    className="text-xs text-blue-400 light:text-blue-700 bg-blue-900/30 light:bg-blue-50 rounded-full px-2.5 py-1 whitespace-nowrap flex-shrink-0"
                  >
                    {localFiles.length} local ×
                  </button>
                )}
                {agentMode && (
                  <span className="text-xs text-violet-400 light:text-violet-700 bg-violet-900/30 light:bg-violet-50 rounded-full px-2.5 py-1 whitespace-nowrap flex-shrink-0">
                    Agent
                  </span>
                )}
                {/* UI improvement #8: show per-message running cost */}
                {convUsage && (
                  <span className="text-xs text-zinc-600 light:text-[#a89e8c] ml-auto flex-shrink-0 whitespace-nowrap">
                    {formatCost(convUsage.estimatedCostUsd)}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-end gap-1.5">
              <LocalFileContext
                compact
                onFilesLoaded={(files) => setLocalFiles((prev) => [...prev, ...files])}
              />

              <div className="flex-1 relative min-w-0">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                  }}
                  onFocus={() => {
                    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 320);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    agentMode && !activeRepo
                      ? "Select a repo first →"
                      : agentMode
                      ? "Tell the agent what to do..."
                      : "Ask anything..."
                  }
                  rows={1}
                  disabled={inputDisabled}
                  className="input-field w-full px-3.5 py-3 text-[15px] text-left placeholder:text-zinc-600 resize-none min-h-[46px] max-h-[120px] disabled:opacity-40 block"
                  style={{ fontSize: "16px", textAlign: "left" }}
                />
              </div>

              {/* Send / stop button */}
              {loading || isAgentBusy ? (
                <button
                  onClick={stopCurrentRequest}
                  className="flex items-center justify-center rounded-xl w-[46px] h-[46px] flex-shrink-0 bg-zinc-700 hover:bg-red-800/70 text-zinc-400 hover:text-red-300 light:bg-[#efe9dd] light:text-[#8a7f6d] light:hover:bg-red-100 light:hover:text-red-600 transition-all"
                  aria-label="Stop current request"
                  title="Stop current request"
                >
                  <IconStop />
                </button>
              ) : (
                <button
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || loading}
                  className={`flex items-center justify-center rounded-xl w-[46px] h-[46px] flex-shrink-0 transition-all ${
                    !input.trim() || loading
                      ? "bg-zinc-800 light:bg-[#efe9dd] text-zinc-600 light:text-[#c7bda8] cursor-not-allowed"
                      : agentMode
                      ? "bg-violet-700 hover:bg-violet-600 text-white"
                      : "bg-teal-700 hover:bg-teal-600 text-white"
                  }`}
                  aria-label="Send"
                >
                  <IconSend />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Artifact panel (Claude-style split view for code files) ───────── */}
      {artifact && (
        <div className="artifact-panel">
          <ErrorBoundary fallbackLabel="the file viewer">
            <ArtifactPanel artifact={artifact} onClose={() => setArtifact(null)} />
          </ErrorBoundary>
        </div>
      )}

      {/* ── GitHub sidebar ────────────────────────────────────────────────── */}
      <div className={`sidebar-right ${showGitHub ? "open" : ""} md:static md:transform-none md:visible md:w-72 md:flex md:flex-col md:border-l md:border-zinc-800 light:md:border-[#e5ded1] md:bg-transparent`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 light:border-[#e5ded1] flex-shrink-0">
          <span className="text-zinc-100 light:text-[#2b2620] text-sm font-semibold">GitHub</span>
          <button onClick={() => setShowGitHub(false)} className="touch-target text-zinc-500 hover:text-zinc-200 light:text-[#8a7f6d] light:hover:text-[#2b2620]">
            <IconX />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ErrorBoundary fallbackLabel="the GitHub panel">
            <GitHubSidebar
              onFilesChange={handleFilesChange}
              savedContext={active?.githubContext}
              pinnedFiles={pinnedFiles}
              contextWindow={contextWindow}
              onTogglePinnedFile={(repo, filePath) => {
                setPinnedFiles((prev) => {
                  const current = prev[repo] || [];
                  const updated = current.includes(filePath)
                    ? current.filter((f) => f !== filePath)
                    : [...current, filePath];
                  const next = { ...prev, [repo]: updated };
                  lsSet("codeagent:pinnedFiles", JSON.stringify(next));
                  return next;
                });
              }}
            />
          </ErrorBoundary>
        </div>
      </div>

      <ShortcutHelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
    </ErrorBoundary>
  );
}
export default function Home() {
  return (
    <AuthGate>
      <Workspace />
    </AuthGate>
  );
}
