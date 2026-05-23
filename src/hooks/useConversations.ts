"use client";
import { useState, useEffect, useCallback } from "react";
import type { Message } from "@/types";

export interface Conversation {
  id: string;
  title: string;
  project: string;       // e.g. "ORA Agent", "Client App", ""
  messages: Message[];
  provider: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "codeagent:conversations";

function load(): Conversation[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function save(conversations: Conversation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
}

export function autoTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === "user")?.content ?? "New chat";
  return first.slice(0, 52) + (first.length > 52 ? "…" : "");
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    setConversations(load());
  }, []);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  /** Start a brand-new empty conversation */
  const newConversation = useCallback(() => {
    setActiveId(null);
  }, []);

  /** Save/update the current conversation */
  const saveConversation = useCallback(
    (messages: Message[], provider: string, model: string, project = "") => {
      if (!messages.length) return;

      setConversations((prev) => {
        let updated: Conversation[];

        if (activeId) {
          // Update existing
          updated = prev.map((c) =>
            c.id === activeId
              ? { ...c, messages, provider, model, project, title: autoTitle(messages), updatedAt: Date.now() }
              : c
          );
        } else {
          // Create new conversation and set it as active
          const newConv: Conversation = {
            id: crypto.randomUUID(),
            title: autoTitle(messages),
            project,
            messages,
            provider,
            model,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          updated = [newConv, ...prev];
          // We return id so caller can set it
          setActiveId(newConv.id);
        }

        save(updated);
        return updated;
      });
    },
    [activeId]
  );

  /** Load a past conversation */
  const loadConversation = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  /** Delete a conversation */
  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => {
      const updated = prev.filter((c) => c.id !== id);
      save(updated);
      return updated;
    });
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);

  /** Update project tag on active conversation */
  const setProject = useCallback(
    (project: string) => {
      if (!activeId) return;
      setConversations((prev) => {
        const updated = prev.map((c) =>
          c.id === activeId ? { ...c, project, updatedAt: Date.now() } : c
        );
        save(updated);
        return updated;
      });
    },
    [activeId]
  );

  return {
    conversations,
    active,
    activeId,
    newConversation,
    saveConversation,
    loadConversation,
    deleteConversation,
    setProject,
  };
}