"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import type { Message, InjectedFile, GitHubContext } from "@/types";

export interface Conversation {
  id: string;
  title: string;
  project: string;
  messages: Message[];
  provider: string;
  model: string;
  githubContext?: GitHubContext;
  createdAt: number;
  updatedAt: number;
}

const LS_KEY      = "codeagent:conversations";
const LS_GIST_KEY = "codeagent:gistId"; // cache the gist id so we skip the list-search on every save

function lsLoad(): Conversation[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]"); } catch { return []; }
}
function lsSave(c: Conversation[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch { /* quota */ }
}

export function autoTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === "user")?.content ?? "New chat";
  return first.slice(0, 52) + (first.length > 52 ? "…" : "");
}

// ── merge: server wins for shared ids, keep local-only conversations ─────────
function merge(local: Conversation[], remote: Conversation[]): Conversation[] {
  const byId = new Map(remote.map((c) => [c.id, c]));
  // keep remote version if newer, else keep local
  for (const lc of local) {
    const rc = byId.get(lc.id);
    if (!rc || lc.updatedAt > rc.updatedAt) byId.set(lc.id, lc);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId]           = useState<string | null>(null);
  const [syncing, setSyncing]             = useState(false);
  const gistIdRef = useRef<string | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initial load: localStorage immediately, then merge with remote ──────────
  useEffect(() => {
    const local = lsLoad();
    setConversations(local);

    // Cache gist id from last session
    gistIdRef.current = localStorage.getItem(LS_GIST_KEY) ?? null;

    setSyncing(true);
    fetch("/api/conversations")
      .then((r) => r.json())
      .then(({ conversations: remote, gistId }) => {
        if (gistId) {
          gistIdRef.current = gistId;
          localStorage.setItem(LS_GIST_KEY, gistId);
        }
        if (!Array.isArray(remote) || remote.length === 0) return;
        setConversations((prev) => {
          const merged = merge(prev, remote);
          lsSave(merged);
          return merged;
        });
      })
      .catch(() => { /* offline — local data is fine */ })
      .finally(() => setSyncing(false));
  }, []);

  // ── Debounced remote sync ────────────────────────────────────────────────────
  const remoteSave = useCallback((updated: Conversation[]) => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversations: updated, gistId: gistIdRef.current }),
      })
        .then((r) => r.json())
        .then(({ gistId }) => {
          if (gistId) {
            gistIdRef.current = gistId;
            localStorage.setItem(LS_GIST_KEY, gistId);
          }
        })
        .catch(() => { /* offline — localStorage still has it */ });
    }, 1200); // 1.2 s debounce so rapid edits don't spam the GitHub API
  }, []);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  const newConversation = useCallback(() => { setActiveId(null); }, []);

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
              ? { ...c, messages, provider, model, project,
                  githubContext: githubContext ?? c.githubContext,
                  title: autoTitle(messages), updatedAt: Date.now() }
              : c
          );
        } else {
          const nc: Conversation = {
            id: crypto.randomUUID(), title: autoTitle(messages),
            project, messages, provider, model, githubContext,
            createdAt: Date.now(), updatedAt: Date.now(),
          };
          updated = [nc, ...prev];
          setActiveId(nc.id);
        }

        lsSave(updated);
        remoteSave(updated);
        return updated;
      });
    },
    [activeId, remoteSave]
  );

  const saveGitHubContext = useCallback(
    (repo: string, files: InjectedFile[]) => {
      if (!activeId) return;
      const ctx: GitHubContext = { repo, files, pinnedAt: Date.now() };
      setConversations((prev) => {
        const updated = prev.map((c) =>
          c.id === activeId ? { ...c, githubContext: ctx, updatedAt: Date.now() } : c
        );
        lsSave(updated);
        remoteSave(updated);
        return updated;
      });
    },
    [activeId, remoteSave]
  );

  const loadConversation = useCallback((id: string) => { setActiveId(id); }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => {
      const updated = prev.filter((c) => c.id !== id);
      lsSave(updated);
      remoteSave(updated);
      return updated;
    });
    setActiveId((cur) => (cur === id ? null : cur));
  }, [remoteSave]);

  const setProject = useCallback(
    (project: string) => {
      if (!activeId) return;
      setConversations((prev) => {
        const updated = prev.map((c) =>
          c.id === activeId ? { ...c, project, updatedAt: Date.now() } : c
        );
        lsSave(updated);
        remoteSave(updated);
        return updated;
      });
    },
    [activeId, remoteSave]
  );

  return {
    conversations, active, activeId, syncing,
    newConversation, saveConversation, saveGitHubContext,
    loadConversation, deleteConversation, setProject,
  };
}
