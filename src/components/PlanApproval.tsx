"use client";

import type { AgentPlan } from "@/lib/agent/types";

interface Props {
  plan: AgentPlan;
  task: string;
  onApprove: (plan: AgentPlan) => void;
  onReject: () => void;
  executing: boolean;
}

// Note: DELETE action requires the delete_file tool to be defined in agentTools.ts
// and the push_many handler in github/route.ts to handle null content entries.
// Both are now implemented - see agentTools.ts executeTool delete_file handler.
const ACTION_STYLES = {
  create: { label: "CREATE", bg: "bg-teal-900 light:bg-teal-100", text: "text-teal-300 light:text-teal-800", border: "border-teal-700 light:border-teal-300" },
  modify: { label: "MODIFY", bg: "bg-amber-900 light:bg-amber-100", text: "text-amber-300 light:text-amber-800", border: "border-amber-700 light:border-amber-300" },
  delete: { label: "DELETE", bg: "bg-red-900 light:bg-red-100",   text: "text-red-300 light:text-red-800",   border: "border-red-700 light:border-red-300"   },
};

export default function PlanApproval({ plan, task, onApprove, onReject, executing }: Props) {
  return (
    <div className="border-t border-zinc-800 light:border-[#e5ded1] bg-zinc-950 light:bg-[#faf8f4] flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 light:border-[#e5ded1]">
        <div className="flex items-center gap-2">
          <span className="text-lg">📋</span>
          <div>
            <p className="text-zinc-100 light:text-[#2b2620] text-sm font-semibold">Agent Plan</p>
            <p className="text-zinc-500 light:text-[#8a7f6d] text-xs mt-0.5 max-w-lg truncate">&ldquo;{task}&rdquo;</p>
          </div>
        </div>
        <span className="text-xs text-zinc-500 light:text-[#8a7f6d] bg-zinc-800 light:bg-[#efe9dd] border border-zinc-700 light:border-[#ddd3bd] rounded-full px-2 py-0.5">
          {plan.changes.length} file{plan.changes.length !== 1 ? "s" : ""} to change
        </span>
      </div>

      {/* Approach */}
      <div className="px-4 py-3 border-b border-zinc-800 light:border-[#e5ded1] bg-zinc-900 light:bg-white">
        <p className="text-zinc-400 light:text-[#8a7f6d] text-xs uppercase tracking-wider mb-1">Approach</p>
        <p className="text-zinc-200 light:text-[#2b2620] text-sm">{plan.approach}</p>
      </div>

      {/* Changes list */}
      <div className="px-4 py-3 max-h-64 overflow-y-auto">
        <p className="text-zinc-400 light:text-[#8a7f6d] text-xs uppercase tracking-wider mb-2">Planned changes</p>
        <div className="space-y-2">
          {plan.changes.map((change, i) => {
            const style = ACTION_STYLES[change.action] ?? ACTION_STYLES.modify;
            return (
              <div
                key={i}
                className={`rounded-lg border ${style.border} bg-zinc-900 light:bg-white px-3 py-2.5`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>
                    {style.label}
                  </span>
                  <span className="text-zinc-200 light:text-[#2b2620] text-xs font-mono">{change.path}</span>
                </div>
                <p className="text-zinc-400 light:text-[#6b6255] text-xs">{change.reason}</p>
                {change.details && (
                  <p className="text-zinc-500 light:text-[#8a7f6d] text-xs mt-1 italic">{change.details}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-4 py-3 border-t border-zinc-800 light:border-[#e5ded1] flex items-center justify-between">
        <p className="text-zinc-600 light:text-[#a89e8c] text-xs">
          Approving will write these files. You&apos;ll review the actual code before pushing.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={onReject}
            disabled={executing}
            className="text-zinc-400 hover:text-zinc-200 light:text-[#6b6255] light:hover:text-[#2b2620] text-sm px-4 py-2 transition-colors disabled:opacity-40"
          >
            ✗ Reject
          </button>
          <button
            onClick={() => onApprove(plan)}
            disabled={executing}
            className="bg-teal-700 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-5 py-2 text-sm font-medium transition-colors flex items-center gap-2"
          >
            {executing ? (
              <><span className="animate-spin inline-block">⟳</span> Executing…</>
            ) : (
              <>✓ Approve &amp; Execute</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
