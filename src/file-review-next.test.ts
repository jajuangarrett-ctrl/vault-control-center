import { describe, expect, it } from "vitest";
import { nextReviewPath } from "./file-review";
describe("review navigation", () => {
  it("advances from the current item and wraps without reopening it", () => {
    expect(nextReviewPath(["a", "b", "c"], "a", [])).toBe("b");
    expect(nextReviewPath(["a", "b", "c"], "c", [])).toBe("a");
    expect(nextReviewPath(["a"], "a", [])).toBeNull();
  });
  it("retains the successor after filing and skips removed or filtered files", () => {
    expect(nextReviewPath(["a", "c"], "b", ["a", "b", "c"])).toBe("c");
    expect(nextReviewPath(["d"], "b", ["a", "b", "c", "d"])).toBe("d");
    expect(nextReviewPath([], "b", ["a", "b"])).toBeNull();
  });
});
