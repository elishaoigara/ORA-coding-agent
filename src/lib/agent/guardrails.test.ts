import { describe, expect, it } from "vitest";
import { getAgentBudget, profileTask, validatePlan } from "./guardrails";
import type { AgentPlan } from "./types";

const basePlan: AgentPlan = {
  summary: "Improve the agent runtime",
  approach: "Add bounded execution and validate plans before staging.",
  changes: [
    {
      action: "modify",
      path: "src/app/api/agent/route.ts",
      reason: "Centralize runtime controls.",
      details: "Use a task profile and bounded iteration/tool budgets.",
    },
  ],
};

describe("agent guardrails", () => {
  it("accepts a focused safe plan", () => {
    expect(validatePlan(basePlan).valid).toBe(true);
  });

  it("rejects traversal, protected paths, and duplicate entries", () => {
    const result = validatePlan({
      ...basePlan,
      changes: [
        ...basePlan.changes,
        { ...basePlan.changes[0] },
        { ...basePlan.changes[0], path: "../secrets.env" },
        { ...basePlan.changes[0], path: ".git/config" },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/Duplicate|Unsafe/);
  });

  it("profiles high-risk security work", () => {
    expect(profileTask("rotate auth credentials and fix production security")).toMatchObject({
      kind: "bugfix",
      risk: "high",
      requiresVerification: true,
    });
  });

  it("keeps budgets within safe configured bounds", () => {
    expect(getAgentBudget()).toMatchObject({
      maxIterations: expect.any(Number),
      maxToolCalls: expect.any(Number),
      maxChanges: expect.any(Number),
    });
  });
});
