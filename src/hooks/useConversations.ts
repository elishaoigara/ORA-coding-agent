"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import type { Message, InjectedFile, GitHubContext, Conversation } from "@/types";
import { readSse } from "@/lib/readSse";

export type { Conversation };

const LS_KEY      = "codeagent:conversations";
const LS_GIST_KEY = "codeagent:gistId";
const POLL_MS     = 30_000; // poll remote every 30 s for cross-device sync

// ── SSR-safe localStorage helpers ────────────────────────────────────────────
function lsLoad(): Conversation[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]"); } catch { return []; }
}
function lsSave(c: Conversation[]) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch { /* quota */ }
}
function lsGetString(key: string): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSetString(key: string, value: string) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, value); } catch { /* quota */ }
}

export function autoTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === "user")?.content ?? "New chat";
  return first.slice(0, 52) + (first.length > 52 ? "…" : "");
}

function mergeLocal(local: Conversation[], remote: Conversation[]): Conversation[] {
  const byId = new Map(remote.map((c) => [c.id, c]));
  for (const lc of local) {
    const rc = byId.get(lc.id);
    if (!rc || lc.updatedAt > rc.updatedAt) byId.set(lc.id, lc);
  }
  return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

// ── Smart title via /api/chat ─────────────────────────────────────────────────
async function generateSmartTitle(userMessage: string, assistantReply: string): Promise<string | null> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{
          role: "user",
          content: `Summarise this conversation in 5 words or fewer. Reply with ONLY the title, no punctuation, no quotes.\n\nUser: ${userMessage.slice(0, 200)}\nAssistant: ${assistantReply.slice(0, 200)}`,
        }],
        provider: "auto", model: "", injectedFiles: [],
      }),
    });
    if (!res.ok) return null;
    let title = "";
    await readSse(res, ({ event, data }) => {
      if (event === "error" || data === "[DONE]") return;
      const payload = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string } }>;
      };
      title += payload.choices?.[0]?.delta?.content ?? "";
    });
    return title.trim().replace(/[“”"'’]/g, "").slice(0, 60) || null;
  } catch {
    return null;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId,      setActiveId]      = useState<string | null>(null);
  const [syncing,       setSyncing]       = useState(false);
  const [lastSyncedAt,  setLastSyncedAt]  = useState<number | null>(null);
  const gistIdRef  = useRef<string | null>(null);
  const saveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer  = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Remote fetch (read-merge-apply) ────────────────────────────────────────
  const fetchRemote = useCallback(async (silent = false) => {
    if (!silent) setSyncing(true);
    try {
      const qs  = gistIdRef.current ? `?gistId=${gistIdRef.current}` : "";
      const res = await fetch(`/api/conversations${qs}`);
      if (!res.ok) return;
      const { conversations: remote, gistId, syncedAt } = await res.json();
      if (gistId) {
        gistIdRef.current = gistId;
        lsSetString(LS_GIST_KEY, gistId);
      }
      if (Array.isArray(remote) && remote.length > 0) {
        setConversations((prev) => {
          const merged = mergeLocal(prev, remote as Conversation[]);
          lsSave(merged);
          return merged;
        });
      }
      if (syncedAt) setLastSyncedAt(syncedAt);
    } catch { /* network unavailable */ }
    finally { if (!silent) setSyncing(false); }
  }, []);

  // ── Remote save (debounced, read-merge-write) ───────────────────────────────
  const remoteSave = useCallback((updated: Conversation[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/conversations", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ conversations: updated, gistId: gistIdRef.current }),
        });
        if (!res.ok) return;
        const { gistId, syncedAt, conversations: merged } = await res.json();
        if (gistId) {
          gistIdRef.current = gistId;
          lsSetString(LS_GIST_KEY, gistId);
        }
        // Apply any remote changes the server merged in
        if (Array.isArray(merged)) {
          setConversations((prev) => {
            const final = mergeLocal(prev, merged as Conversation[]);
            lsSave(final);
            return final;
          });
        }
        if (syncedAt) setLastSyncedAt(syncedAt);
      } catch { /* offline */ }
    }, 1200);
  }, []);

  // ── Boot: load local then remote ───────────────────────────────────────────
  useEffect(() => {
    const local = lsLoad();
    setConversations(local);
    gistIdRef.current = lsGetString(LS_GIST_KEY);
    fetchRemote();

    // Poll for cross-device changes every 30 s
    pollTimer.current = setInterval(() => fetchRemote(true), POLL_MS);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [fetchRemote]);

  // ── Selectors ──────────────────────────────────────────────────────────────
  const active = conversations.find((c) => c.id === activeId) ?? null;

  // ── Actions ────────────────────────────────────────────────────────────────
  const newConversation = useCallback(() => setActiveId(null), []);

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

          // Fire-and-forget smart title
          const userMsg   = messages.find((m) => m.role === "user")?.content ?? "";
          const assistMsg = messages.find((m) => m.role === "assistant")?.content ?? "";
          if (userMsg && assistMsg) {
            generateSmartTitle(userMsg, assistMsg).then((smartTitle) => {
              if (!smartTitle) return;
              setConversations((prev2) => {
                const u = prev2.map((c) => c.id === nc.id ? { ...c, title: smartTitle } : c);
                lsSave(u); remoteSave(u); return u;
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

  const loadConversation = useCallback((id: string) => setActiveId(id), []);

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
    conversations, active, activeId, syncing, lastSyncedAt,
    newConversation, saveConversation, saveGitHubContext,
    loadConversation, deleteConversation, setProject, saveSystemPrompt,
    forceSync: () => fetchRemote(false),
  };
}