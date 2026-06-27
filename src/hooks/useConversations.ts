"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import type { Message, InjectedFile, GitHubContext, Conversation } from "@/types";

export type { Conversation };

const LS_KEY      = "codeagent:conversations";
const LS_GIST_KEY = "codeagent:gistId";

// Bug fix #9: guard localStorage access for SSR safety
function lsLoad(): Conversation[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]"); } catch { return []; }
}
function lsSave(c: Conversation[]) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch { /* quota */ }
}

export function autoTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === "user")?.content ?? "New chat";
  return first.slice(0, 52) + (first.length > 52 ? "…" : "");
}

function merge(local: Conversation[], remote: Conversation[]): Conversation[] {
  const byId = new Map(remote.map((c) => [c.id, c]));
  for (const lc of local) {
    const rc = byId.get(lc.id);
    if (!rc || lc.updatedAt > rc.updatedAt) byId.set(lc.id, lc);
  }
  return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

// UI improvement #6: generate a better title via a quick AI call
// Runs fire-and-forget after the first assistant reply
async function generateSmartTitle(userMessage: string, assistantReply: string): Promise<string | null> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-app-password": "local" },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: `Summarise this conversation in 5 words or fewer. Reply with ONLY the title, no punctuation, no quotes.\n\nUser: ${userMessage.slice(0, 200)}\nAssistant: ${assistantReply.slice(0, 200)}`,
          },
        ],
        provider: "auto",
        model: "",
        injectedFiles: [],
      }),
    });
    if (!res.ok) return null;

    const reader  = res.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let title     = "";
    let buf       = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        try {
          const parsed = JSON.parse(line.slice(6));
          title += parsed.choices?.[0]?.delta?.content ?? "";
        } catch { /* partial */ }
      }
    }
    const clean = title.trim().replace(/["""'']/g, "").slice(0, 60);
    return clean || null;
  } catch {
    return null;
  }
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId]           = useState<string | null>(null);
  const [syncing, setSyncing]             = useState(false);
  const gistIdRef = useRef<string | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const local = lsLoad();
    setConversations(local);
    // Bug fix #9: safe localStorage access
    if (typeof window !== "undefined") {
      gistIdRef.current = localStorage.getItem(LS_GIST_KEY) ?? null;
    }
    setSyncing(true);
    const qs = gistIdRef.current ? `?gistId=${gistIdRef.current}` : "";
    fetch(`/api/conversations${qs}`)
      .then((r) => r.json())
      .then(({ conversations: remote, gistId }) => {
        if (gistId) {
          gistIdRef.current = gistId;
          if (typeof window !== "undefined") localStorage.setItem(LS_GIST_KEY, gistId);
        }
        if (!Array.isArray(remote) || remote.length === 0) return;
        setConversations((prev) => { const merged = merge(prev, remote); lsSave(merged); return merged; });
      })
      .catch(() => {})
      .finally(() => setSyncing(false));
  }, []);

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
            if (typeof window !== "undefined") localStorage.setItem(LS_GIST_KEY, gistId);
          }
        })
        .catch(() => {});
    }, 1200);
  }, []);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const newConversation = useCallback(() => { setActiveId(null); }, []);

  const saveConversation = useCallback(
    (messages: Message[], provider: string, model: string, project = "", githubContext?: GitHubContext) => {
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

          // UI improvement #6: kick off smart title generation after first reply
          const userMsg   = messages.find((m) => m.role === "user")?.content ?? "";
          const assistMsg = messages.find((m) => m.role === "assistant")?.content ?? "";
          if (userMsg && assistMsg) {
            generateSmartTitle(userMsg, assistMsg).then((smartTitle) => {
              if (!smartTitle) return;
              setConversations((prev2) => {
                const u = prev2.map((c) =>
                  c.id === nc.id ? { ...c, title: smartTitle } : c
                );
                lsSave(u);
                remoteSave(u);
                return u;
              });
            });
          }
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
        lsSave(updated); remoteSave(updated); return updated;
      });
    },
    [activeId, remoteSave]
  );

  const loadConversation = useCallback((id: string) => { setActiveId(id); }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => {
      const updated = prev.filter((c) => c.id !== id);
      lsSave(updated); remoteSave(updated); return updated;
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
        lsSave(updated); remoteSave(updated); return updated;
      });
    },
    [activeId, remoteSave]
  );

  const saveSystemPrompt = useCallback(
    (systemPrompt: string) => {
      if (!activeId) return;
      setConversations((prev) => {
        const updated = prev.map((c) =>
          c.id === activeId ? { ...c, systemPrompt, updatedAt: Date.now() } : c
        );
        lsSave(updated); remoteSave(updated); return updated;
      });
    },
    [activeId, remoteSave]
  );

  return {
    conversations, active, activeId, syncing,
    newConversation, saveConversation, saveGitHubContext,
    loadConversation, deleteConversation, setProject, saveSystemPrompt,
  };
}