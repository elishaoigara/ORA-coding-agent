'use client';

import { useState } from 'react';
import type { Conversation } from '@/types';

interface Props {
  conversations: Conversation[];
  onSelectConversation: (conversation: Conversation) => void;
  onDeleteConversation?: (id: string) => void;
  onExportConversation?: (conv: Conversation) => void;
  currentConversationId?: string;
  syncing?: boolean;
  onForceSync?: () => void;
}

function relativeDate(ts: number): string {
  const now  = Date.now();
  const diff = now - ts;
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1) return "Just now";
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString([], { day: "numeric", month: "short" });
}

function groupByDate(convs: Conversation[]): { label: string; items: Conversation[] }[] {
  const now   = Date.now();
  const today = new Date(now).toDateString();
  const yest  = new Date(now - 86_400_000).toDateString();
  const week  = now - 7 * 86_400_000;

  const groups: Record<string, Conversation[]> = {
    Today: [], Yesterday: [], "This week": [], Older: [],
  };

  for (const c of convs) {
    const d = new Date(c.updatedAt).toDateString();
    if (d === today) groups["Today"].push(c);
    else if (d === yest) groups["Yesterday"].push(c);
    else if (c.updatedAt >= week) groups["This week"].push(c);
    else groups["Older"].push(c);
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

// Icon components
const IconTrash = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);
const IconExport = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
  </svg>
);
const IconSync = ({ spinning }: { spinning?: boolean }) => (
  <svg className={`w-3.5 h-3.5 ${spinning ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

export default function ConversationList({
  conversations,
  onSelectConversation,
  onDeleteConversation,
  onExportConversation,
  currentConversationId,
  syncing,
  onForceSync,
}: Props) {
  const [search,    setSearch]    = useState("");
  const [activeId,  setActiveId]  = useState<string | null>(null); // long-press / swipe reveal

  const q = search.trim().toLowerCase();
  const filtered = q
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(q) ||
        c.project?.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
      )
    : conversations;

  const groups = q ? [{ label: "Results", items: filtered }] : groupByDate(filtered);

  return (
    <div className="flex flex-col h-full bg-zinc-950 light:bg-[#faf8f4]">

      {/* ── Search + sync bar ── */}
      <div className="px-3 py-2.5 border-b border-zinc-800/80 light:border-[#e5ded1] flex items-center gap-2">
        <div className="relative flex-1">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600 light:text-[#a89e8c] pointer-events-none"
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats…"
            className="w-full bg-zinc-800/80 light:bg-white border border-zinc-700/60 light:border-[#ddd3bd] rounded-xl pl-8 pr-3 py-2 text-zinc-200 light:text-[#2b2620] text-sm placeholder:text-zinc-600 light:placeholder:text-[#a89e8c] focus:outline-none focus:border-violet-600/60 focus:bg-zinc-800 light:focus:bg-white transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 light:text-[#a89e8c] light:hover:text-[#6b6255]"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {onForceSync && (
          <button
            onClick={onForceSync}
            title="Sync across devices"
            className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
              syncing
                ? "text-violet-400 bg-violet-900/20"
                : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 light:text-[#8a7f6d] light:hover:text-[#2b2620] light:hover:bg-[#efe9dd]"
            }`}
          >
            <IconSync spinning={syncing} />
          </button>
        )}
      </div>

      {/* ── Sync status banner ── */}
      {syncing && (
        <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 bg-violet-950/40 light:bg-violet-50 border border-violet-800/40 light:border-violet-300 rounded-lg">
          <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse flex-shrink-0" />
          <span className="text-violet-300 light:text-violet-700 text-xs">Syncing across devices…</span>
        </div>
      )}

      {/* ── List ── */}
      <div className="flex-1 overflow-y-auto py-2 mobile-scroll">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-center px-6">
            <svg className="w-10 h-10 text-zinc-800 light:text-[#ddd3bd]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <div>
              <p className="text-zinc-500 light:text-[#8a7f6d] text-sm font-medium">
                {q ? "No matching chats" : "No conversations yet"}
              </p>
              {!q && <p className="text-zinc-700 light:text-[#c7bda8] text-xs mt-1">Start a new chat above</p>}
            </div>
          </div>
        ) : (
          groups.map(({ label, items }) => (
            <div key={label}>
              <div className="px-4 py-1.5 sticky top-0 bg-zinc-950/90 light:bg-[#faf8f4]/90 backdrop-blur-sm z-10">
                <span className="text-[10px] font-semibold text-zinc-600 light:text-[#a89e8c] uppercase tracking-widest">{label}</span>
              </div>
              <div className="px-2 space-y-0.5 pb-1">
                {items.map((conversation) => {
                  const isActive  = currentConversationId === conversation.id;
                  const isRevealed = activeId === conversation.id;
                  const msgCount  = conversation.messages.filter((m) => m.role === "user").length;

                  return (
                    <div
                      key={conversation.id}
                      className={`relative rounded-xl overflow-hidden transition-all duration-150 ${
                        isActive
                          ? "bg-violet-950/60 light:bg-violet-50 border border-violet-700/50 light:border-violet-300"
                          : "border border-transparent hover:bg-zinc-800/60 light:hover:bg-[#efe9dd] hover:border-zinc-700/40 light:hover:border-[#ddd3bd]"
                      }`}
                    >
                      {/* Main row */}
                      <div
                        className="flex items-start gap-3 px-3 py-3 cursor-pointer select-none"
                        onClick={() => {
                          if (isRevealed) { setActiveId(null); return; }
                          onSelectConversation(conversation);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setActiveId((prev) => prev === conversation.id ? null : conversation.id);
                        }}
                      >
                        {/* Colour dot — active indicator */}
                        <div className={`flex-shrink-0 mt-1 w-2 h-2 rounded-full ${
                          isActive ? "bg-violet-400" : "bg-zinc-700 light:bg-[#ddd3bd]"
                        }`} />

                        <div className="flex-1 min-w-0">
                          {/* Title */}
                          <p className={`text-sm font-medium leading-snug truncate ${
                            isActive ? "text-violet-100 light:text-violet-800" : "text-zinc-200 light:text-[#2b2620]"
                          }`}>
                            {conversation.title}
                          </p>

                          {/* Meta row */}
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {conversation.project && (
                              <span className="text-[11px] text-teal-500 light:text-teal-700 font-medium truncate max-w-[90px]">
                                {conversation.project}
                              </span>
                            )}
                            <span className="text-[11px] text-zinc-600 light:text-[#a89e8c]">
                              {relativeDate(conversation.updatedAt)}
                            </span>
                            {msgCount > 0 && (
                              <span className="text-[11px] text-zinc-700 light:text-[#c7bda8]">
                                {msgCount} msg{msgCount !== 1 ? "s" : ""}
                              </span>
                            )}
                            {conversation.githubContext?.repo && (
                              <span className="text-[11px] text-zinc-600 light:text-[#a89e8c] flex items-center gap-0.5">
                                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                                </svg>
                                {conversation.githubContext.repo.split("/").pop()}
                              </span>
                            )}
                            {conversation.systemPrompt && (
                              <span title="Has custom system prompt" className="text-violet-500 light:text-violet-600 text-[10px]">⚙</span>
                            )}
                          </div>

                          {/* Search snippet */}
                          {q && (() => {
                            const match = conversation.messages.find((m) =>
                              m.content.toLowerCase().includes(q)
                            );
                            if (!match) return null;
                            const idx     = match.content.toLowerCase().indexOf(q);
                            const snippet = match.content.slice(Math.max(0, idx - 15), idx + 50);
                            return (
                              <p className="text-zinc-500 light:text-[#8a7f6d] text-[11px] mt-1 italic truncate">…{snippet}…</p>
                            );
                          })()}
                        </div>

                        {/* Action buttons — always visible on mobile (touch-friendly) */}
                        <div className="flex-shrink-0 flex items-center gap-1 ml-1">
                          {onExportConversation && (
                            <button
                              title="Export"
                              onClick={(e) => { e.stopPropagation(); onExportConversation(conversation); }}
                              className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-600 hover:text-teal-400 hover:bg-zinc-700 light:text-[#a89e8c] light:hover:text-teal-600 light:hover:bg-[#e5ded1] transition-colors"
                            >
                              <IconExport />
                            </button>
                          )}
                          {onDeleteConversation && (
                            <button
                              title="Delete"
                              onClick={(e) => { e.stopPropagation(); onDeleteConversation(conversation.id); }}
                              className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-600 hover:text-red-400 hover:bg-zinc-700 light:text-[#a89e8c] light:hover:text-red-600 light:hover:bg-[#e5ded1] transition-colors"
                            >
                              <IconTrash />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}

        {/* ── Cross-device sync hint (shown when no gist is configured) ── */}
        {!syncing && conversations.length > 0 && !onForceSync && (
          <div className="mx-3 mt-4 mb-2 px-3 py-2.5 bg-zinc-900/60 light:bg-[#efe9dd] border border-zinc-800 light:border-[#ddd3bd] rounded-xl">
            <p className="text-zinc-500 light:text-[#6b6255] text-[11px] leading-relaxed">
              💡 Add <code className="text-zinc-400 light:text-[#4a4335] bg-zinc-800 light:bg-[#e5ded1] px-1 rounded">GITHUB_PAT</code> with the <code className="text-zinc-400 light:text-[#4a4335] bg-zinc-800 light:bg-[#e5ded1] px-1 rounded">gist</code> scope to sync history across devices.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}