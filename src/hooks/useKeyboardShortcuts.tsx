"use client";

import { useEffect, useCallback } from "react";

export interface ShortcutHandlers {
  onSend:         () => void;  // ⌘+Enter / Ctrl+Enter
  onNewChat:      () => void;  // ⌘+K
  onToggleAgent:  () => void;  // ⌘+/
  onToggleHistory:() => void;  // ⌘+H
  onToggleGitHub: () => void;  // ⌘+G
  onShowHelp:     () => void;  // ⌘+?
  onToggleTheme?: () => void;  // ⌘+L
}

/**
 * Registers global keyboard shortcuts for ORA.
 * All shortcuts use ⌘ (Mac) / Ctrl (Windows/Linux).
 *
 * Usage:
 *   useKeyboardShortcuts({
 *     onSend:          handleSend,
 *     onNewChat:       newConversation,
 *     onToggleAgent:   () => setAgentMode((v) => !v),
 *     onToggleHistory: () => setShowHistory((v) => !v),
 *     onToggleGitHub:  () => setShowGitHub((v) => !v),
 *     onShowHelp:      () => setShowHelp((v) => !v),
 *   });
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handle = useCallback(
    (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // Don't fire when typing in inputs/textareas (except ⌘+Enter which is intentional)
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      switch (e.key) {
        case "Enter":
          // ⌘+Enter: send message (works from textarea too)
          e.preventDefault();
          handlers.onSend();
          break;

        case "k":
        case "K":
          if (inInput) break;
          e.preventDefault();
          handlers.onNewChat();
          break;

        case "/":
          if (inInput) break;
          e.preventDefault();
          handlers.onToggleAgent();
          break;

        case "h":
        case "H":
          if (inInput) break;
          e.preventDefault();
          handlers.onToggleHistory();
          break;

        case "g":
        case "G":
          if (inInput) break;
          e.preventDefault();
          handlers.onToggleGitHub();
          break;

        case "?":
          if (inInput) break;
          e.preventDefault();
          handlers.onShowHelp();
          break;

        case "l":
        case "L":
          if (inInput) break;
          if (!handlers.onToggleTheme) break;
          e.preventDefault();
          handlers.onToggleTheme();
          break;

        default:
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handlers.onSend, handlers.onNewChat, handlers.onToggleAgent,
     handlers.onToggleHistory, handlers.onToggleGitHub, handlers.onShowHelp, handlers.onToggleTheme]
  );

  useEffect(() => {
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [handle]);
}

// ── Cheatsheet modal ──────────────────────────────────────────────────────────

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD    = IS_MAC ? "⌘" : "Ctrl";

export const SHORTCUTS = [
  { keys: `${MOD}+Enter`, description: "Send message" },
  { keys: `${MOD}+K`,     description: "New conversation" },
  { keys: `${MOD}+/`,     description: "Toggle agent mode" },
  { keys: `${MOD}+H`,     description: "Toggle history panel" },
  { keys: `${MOD}+G`,     description: "Toggle GitHub sidebar" },
  { keys: `${MOD}+L`,     description: "Toggle light / dark theme" },
  { keys: `${MOD}+?`,     description: "Show / hide this help" },
] as const;

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutHelpModal({ open, onClose }: HelpModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 light:bg-white border border-zinc-700 light:border-[#e5ded1] rounded-xl p-6 min-w-64 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-zinc-200 light:text-[#2b2620] text-sm font-medium">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            className="text-zinc-600 hover:text-zinc-400 light:text-[#a89e8c] light:hover:text-[#6b6255] text-xs"
          >
            Esc
          </button>
        </div>

        <table className="w-full text-xs">
          <tbody>
            {SHORTCUTS.map(({ keys, description }) => (
              <tr key={keys} className="border-b border-zinc-800 light:border-[#e5ded1] last:border-0">
                <td className="py-2 pr-6">
                  <kbd className="bg-zinc-800 light:bg-[#efe9dd] border border-zinc-700 light:border-[#ddd3bd] rounded px-1.5 py-0.5 font-mono text-zinc-300 light:text-[#4a4335]">
                    {keys}
                  </kbd>
                </td>
                <td className="py-2 text-zinc-400 light:text-[#6b6255]">{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}