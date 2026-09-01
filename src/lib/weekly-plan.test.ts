import { describe, expect, it } from "vitest";
import { normalizeWeekDate, normalizeWeekRange, normalizeWeeklyPlan, renderWeeklyPlan } from "../../shared/weekly-plan";

describe("weekly plan", () => {
  it("normalizes bounded strategy and unique days", () => {
    const plan = normalizeWeeklyPlan({ weekKey: "2026-08-24", outcomes: [" Ship ", "Ship"], focusAreas: ["Growth"], risks: ["Scope"], notToDo: ["Random work"], days: [{ dateKey: "2026-08-24", priorities: ["A"] }, { dateKey: "2026-08-24", priorities: ["B"] }], notes: " steady " });
    expect(plan.outcomes).toEqual(["Ship"]); expect(plan.days).toEqual([{ dateKey: "2026-08-24", priorities: ["A"] }]); expect(plan.notes).toBe("steady");
  });
  it("rejects invalid dates and week windows", () => {
    expect(normalizeWeekDate("2026-02-30")).toBe("");
    const start = Date.now() - 3 * 24 * 60 * 60_000;
    expect(normalizeWeekRange(start, start + 7 * 24 * 60 * 60_000)).not.toBeNull();
    expect(normalizeWeekRange(start, start + 2 * 24 * 60 * 60_000)).toBeNull();
  });
  it("renders daily priorities as compact agent context", () => {
    const text = renderWeeklyPlan({ weekKey: "2026-08-24", outcomes: ["Ship"], focusAreas: [], risks: [], notToDo: [], days: [{ dateKey: "2026-08-25", priorities: ["Verify"] }], notes: "" });
    expect(text).toContain("Outcomes:\n- Ship"); expect(text).toContain("2026-08-25: Verify");
  });
});
