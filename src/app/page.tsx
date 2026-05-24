'use client';

import { useState, useEffect, useRef } from 'react';
import GitHubSidebar from '@/components/GitHubSidebar';
import ConversationList from '@/components/ConversationList';
import ChatInterface from '@/components/ChatInterface';
import { Message } from '@/types';

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
  const [showHistory, setShowHistory]     = useState(true);
  const [showGitHub, setShowGitHub]       = useState(false);
  const [projectInput, setProjectInput]   = useState("");
  const [editingProject, setEditingProject] = useState(false);

  // Agent state
  const [agentMode, setAgentMode]         = useState(false);
  const [agentPhase, setAgentPhase]       = useState<AgentPhase>("idle");
  const [agentStatus, setAgentStatus]     = useState("");
  const [currentPlan, setCurrentPlan]     = useState<AgentPlan | null>(null);
  const [currentTask, setCurrentTask]     = useState("");
  const [stagedFiles, setStagedFiles]     = useState<StagedFile[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    conversations, active, activeId,
    newConversation, saveConversation, saveGitHubContext,
    loadConversation, deleteConversation, setProject,
  } = useConversations();

  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkIsMobile();
    window.addEventListener('resize', checkIsMobile);
    
    return () => {
      window.removeEventListener('resize', checkIsMobile);
    };
  }, []);

  // Close mobile menu when resizing to desktop
  useEffect(() => {
    if (!isMobile) {
      setMobileMenuOpen(false);
    }
  }, [isMobile]);

  const handleNewConversation = () => {
    const newConversation = {
      id: Date.now().toString(),
      title: 'New Conversation',
      messages: [],
      createdAt: new Date(),
    };
    
    setConversations([newConversation, ...conversations]);
    setCurrentConversation(newConversation);
  };

  const handleSelectConversation = (conversation: any) => {
    setCurrentConversation(conversation);
    if (isMobile) {
      setMobileMenuOpen(false);
    }
  };

  const handleSendMessage = async (message: string) => {
    if (!currentConversation || isLoading) return;

    setIsLoading(true);
    
    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    };

    const updatedMessages = [...currentConversation.messages, userMessage];
    const updatedConversation = {
      ...currentConversation,
      messages: updatedMessages,
    };

    // Update conversation list
    const updatedConversations = conversations.map(conv => 
      conv.id === currentConversation.id ? updatedConversation : conv
    );
    
    setConversations(updatedConversations);
    setCurrentConversation(updatedConversation);

    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Add AI response
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `This is a simulated response to: "${message}". In a real application, this would connect to an AI service.`,
        timestamp: new Date(),
      };

      const finalMessages = [...updatedMessages, aiMessage];
      const finalConversation = {
        ...updatedConversation,
        messages: finalMessages,
      };

      // Update conversation list
      const finalConversations = updatedConversations.map(conv => 
        conv.id === currentConversation.id ? finalConversation : conv
      );
      
      setConversations(finalConversations);
      setCurrentConversation(finalConversation);
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen bg-zinc-950 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-zinc-800 px-4 py-2.5 flex items-center gap-3 flex-shrink-0 bg-zinc-950">
        <button onClick={() => setShowHistory((s) => !s)} className="text-zinc-500 hover:text-zinc-200 text-xs">🕐</button>
        <span className="text-teal-400 font-mono font-bold tracking-tight">
          code<span className="text-zinc-400">agent</span>
        </span>

        {/* Project tag */}
        <div className="flex items-center gap-1">
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
        </div>

        {/* Mode toggle */}
        <div className="flex items-center bg-zinc-800 border border-zinc-700 rounded-lg p-0.5 gap-0.5">
          <button
            onClick={() => { setAgentMode(false); setCurrentPlan(null); setAgentPhase("idle"); }}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${!agentMode ? "bg-zinc-600 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            Chat
          </button>
          <h1 className="text-xl font-bold">AI Coding Agent</h1>
          <button 
            onClick={handleNewConversation}
            className="p-2 rounded-md hover:bg-gray-700 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </button>
        </div>

        {/* Provider + model */}
        <div className="flex items-center gap-2">
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
                {activeProvider.models.map((m) => (
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
          <button
            onClick={() => setShowGitHub((s) => !s)}
            className={`text-xs transition-colors ${showGitHub ? "text-teal-400" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            GitHub
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* History sidebar */}
        {showHistory && (
          <div className="w-60 border-r border-zinc-800 flex flex-col bg-zinc-950 flex-shrink-0">
            <div className="px-3 py-2 border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
              History
            </div>
            <div className="flex-1 overflow-y-auto">
              <ConversationList 
                conversations={conversations} 
                onSelectConversation={handleSelectConversation}
                currentConversationId={currentConversation?.id}
              />
            </div>
            <div className="p-4 border-t border-gray-700">
              <GitHubSidebar />
            </div>
          </div>
        )}

        {showHistory && (
          <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setShowHistory(false)} />
        )}

        {showGitHub && (
          <GitHubSidebar
            onFilesChange={handleFilesChange}
            savedContext={active?.githubContext}
          />
        )}

        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Agent status bar */}
          {agentStatus && (
            <div className="px-4 py-2 bg-amber-950 border-b border-amber-900 flex items-center gap-2 flex-shrink-0">
              <span className="animate-spin text-amber-400 text-xs inline-block">⟳</span>
              <span className="text-amber-300 text-xs font-mono">{agentStatus}</span>
            </div>
          )}

          {/* Executing indicator when status bar is empty but still executing */}
          {agentPhase === "executing" && !agentStatus && (
            <div className="px-4 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center gap-2 flex-shrink-0">
              <span className="animate-spin text-zinc-500 text-xs inline-block">⟳</span>
              <span className="text-zinc-500 text-xs">Writing files…</span>
            </div>
          )}

          {/* Messages */}
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
                        ? `Agent reads your codebase → shows plan → you approve → writes code → you review diffs → push to GitHub.`
                        : "Open the GitHub sidebar and select a repo first."
                      : "Chats auto-save. Switch to Agent mode to autonomously edit your repo."}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
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
              <div className="p-4 border-t border-gray-700">
                <GitHubSidebar />
              </div>
            </div>
          </div>

          {/* Plan approval */}
          {agentPhase === "awaiting_approval" && currentPlan && (
            <PlanApproval
              plan={currentPlan}
              task={currentTask}
              onApprove={executePlan}
              onReject={rejectPlan}
              executing={false}
            />
          )}

          {/* Staged changes */}
          {showStagedChanges && (
            <StagedChanges
              files={stagedFiles}
              repo={activeRepo}
              onPush={() => { setStagedFiles([]); setAgentPhase("idle"); }}
              onDiscard={() => { setStagedFiles([]); setAgentPhase("idle"); }}
            />
          )}

          {/* Input */}
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
    </div>
  );
}