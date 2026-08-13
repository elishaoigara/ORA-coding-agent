import { describe, expect, it } from "vitest";
import { myersDiff } from "./StagedChanges";

describe("myersDiff", () => {
  it("keeps unchanged lines aligned after an insertion", () => {
    expect(myersDiff(["a", "b"], ["x", "a", "b"])).toEqual([
      { type: "add", text: "x", lineNo: 1 },
      { type: "same", text: "a", lineNo: 1 },
      { type: "same", text: "b", lineNo: 2 },
    ]);
  });

  it("represents replacement as removal plus addition", () => {
    expect(myersDiff(["a", "old", "b"], ["a", "new", "b"])).toEqual([
      { type: "same", text: "a", lineNo: 1 },
      { type: "remove", text: "old", lineNo: 2 },
      { type: "add", text: "new", lineNo: 2 },
      { type: "same", text: "b", lineNo: 3 },
    ]);
  });

  it("handles empty input", () => {
    expect(myersDiff([], ["new"])).toEqual([
      { type: "add", text: "new", lineNo: 1 },
    ]);
  });
});
