import { describe, expect, it } from "vitest";
import type { ReviewRow } from "./file-review";
import { groupReviewDays, processingDay, reviewDayOpen, setReviewDayOpen } from "./file-review-days";
const row = (path: string, ...processed: string[]) => ({ currentPath: path, history: processed.map(processed => ({ processed })) } as ReviewRow);
describe("processing day sections", () => {
  it("uses latest valid processing day for merged histories, groups files once, sorts newest first and unknown last", () => {
    const rows = [row("a", "2026-09-17 23:59 PDT", "2026-09-18T23:59:00-07:00"), row("b", "2026-09-18"), row("c", "2026-09-17"), row("d", "bad date")];
    const groups = groupReviewDays(rows);
    expect(groups.map(g => [g.key, g.rows.length])).toEqual([["2026-09-18",2],["2026-09-17",1],["unknown",1]]);
    expect(groups[0].label).toMatch(/September 18, 2026/);
    expect(processingDay("2026-02-30")).toBeNull();
  });
  it("defaults to newest expanded, preserves toggles after refresh and exposes filtered matches with accurate counts", () => {
    const choices = new Map<string, boolean>();
    expect(reviewDayOpen(choices,"","2026-09-18",0)).toBe(true);
    expect(reviewDayOpen(choices,"","2026-09-17",1)).toBe(false);
    setReviewDayOpen(choices,"","2026-09-18",false);
    setReviewDayOpen(choices,"","2026-09-17",true);
    expect(reviewDayOpen(choices,"","2026-09-18",0)).toBe(false);
    expect(reviewDayOpen(choices,"","2026-09-17",1)).toBe(true);
    const filtered = groupReviewDays([row("matched file", "2026-09-17")]);
    expect(filtered[0].rows).toHaveLength(1);
    expect(reviewDayOpen(choices,"search",filtered[0].key,0)).toBe(true);
    setReviewDayOpen(choices,"search",filtered[0].key,false);
    expect(reviewDayOpen(choices,"search",filtered[0].key,0)).toBe(false);
    expect(reviewDayOpen(choices,"","2026-09-17",1)).toBe(true);
  });
});
