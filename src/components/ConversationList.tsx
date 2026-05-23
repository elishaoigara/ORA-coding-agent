"use client";
import { useState } from "react";
import type { Conversation } from "@/hooks/useConversations";

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

function groupByDate(conversations: Conversation[]) {
  const now = Date.now();
  const DAY = 86_400_000;
  const groups: Record<string, Conversation[]> = {
    Today: [],
    Yesterday: [],
    "Last 7 days": [],
    Older: [],
  };
  for (const c of conversations) {
    const age = now - c.updatedAt;
    if (age < DAY) groups["Today"].push(c);
    else if (age < 2 * DAY) groups["Yesterday"].push(c);
    else if (age < 7 * DAY) groups["Last 7 days"].push(c);
    else groups["Older"].push(c);
  }
  return groups;
}

export default function ConversationList({ conversations, activeId, onSelect, onNew, onDelete }: Props) {
  const [search, setSearch] = useState("");
  const [filterProject, setFilterProject] = useState("");

  // All unique project tags
  const projects = [...new Set(conversations.map((c) => c.project).filter(Boolean))];

  const filtered = conversations.filter((c) => {
    const matchSearch = c.title.toLowerCase().includes(search.toLowerCase());
    const matchProject = !filterProject || c.project === filterProject;
    return matchSearch && matchProject;
  });

  const groups = groupByDate(filtered);

  return (
    <div className="flex flex-col h-full">
      {/* New chat button */}
      <div className="px-3 py-2 border-b border-zinc-800">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-900 hover:bg-teal-800 border border-teal-700 text-teal-300 text-xs font-medium transition-colors"
        >
          <span className="text-base leading-none">+</span> New Chat
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-zinc-800 flex flex-col gap-1.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search chats…"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1.5 text-zinc-300 text-xs focus:outline-none focus:border-teal-600 placeholder:text-zinc-600"
        />
        {/* Project filter pills */}
        {projects.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setFilterProject("")}
              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                !filterProject
                  ? "bg-teal-900 border-teal-700 text-teal-300"
                  : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              All
            </button>
            {projects.map((p) => (
              <button
                key={p}
                onClick={() => setFilterProject(p === filterProject ? "" : p)}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                  filterProject === p
                    ? "bg-teal-900 border-teal-700 text-teal-300"
                    : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {filtered.length === 0 && (
          <p className="text-zinc-600 text-xs text-center mt-4">No chats yet</p>
        )}
        {Object.entries(groups).map(([label, items]) => {
          if (!items.length) return null;
          return (
            <div key={label} className="mb-3">
              <p className="text-zinc-600 text-xs px-2 mb-1 uppercase tracking-wider">{label}</p>
              {items.map((c) => (
                <ConversationItem
                  key={c.id}
                  conversation={c}
                  isActive={c.id === activeId}
                  onSelect={() => onSelect(c.id)}
                  onDelete={() => onDelete(c.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConversationItem({
  conversation: c,
  isActive,
  onSelect,
  onDelete,
}: {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 cursor-pointer mb-0.5 ${
        isActive ? "bg-zinc-700" : "hover:bg-zinc-800"
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onSelect}
    >
      <div className="flex-1 min-w-0">
        <p className="text-zinc-200 text-xs truncate">{c.title}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {c.project && (
            <span className="text-teal-500 text-xs truncate max-w-[80px]">{c.project}</span>
          )}
          <span className="text-zinc-600 text-xs">{c.messages.length} msgs</span>
        </div>
      </div>
      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="text-zinc-600 hover:text-red-400 text-xs flex-shrink-0 transition-colors"
          title="Delete"
        >
          ✕
        </button>
      )}
    </div>
  );
}