import { describe, expect, it } from "vitest";
import { estimatePromptTokens } from "./promptTokens";

describe("estimatePromptTokens", () => {
  it("returns zero for an empty prompt", () => {
    expect(estimatePromptTokens("   ")).toBe(0);
  });

  it("uses a four-character approximation", () => {
    expect(estimatePromptTokens("12345678")).toBe(2);
    expect(estimatePromptTokens("123456789")).toBe(3);
  });

  it("normalizes surrounding whitespace", () => {
    expect(estimatePromptTokens("  hello world  ")).toBe(3);
  });
});
