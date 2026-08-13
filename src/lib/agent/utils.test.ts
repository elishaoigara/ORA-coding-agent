import { describe, expect, it } from "vitest";
import {
  getMissingChanges,
  parsePlanResponse,
  parseToolArguments,
  pruneToolMessages,
  upsertStagedFiles,
} from "./utils";
import type { AgentPlanChange, StagedFile } from "./types";

const existing: StagedFile = {
  path: "src/app.ts",
  content: "new",
  originalContent: "old",
  description: "Update app",
  action: "modify",
};

describe("agent utilities", () => {
  it("parses and validates structured plans", () => {
    const result = parsePlanResponse(`Analysis first.\n<PLAN>${JSON.stringify({
      summary: "Fix it",
      approach: "Change and test",
      changes: [
        {
          action: "modify",
          path: "src/app.ts",
          reason: "Bug",
          details: "Handle the edge case",
        },
      ],
    })}</PLAN>`);

    expect(result.narrative).toBe("Analysis first.");
    expect(result.plan?.changes[0].path).toBe("src/app.ts");
  });

  it("rejects plans without changes", () => {
    const result = parsePlanResponse(
      '<PLAN>{"summary":"No-op","approach":"None","changes":[]}</PLAN>'
    );
    expect(result.plan).toBeUndefined();
    expect(result.error).toContain("invalid");
  });

  it("parses object arguments and safely handles invalid JSON", () => {
    expect(parseToolArguments('{"path":"src/app.ts","line":2}')).toEqual({
      path: "src/app.ts",
      line: "2",
    });
    expect(parseToolArguments("not json")).toEqual({});
  });

  it("tracks normalized planned paths", () => {
    const changes: AgentPlanChange[] = [
      { action: "modify", path: "/src/app.ts", reason: "", details: "" },
      { action: "create", path: "src/new.ts", reason: "", details: "" },
    ];
    expect(getMissingChanges(changes, [existing]).map((change) => change.path)).toEqual([
      "src/new.ts",
    ]);
  });

  it("replaces later staged versions of the same path", () => {
    const corrected = { ...existing, content: "corrected" };
    expect(upsertStagedFiles([existing], [corrected])).toEqual([corrected]);
  });

  it("prunes large tool contents while preserving metadata", () => {
    const [message] = pruneToolMessages([
      {
        role: "tool",
        tool_call_id: "1",
        content: JSON.stringify({ path: "big.ts", lines: 200, content: "x".repeat(600) }),
      },
    ]);
    expect(message.content).toContain("[pruned - 200 lines]");
    expect(message.content).toContain("big.ts");
  });
});
