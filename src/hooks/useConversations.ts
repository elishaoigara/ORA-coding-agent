"use client";
import { useState, useEffect, useCallback } from "react";
import type { Message, InjectedFile, GitHubContext } from "@/types";

export interface Conversation {
  id: string;
  title: string;
  project: string;
  messages: Message[];
  provider: string;
  model: string;
  githubContext?: GitHubContext; // ← persisted GitHub files/repo
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

  useEffect(() => {
    setConversations(load());
  }, []);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  const newConversation = useCallback(() => {
    setActiveId(null);
  }, []);

  const saveConversation = useCallback(
    (
      messages: Message[],
      provider: string,
      model: string,
      project = "",
      githubContext?: GitHubContext
    ) => {
      if (!messages.length) return;

      setConversations((prev) => {
        let updated: Conversation[];

        if (activeId) {
          updated = prev.map((c) =>
            c.id === activeId
              ? {
                  ...c,
                  messages,
                  provider,
                  model,
                  project,
                  githubContext: githubContext ?? c.githubContext,
                  title: autoTitle(messages),
                  updatedAt: Date.now(),
                }
              : c
          );
        } else {
          const newConv: Conversation = {
            id: crypto.randomUUID(),
            title: autoTitle(messages),
            project,
            messages,
            provider,
            model,
            githubContext,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          updated = [newConv, ...prev];
          setActiveId(newConv.id);
        }

        save(updated);
        return updated;
      });
    },
    [activeId]
  );

  /** Save only the GitHub context for the current conversation */
  const saveGitHubContext = useCallback(
    (repo: string, files: InjectedFile[]) => {
      if (!activeId) return;
      const ctx: GitHubContext = { repo, files, pinnedAt: Date.now() };
      setConversations((prev) => {
        const updated = prev.map((c) =>
          c.id === activeId ? { ...c, githubContext: ctx, updatedAt: Date.now() } : c
        );
        save(updated);
        return updated;
      });
    },
    [activeId]
  );

  const loadConversation = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => {
      const updated = prev.filter((c) => c.id !== id);
      save(updated);
      return updated;
    });
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);

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
    saveGitHubContext,
    loadConversation,
    deleteConversation,
    setProject,
  };
}
