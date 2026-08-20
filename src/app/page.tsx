"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import GitHubSidebar from "@/components/GitHubSidebar";
import ChatMessage from "@/components/ChatMessage";
import ConversationList from "@/components/ConversationList";
import StagedChanges from "@/components/StagedChanges";
import PlanApproval from "@/components/PlanApproval";
import LocalFileContext from "@/components/LocalFileContext";
import ArtifactPanel, { type Artifact } from "@/components/ArtifactPanel";
import ErrorBoundary from "@/components/ErrorBoundary";
import AgentExecutionConsole, { type ExecutionLogEntry } from "@/components/AgentExecutionConsole";
import TerminalPanel from "@/components/TerminalPanel";
import ProjectMemoryPanel from "@/components/ProjectMemoryPanel";
import CollaborationPanel from "@/components/CollaborationPanel";
import AppearancePanel, { PRESETS, readAppearance, type AppearanceSettings, type SoundPack, type SoundMime } from "@/components/AppearancePanel";
import AuthGate from "@/components/AuthGate";
import { useConversations } from "@/hooks/useConversations";
import { useKeyboardShortcuts, ShortcutHelpModal } from "@/hooks/useKeyboardShortcuts";
import { buildTokenUsage, sumUsage, formatCost } from "@/lib/tokenCost";
import { resolveModel, type ProviderId } from "@/lib/providers";
import { SYSTEM_PROMPT_TEMPLATES, type PromptTemplate } from "@/lib/promptTemplates";
import { estimatePromptTokens } from "@/lib/promptTokens";
import type { Message, InjectedFile, PublicProvider, GitHubContext } from "@/types";
import type { StagedFile } from "@/lib/agentTools";
import type { AgentPlan } from "@/lib/agent/types";
import type { TokenUsage } from "@/lib/tokenCost";
import { createProjectMemory, loadProjectMemory, memoryPromptContext, type ProjectMemory } from "@/lib/projectMemory";
import { collaborationBrief, type SpecialistRole } from "@/lib/collaboration";
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
  type: "meta" | "progress" | "tool_call" | "tool_result" | "text" | "plan" | "staged" | "error" | "continue" | "done";
  text?: string;
  plan?: AgentPlan;
  files?: StagedFile[];
  messages?: unknown[];
  stagedFiles?: StagedFile[];
  progress?: string;
  detail?: string;
  name?: string;
  status?: string;
  runId?: string;
  taskKind?: string;
  risk?: string;
  iterations?: number;
  toolCalls?: number;
  stagedCount?: number;
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
  const [showTerminal, setShowTerminal]   = useState(false);
  const [showMemory, setShowMemory]       = useState(false);
  const [showCollaboration, setShowCollaboration] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => readAppearance());
  const [soundPacks, setSoundPacks] = useState<SoundPack[]>(() => {
    try { return JSON.parse(lsGet("ora:sound-packs", "[]")) as SoundPack[]; } catch { return []; }
  });
  const [selectedSoundPackId, setSelectedSoundPackId] = useState(() => lsGet("ora:selected-sound-pack", ""));
  const [profileGistId, setProfileGistId] = useState(() => lsGet("ora:profile-gist", ""));
  const [profileStatus, setProfileStatus] = useState("Local profile");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [projectInput, setProjectInput]   = useState("");
  const [projectMemory, setProjectMemory] = useState<ProjectMemory>(() => createProjectMemory(""));
  const [specialists, setSpecialists] = useState<SpecialistRole[]>([]);

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
  const [customPromptTemplates, setCustomPromptTemplates] = useState<PromptTemplate[]>(() => {
    try { return JSON.parse(lsGet("ora:custom-prompt-templates", "[]")) as PromptTemplate[]; } catch { return []; }
  });
  const [templateNameDraft, setTemplateNameDraft] = useState("");
  const [branchFirst, setBranchFirst]     = useState(false);
    const [agentBranch, setAgentBranch] = useState(""); // UI improvement #7
  const [executionLogs, setExecutionLogs] = useState<ExecutionLogEntry[]>([]);

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

  const promptTemplates = useMemo(() => [...SYSTEM_PROMPT_TEMPLATES, ...customPromptTemplates], [customPromptTemplates]);
  const activePromptTemplateIndex = promptTemplates.findIndex((template) => template.prompt === systemPrompt);
  const activePromptTemplate = activePromptTemplateIndex >= 0 ? promptTemplates[activePromptTemplateIndex] : null;
  const promptTokenCount = estimatePromptTokens(systemPrompt);

  const cycleSystemPromptTemplate = useCallback(() => {
    const nextIndex = activePromptTemplateIndex >= 0
      ? (activePromptTemplateIndex + 1) % promptTemplates.length
      : 0;
    const template = promptTemplates[nextIndex];
    setSystemPrompt(template.prompt);
    if (activeId) saveSystemPrompt(template.prompt);
  }, [activeId, activePromptTemplateIndex, promptTemplates, saveSystemPrompt]);

  const persistCustomPromptTemplates = useCallback((next: PromptTemplate[]) => {
    setCustomPromptTemplates(next);
    lsSet("ora:custom-prompt-templates", JSON.stringify(next));
  }, []);

  const saveCustomPromptTemplate = useCallback(() => {
    const prompt = systemPrompt.trim();
    if (!prompt) return;
    const label = templateNameDraft.trim() || `Custom ${customPromptTemplates.length + 1}`;
    const id = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "custom"}-${Date.now().toString(36)}`;
    persistCustomPromptTemplates([...customPromptTemplates, { id, label, prompt }]);
    setTemplateNameDraft("");
  }, [customPromptTemplates, persistCustomPromptTemplates, systemPrompt, templateNameDraft]);

  const deleteCustomPromptTemplate = useCallback((id: string) => {
    persistCustomPromptTemplates(customPromptTemplates.filter((template) => template.id !== id));
  }, [customPromptTemplates, persistCustomPromptTemplates]);

  const persistSoundPacks = useCallback((next: SoundPack[]) => {
    setSoundPacks(next);
    lsSet("ora:sound-packs", JSON.stringify(next));
  }, []);

  const handleUploadSoundPack = useCallback(async (file: File) => {
    const allowed = new Set(["audio/wav", "audio/mpeg", "audio/ogg", "audio/webm"]);
    if (!allowed.has(file.type)) { setProfileStatus("Unsupported audio format"); return; }
    if (file.size > 256 * 1024) { setProfileStatus("Sound pack must be 256KB or smaller"); return; }
    if (soundPacks.length >= 3) { setProfileStatus("Maximum of 3 sound packs"); return; }
    const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
    const id = `${file.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "sound"}-${Date.now().toString(36)}`;
    const next = [...soundPacks, { id, name: file.name.replace(/\.[^.]+$/, "").slice(0, 80), mime: file.type as SoundMime, dataUrl }];
    persistSoundPacks(next); setSelectedSoundPackId(id); lsSet("ora:selected-sound-pack", id); setProfileStatus("Sound pack ready to sync");
  }, [persistSoundPacks, soundPacks]);

  const pullPersonalProfile = useCallback(async () => {
    setProfileStatus("Pulling private profile…");
    try {
      const query = profileGistId ? `?gistId=${encodeURIComponent(profileGistId)}` : "";
      const response = await fetch(`/api/profile${query}`);
      const data = await response.json() as { error?: string; gistId?: string | null; profile?: { appearance: AppearanceSettings; soundPacks: SoundPack[]; customPromptTemplates?: PromptTemplate[] } | null };
      if (!response.ok || data.error) throw new Error(data.error || "Profile pull failed");
      if (data.gistId) { setProfileGistId(data.gistId); lsSet("ora:profile-gist", data.gistId); }
      if (data.profile) { setAppearance(data.profile.appearance); persistSoundPacks(data.profile.soundPacks); persistCustomPromptTemplates(data.profile.customPromptTemplates ?? []); const selected = data.profile.soundPacks[0]?.id ?? ""; setSelectedSoundPackId(selected); lsSet("ora:selected-sound-pack", selected); }
      setProfileStatus(data.profile ? "Synced from private Gist" : "No remote profile yet");
    } catch (error) { setProfileStatus(error instanceof Error ? error.message : "Profile pull failed"); }
  }, [persistCustomPromptTemplates, persistSoundPacks, profileGistId]);

  const pushPersonalProfile = useCallback(async () => {
    setProfileStatus("Pushing private profile…");
    try {
      const response = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gistId: profileGistId || undefined, appearance, soundPacks, customPromptTemplates }) });
      const data = await response.json() as { error?: string; gistId?: string | null };
      if (!response.ok || data.error) throw new Error(data.error || "Profile push failed");
      if (data.gistId) { setProfileGistId(data.gistId); lsSet("ora:profile-gist", data.gistId); }
      setProfileStatus("Synced to private Gist");
    } catch (error) { setProfileStatus(error instanceof Error ? error.message : "Profile push failed"); }
  }, [appearance, customPromptTemplates, profileGistId, soundPacks]);

  useEffect(() => { lsSet("ora:selected-sound-pack", selectedSoundPackId); }, [selectedSoundPackId]);

  useKeyboardShortcuts({
    onSend:          () => !loading && sendMessage(),
    onNewChat:       handleNewChat,
    onToggleAgent:   () => !loading && setAgentMode((v) => !v),
    onToggleHistory: () => setShowHistory((v) => !v),
    onToggleGitHub:  () => setShowGitHub((v) => !v),
    onShowHelp:      () => setShowHelp((v) => !v),
    onToggleTheme:   () => {},
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

  function pushExecutionLog(kind: ExecutionLogEntry["kind"], text: string, detail?: string) {
    if (!text.trim()) return;
    setExecutionLogs((current) => [
      ...current.slice(-119),
      { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, kind, text: text.trim(), detail, timestamp: Date.now() },
    ]);
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
      if (event.type === "meta") {
        pushExecutionLog("system", `Run ${event.runId ?? "initialized"}`, `${event.taskKind ?? "coding"} · ${event.risk ?? "normal"} risk`);
      } else if (event.type === "progress") {
        setAgentStatus(event.text ?? "");
        pushExecutionLog("progress", event.text ?? "Agent is working");
      } else if (event.type === "tool_call") {
        setAgentStatus(event.text ?? "");
        pushExecutionLog("tool", event.text ?? "Calling repository tool");
      } else if (event.type === "tool_result") {
        pushExecutionLog("result", event.text ?? "Tool completed", event.detail);
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
        pushExecutionLog("error", streamError);
      } else if (event.type === "continue") {
        continuePayload = {
          messages: event.messages ?? [],
          stagedFiles: upsertStagedFiles(staged, event.stagedFiles ?? []),
          progress: event.progress,
        };
        setAgentStatus(event.progress ?? "Continuing…");
        pushExecutionLog("progress", event.progress ?? "Resuming execution");
      } else if (event.type === "done") {
        receivedDone = true;
        setAgentStatus("");
        pushExecutionLog("complete", `Run complete · ${event.stagedCount ?? 0} staged file(s)`, `${event.toolCalls ?? 0} tool calls · ${event.iterations ?? 0} iterations`);
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
        task: `${params.task}${memoryPromptContext(projectMemory)}${collaborationBrief(specialists)}`,
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
    setExecutionLogs([]);
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
    setInjectedFiles([]); setLocalFiles([]); setActiveRepo(""); setStagedFiles([]); setCurrentPlan(null); setExecutionLogs([]);
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
    setShowHistory(false); setShowGitHub(false); setShowModelPicker(false); setShowTerminal(false); setShowMemory(false); setShowCollaboration(false); setShowAppearance(false);
  }, []);

  useEffect(() => { closeAll(); }, [activeId, closeAll]);
  useEffect(() => {
    setProjectMemory(activeRepo ? loadProjectMemory(activeRepo) : createProjectMemory(""));
  }, [activeRepo]);
  useEffect(() => {
    const preset = PRESETS.find((item) => item.id === appearance.preset) ?? PRESETS[0];
    document.documentElement.style.setProperty("--ora-cyan", preset.cyan);
    document.documentElement.style.setProperty("--ora-violet", preset.violet);
    document.documentElement.style.setProperty("--ora-line", preset.line);
    document.documentElement.dataset.oraAccent = appearance.accent;
    document.documentElement.dataset.oraDensity = appearance.density;
    try { localStorage.setItem("ora:appearance", JSON.stringify(appearance)); } catch { /* optional persistence */ }
  }, [appearance]);

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
    <div className="ora-shell flex h-dvh bg-zinc-950 light:bg-[#f8f5f0] overflow-hidden">

      {/* ── Backdrop ─────────────────────────────────────────────────────── */}
      {/* md:hidden: on desktop the sidebars are permanently docked (md:visible)
          and the model picker is a small anchored dropdown, so a full-screen
          dimmed backdrop has nothing to justify and would otherwise cover the
          whole app and swallow every click until manually dismissed. */}
      {(showHistory || showGitHub || showModelPicker || showTerminal || showMemory || showCollaboration || showAppearance) && (
        <div className="mobile-overlay md:hidden" onClick={closeAll} />
      )}

      {/* ── History sidebar ───────────────────────────────────────────────── */}
      <div className={`sidebar-left ora-rail ora-history-rail ${showHistory ? "open" : ""} md:static md:transform-none md:visible md:w-64 md:flex md:flex-col md:border-r md:border-zinc-800 light:md:border-[#e5ded1] md:bg-transparent`}>
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
      <div className="ora-workspace ora-canvas flex-1 flex flex-col min-w-0">

        {/* ── Top bar ───────────────────────────────────────────────────── */}
        <div className="ora-topbar flex items-center gap-2 px-3 md:px-5 py-2.5 border-b border-zinc-800 light:border-[#e5ded1] bg-zinc-900/90 light:bg-white/90 backdrop-blur-sm flex-shrink-0">
          {/* Left: menu + title */}
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="workspace-nav-toggle touch-target text-zinc-500 hover:text-zinc-200 light:text-[#8a7f6d] light:hover:text-[#2b2620] flex-shrink-0"
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

          {/* Right: cyberpunk status + model pill + mode + github + new */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="workspace-theme-lock" title="ORA uses cyberpunk dark mode" aria-label="ORA uses cyberpunk dark mode">◐</span>
            <button
              type="button"
              onClick={cycleSystemPromptTemplate}
              className="prompt-quick-toggle touch-target"
              aria-label={`Switch system prompt template${activePromptTemplate ? `, current: ${activePromptTemplate.label}` : ""}`}
              title={activePromptTemplate ? `System prompt: ${activePromptTemplate.label}. Click to switch.` : "Cycle system prompt templates"}
            >
              <span aria-hidden="true">⌁</span>
              <span className="hidden lg:inline">Prompt</span>
            </button>
            <button
              type="button"
              onClick={() => setShowAppearance((v) => !v)}
              className={`workspace-tool-toggle touch-target ${showAppearance ? "is-active" : ""}`}
              aria-label="Appearance settings"
              title="Appearance settings"
            >
              <span className="workspace-tool-toggle__glyph">✦</span>
            </button>

            <button
              onClick={() => setShowModelPicker((v) => !v)}
              className="model-pill ora-model-trigger"
              aria-label="Select model"
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
              aria-pressed={agentMode}
              aria-label={`Switch to ${agentMode ? "Chat" : "Agent"} mode`}
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

            {agentMode && <button
              onClick={() => setShowCollaboration((v) => !v)}
              className={`workspace-tool-toggle touch-target ${showCollaboration ? "is-active" : ""}`}
              aria-label="Specialist collaboration"
              title="Specialist collaboration"
            >
              <span className="workspace-tool-toggle__glyph">◎</span>
            </button>}
            {activeRepo && <button
              onClick={() => setShowMemory((v) => !v)}
              className={`workspace-tool-toggle touch-target ${showMemory ? "is-active" : ""}`}
              aria-label="Project memory"
              title="Project memory"
            >
              <span className="workspace-tool-toggle__glyph">⌬</span>
            </button>}
            <button
              onClick={() => setShowTerminal((v) => !v)}
              className={`workspace-tool-toggle touch-target ${showTerminal ? "is-active" : ""}`}
              aria-label="Terminal"
              title="Terminal workspace"
            >
              <span className="workspace-tool-toggle__glyph">⌘</span>
            </button>
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

        {(executionLogs.length > 0 || isAgentBusy) && (
          <AgentExecutionConsole
            logs={executionLogs}
            active={isAgentBusy}
            phase={agentPhase}
            onClear={() => setExecutionLogs([])}
          />
        )}

        {/* ── Model picker dropdown ─────────────────────────────────────── */}
        {showModelPicker && (
          <div className="model-command-panel bottom-sheet md:absolute md:top-16 md:left-auto md:right-4 md:bottom-auto md:max-h-[min(680px,calc(100dvh-96px))] md:w-[min(390px,calc(100vw-32px))] md:border md:border-zinc-700 light:md:border-[#e5ded1] md:rounded-2xl md:shadow-2xl" role="dialog" aria-label="Model selection" aria-modal="true">
            <div className="model-command-header flex items-center justify-between px-5 py-4 border-b border-zinc-800 light:border-[#e5ded1] sticky top-0 bg-zinc-900 light:bg-white z-10">
              <span className="text-zinc-100 light:text-[#2b2620] text-sm font-semibold">Model</span>
              <button type="button" onClick={() => setShowModelPicker(false)} className="touch-target text-zinc-500 hover:text-zinc-200 light:text-[#8a7f6d] light:hover:text-[#2b2620]" aria-label="Close model selection">
                <IconX />
              </button>
            </div>
            <div className="model-command-list p-3 space-y-1 overflow-y-auto">
              {/* Auto option */}
              <button
                onClick={() => { handleProviderChange("auto"); setShowModelPicker(false); }}
                aria-pressed={selectedProviderId === "auto"}
                aria-label="Use automatic model routing"
                className={`model-option w-full text-left px-3 py-3 rounded-xl text-sm transition-colors ${
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
                  <div className="model-group-label px-3 pt-4 pb-2 text-xs text-zinc-600 light:text-[#a89e8c] font-medium uppercase tracking-wider">
                    {p.name} {!p.configured && <span className="text-zinc-700 light:text-[#c7bda8]">(not configured)</span>}
                  </div>
                  {p.models.map((m) => {
                    // UI improvement #4: show context window from label
                    const ctxMatch = m.label.match(/\(([^)]+ctx[^)]*)\)/i);
                    const ctxHint  = ctxMatch ? ctxMatch[1] : null;
                    const baseLabel = ctxMatch ? m.label.replace(/\s*\([^)]+ctx[^)]*\)/i, "").trim() : m.label;
                    return (
                      <button
                        key={m.id}
                        disabled={!p.configured}
                        aria-pressed={selectedProviderId === p.id && selectedModel === m.id}
                        aria-label={`${p.name}: ${baseLabel}${!p.configured ? " (not configured)" : ""}`}
                        onClick={() => {
                          setSelectedProviderId(p.id);
                          setSelectedModel(m.id);
                          setShowModelPicker(false);
                        }}
                        className={`model-option w-full text-left px-3 py-3 rounded-xl text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                          selectedProviderId === p.id && selectedModel === m.id
                            ? "bg-violet-800/40 text-violet-200 border border-violet-700/50"
                            : "text-zinc-300 hover:bg-zinc-800 light:text-[#4a4335] light:hover:bg-[#efe9dd]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span>{baseLabel}</span>
                          {ctxHint && (
                            <span className="text-zinc-600 light:text-[#a89e8c] text-xs flex-shrink-0">{ctxHint}</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* System prompt is intentionally a separate configuration section. */}
            <section className="system-prompt-section" aria-labelledby="system-prompt-title">
              <div className="system-prompt-section__header">
                <div>
                  <div id="system-prompt-title" className="system-prompt-section__title">SYSTEM PROMPT</div>
                  <p className="system-prompt-section__hint">Applied before every chat or agent run.</p>
                </div>
                <div className={`system-prompt-token-count ${promptTokenCount > 1200 ? "is-warning" : ""}`} aria-live="polite">{promptTokenCount.toLocaleString()} tokens</div>
                <select
                  value=""
                  onChange={(e) => {
                    const tpl = promptTemplates.find((t) => t.id === e.target.value);
                    if (tpl) {
                      setSystemPrompt(tpl.prompt);
                      if (activeId) saveSystemPrompt(tpl.prompt);
                    }
                  }}
                  className="system-prompt-template"
                  aria-label="Insert a system prompt template"
                >
                  <option value="">Insert template…</option>
                  <optgroup label="Built-in specialists">
                    {SYSTEM_PROMPT_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </optgroup>
                  {customPromptTemplates.length > 0 && (
                    <optgroup label="Saved to this device/profile">
                      {customPromptTemplates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </optgroup>
                  )}
                </select>
              </div>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                onBlur={() => { if (activeId) saveSystemPrompt(systemPrompt); }}
                rows={4}
                placeholder="Define ORA’s role, coding standards, constraints, and preferred response style…"
                className="system-prompt-editor input-field w-full px-3 py-2 text-sm placeholder:text-zinc-600 resize-none"
                aria-describedby="system-prompt-help"
              />
              <div className="system-prompt-save-row">
                <input
                  value={templateNameDraft}
                  onChange={(e) => setTemplateNameDraft(e.target.value)}
                  className="system-prompt-name-input"
                  placeholder="Name this prompt…"
                  aria-label="Name custom system prompt template"
                  maxLength={80}
                />
                <button type="button" className="system-prompt-save-button" onClick={saveCustomPromptTemplate} disabled={!systemPrompt.trim()}>Save template</button>
              </div>
              {customPromptTemplates.length > 0 && (
                <div className="system-prompt-custom-list" aria-label="Saved custom templates">
                  {customPromptTemplates.map((template) => (
                    <div key={template.id} className="system-prompt-custom-item">
                      <span title={template.prompt}>{template.label}</span>
                      <button type="button" onClick={() => deleteCustomPromptTemplate(template.id)} aria-label={`Delete saved template ${template.label}`}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <p id="system-prompt-help" className="system-prompt-section__footer">Approximate count · 4 characters ≈ 1 token · Saved locally and included in profile sync</p>
            </section>
          </div>
        )}

        {/* ── Messages ─────────────────────────────────────────────────── */}
        <div className="ora-chat-scroll flex-1 overflow-y-auto px-3 md:px-6 py-5 space-y-5 mobile-scroll">
          {messages.length === 0 && !loading && (
            <div className="ora-empty-state flex flex-col items-center justify-center h-full text-center px-4 gap-5 py-8">
              {/* Hero — smaller on mobile */}
              <div>
                <div className="ora-orb" aria-hidden="true"><span /></div>
                <div>
                  <div className="ora-kicker">PERSONAL CODING SYSTEM · ONLINE</div>
                  <h1 className="ora-title text-4xl font-extrabold text-zinc-100 light:text-[#2b2620] tracking-tight">ORA</h1>
                <p className="text-zinc-500 light:text-[#8a7f6d] text-sm mt-1">
                  {agentMode ? "Agent mode — connect a repo to begin" : "Your AI coding agent"}
                </p>
                </div>
              </div>

              {/* Model pill */}
              <div className="ora-status-pill flex items-center gap-2 px-3 py-1.5 bg-zinc-900 light:bg-white border border-zinc-800 light:border-[#e5ded1] rounded-full text-xs text-zinc-500 light:text-[#8a7f6d]">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500 flex-shrink-0" />
                <span className="truncate max-w-[180px]">{providerLabel} · {modelLabel}</span>
              </div>

              {/* Prompt chips — 2-col even on mobile */}
              <div className="grid grid-cols-2 gap-2 w-full max-w-sm mt-1">
                {(agentMode ? AGENT_PROMPTS : QUICK_PROMPTS).map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(prompt)}
                    className="ora-prompt-chip text-left text-xs text-zinc-400 light:text-[#6b6255] bg-zinc-900/80 light:bg-white border border-zinc-800 light:border-[#e5ded1] rounded-2xl p-3 hover:bg-zinc-800 hover:border-zinc-700 hover:text-zinc-200 light:hover:bg-[#efe9dd] light:hover:border-[#ddd3bd] light:hover:text-[#2b2620] active:scale-95 transition-all leading-relaxed"
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

        {showAppearance && (
          <div className="appearance-dock">
            <AppearancePanel
              settings={appearance}
              onChange={setAppearance}
              onClose={() => setShowAppearance(false)}
              soundPacks={soundPacks}
              selectedSoundPackId={selectedSoundPackId}
              onSelectSoundPack={(id) => setSelectedSoundPackId(id)}
              onUploadSoundPack={handleUploadSoundPack}
              onDeleteSoundPack={(id) => { const next = soundPacks.filter((pack) => pack.id !== id); persistSoundPacks(next); if (selectedSoundPackId === id) setSelectedSoundPackId(""); }}
              profileStatus={profileStatus}
              onPullProfile={pullPersonalProfile}
              onPushProfile={pushPersonalProfile}
            />
          </div>
        )}
        {showMemory && activeRepo && (
          <div className="memory-dock">
            <ProjectMemoryPanel memory={projectMemory} onChange={setProjectMemory} onClose={() => setShowMemory(false)} />
          </div>
        )}
        {showCollaboration && agentMode && (
          <div className="collaboration-dock">
            <CollaborationPanel selected={specialists} onChange={setSpecialists} onClose={() => setShowCollaboration(false)} />
          </div>
        )}
        {showTerminal && activeRepo && (
          <div className="terminal-dock">
            <TerminalPanel
              repo={activeRepo}
              branch={agentBranch || undefined}
              onClose={() => setShowTerminal(false)}
              onRepair={(failure) => {
                setAgentMode(true);
                setInput(`Repair the active repository after verification failure. ${failure} Use the terminal output as evidence, inspect the affected code, make the smallest safe multi-file change, and verify the fix.`);
                setShowTerminal(false);
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
            />
          </div>
        )}

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
          className="coding-composer ora-composer border-t border-zinc-800 light:border-[#e5ded1] bg-zinc-900/90 light:bg-white/90 backdrop-blur-sm flex-shrink-0"
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

            <div className="coding-composer__row flex items-end gap-1.5">
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
                  className="coding-composer__input input-field w-full px-3.5 py-3 text-[15px] text-left placeholder:text-zinc-600 resize-none min-h-[46px] max-h-[120px] disabled:opacity-40 block"
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
      <div className={`sidebar-right ora-rail ora-github-rail ${showGitHub ? "open" : ""} md:static md:transform-none md:visible md:flex md:flex-col md:border-l md:border-zinc-800 light:md:border-[#e5ded1] md:bg-transparent`}>
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
