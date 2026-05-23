"use client";

import type { AgentPlan } from "@/app/api/agent/route";

interface Props {
  plan: AgentPlan;
  task: string;
  onApprove: (plan: AgentPlan) => void;
  onReject: () => void;
  executing: boolean;
}

const ACTION_STYLES = {
  create: { label: "CREATE", bg: "bg-teal-900", text: "text-teal-300", border: "border-teal-700" },
  modify: { label: "MODIFY", bg: "bg-amber-900", text: "text-amber-300", border: "border-amber-700" },
  delete: { label: "DELETE", bg: "bg-red-900",   text: "text-red-300",   border: "border-red-700"   },
};

export default function PlanApproval({ plan, task, onApprove, onReject, executing }: Props) {
  return (
    <div className="border-t border-zinc-800 bg-zinc-950 flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-lg">📋</span>
          <div>
            <p className="text-zinc-100 text-sm font-semibold">Agent Plan</p>
            <p className="text-zinc-500 text-xs mt-0.5 max-w-lg truncate">"{task}"</p>
          </div>
        </div>
        <span className="text-xs text-zinc-500 bg-zinc-800 border border-zinc-700 rounded-full px-2 py-0.5">
          {plan.changes.length} file{plan.changes.length !== 1 ? "s" : ""} to change
        </span>
      </div>

      {/* Approach */}
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900">
        <p className="text-zinc-400 text-xs uppercase tracking-wider mb-1">Approach</p>
        <p className="text-zinc-200 text-sm">{plan.approach}</p>
      </div>

      {/* Changes list */}
      <div className="px-4 py-3 max-h-64 overflow-y-auto">
        <p className="text-zinc-400 text-xs uppercase tracking-wider mb-2">Planned changes</p>
        <div className="space-y-2">
          {plan.changes.map((change, i) => {
            const style = ACTION_STYLES[change.action] ?? ACTION_STYLES.modify;
            return (
              <div
                key={i}
                className={`rounded-lg border ${style.border} bg-zinc-900 px-3 py-2.5`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>
                    {style.label}
                  </span>
                  <span className="text-zinc-200 text-xs font-mono">{change.path}</span>
                </div>
                <p className="text-zinc-400 text-xs">{change.reason}</p>
                {change.details && (
                  <p className="text-zinc-500 text-xs mt-1 italic">{change.details}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-4 py-3 border-t border-zinc-800 flex items-center justify-between">
        <p className="text-zinc-600 text-xs">
          Approving will write these files. You'll review the actual code before pushing.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={onReject}
            disabled={executing}
            className="text-zinc-400 hover:text-zinc-200 text-sm px-4 py-2 transition-colors disabled:opacity-40"
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