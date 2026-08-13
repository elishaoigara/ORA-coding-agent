import { describe, expect, it } from "vitest";
import { agentRequestSchema, branchSchema, githubRequestSchema } from "./validation";

describe("agent request validation", () => {
  it("requires an approved plan for execution", () => {
    const result = agentRequestSchema.safeParse({
      task: "Fix the bug",
      repo: "owner/repo",
      phase: "execute",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a planning request without a plan", () => {
    expect(
      agentRequestSchema.safeParse({
        task: "Fix the bug",
        repo: "owner/repo",
        phase: "plan",
      }).success
    ).toBe(true);
  });

  it("rejects unbounded resumed file content", () => {
    const result = agentRequestSchema.safeParse({
      task: "Fix the bug",
      repo: "owner/repo",
      phase: "plan",
      resumeStagedFiles: [
        {
          path: "large.txt",
          content: "x".repeat(2_000_001),
          originalContent: null,
          description: "Large file",
          action: "create",
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("Git reference and path validation", () => {
  it("accepts normal nested branch names", () => {
    expect(branchSchema.safeParse("agent/fix-login").success).toBe(true);
  });

  it.each(["../main", "/main", "main.lock", "feature~1", "feature bad"])(
    "rejects invalid branch %s",
    (branch) => {
      expect(branchSchema.safeParse(branch).success).toBe(false);
    }
  );

  it("rejects repository traversal in pushed paths", () => {
    const result = githubRequestSchema.safeParse({
      action: "push_many",
      repo: "owner/repo",
      files: [{ path: "../secret", content: "nope" }],
    });
    expect(result.success).toBe(false);
  });
});
