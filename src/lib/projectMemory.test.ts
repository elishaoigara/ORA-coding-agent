import { describe, expect, it } from "vitest";
import { createProjectMemory, memoryPromptContext } from "./projectMemory";
import { collaborationBrief, getSpecialists } from "./collaboration";

describe("project memory", () => {
  it("normalizes oversized and malformed user-maintained context", () => {
    const memory = createProjectMemory("owner/repo", { architecture: "x".repeat(20_000), decisions: Array.from({ length: 60 }, (_, i) => `Decision ${i}`) });
    expect(memory.architecture).toHaveLength(8_000);
    expect(memory.decisions).toHaveLength(40);
    expect(memoryPromptContext(memory)).toContain("PROJECT MEMORY");
  });

  it("omits empty sections from the prompt context", () => {
    expect(memoryPromptContext(createProjectMemory("owner/repo"))).toBe("");
  });
});

describe("specialist collaboration", () => {
  it("allows at most four recognized roles", () => {
    expect(getSpecialists(["researcher", "debugger", "tester", "reviewer", "security", "unknown"]).map((role) => role.id)).toEqual(["researcher", "debugger", "tester", "reviewer"]);
  });

  it("builds a manager reconciliation brief", () => {
    const brief = collaborationBrief(["security", "devops"]);
    expect(brief).toContain("Security");
    expect(brief).toContain("manager agent");
  });
});
