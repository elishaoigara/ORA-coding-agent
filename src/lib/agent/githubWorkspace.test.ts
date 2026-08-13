import { describe, expect, it } from "vitest";
import { normalizeRepositoryPath } from "./githubWorkspace";

describe("normalizeRepositoryPath", () => {
  it("normalizes root and leading slashes", () => {
    expect(normalizeRepositoryPath("/")).toBe("");
    expect(normalizeRepositoryPath("//src//app.tsx")).toBe("src/app.tsx");
  });

  it("rejects paths that escape the repository", () => {
    expect(() => normalizeRepositoryPath("../secret")).toThrow("Invalid repository path");
    expect(() => normalizeRepositoryPath("src/../secret")).toThrow("Invalid repository path");
  });
});
