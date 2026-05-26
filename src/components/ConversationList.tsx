'use client';

import { useState } from 'react';
import { Conversation } from '@/types';

export default function ConversationList({ 
  conversations, 
  onSelectConversation,
  onDeleteConversation,
  onExportConversation,
  currentConversationId
}: { 
  conversations: Conversation[]; 
  onSelectConversation: (conversation: Conversation) => void;
  onDeleteConversation?: (id: string) => void;
  onExportConversation?: (conv: Conversation) => void;
  currentConversationId?: string;
}) {
  const [search, setSearch] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(q) ||
        c.project?.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
      )
    : conversations;

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-2 border-b border-zinc-800">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search chats…"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-zinc-300 text-xs placeholder:text-zinc-600 focus:outline-none focus:border-teal-600"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-zinc-500 text-xs">
            {q ? "No matches" : "No conversations yet"}
          </div>
        ) : (
          filtered.map((conversation) => (
            <div
              key={conversation.id}
              onMouseEnter={() => setHoveredId(conversation.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={`rounded-lg cursor-pointer transition-colors group ${
                currentConversationId === conversation.id
                  ? 'bg-teal-900/50 border border-teal-800'
                  : 'hover:bg-zinc-800 border border-transparent'
              }`}
            >
              <div
                className="px-3 py-2.5 flex items-start justify-between gap-2"
                onClick={() => onSelectConversation(conversation)}
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate text-xs font-medium text-zinc-200">{conversation.title}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {conversation.project && (
                      <span className="text-teal-500 text-xs truncate max-w-[80px]">{conversation.project}</span>
                    )}
                    <span className="text-zinc-600 text-xs">
                      {new Date(conversation.updatedAt).toLocaleDateString()}
                    </span>
                    {conversation.systemPrompt && (
                      <span title="Has system prompt" className="text-purple-400 text-xs">⚙</span>
                    )}
                  </div>
                  {q && (() => {
                    const match = conversation.messages.find((m) => m.content.toLowerCase().includes(q));
                    if (!match) return null;
                    const idx = match.content.toLowerCase().indexOf(q);
                    const snippet = match.content.slice(Math.max(0, idx - 20), idx + 50);
                    return (
                      <div className="text-zinc-500 text-xs mt-1 italic truncate">…{snippet}…</div>
                    );
                  })()}
                </div>

                <div className={`flex items-center gap-1 flex-shrink-0 transition-opacity ${hoveredId === conversation.id ? "opacity-100" : "opacity-0"}`}>
                  {onExportConversation && (
                    <button
                      title="Export as Markdown"
                      onClick={(e) => { e.stopPropagation(); onExportConversation(conversation); }}
                      className="text-zinc-500 hover:text-teal-400 text-xs p-1 rounded"
                    >↓</button>
                  )}
                  {onDeleteConversation && (
                    <button
                      title="Delete"
                      onClick={(e) => { e.stopPropagation(); onDeleteConversation(conversation.id); }}
                      className="text-zinc-500 hover:text-red-400 text-xs p-1 rounded"
                    >✕</button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}