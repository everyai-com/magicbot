import { describe, expect, it } from "vitest";
import { normalizeDateKey, normalizeDayCloseout, normalizeDayRange, renderDayCloseout } from "../../shared/day-closeout";

describe("day closeout", () => {
  it("normalizes bounded, unique structured reflection", () => {
    expect(normalizeDayCloseout({ dateKey: "2026-08-30", wins: [" Shipped  ", "Shipped"], lessons: ["Keep scope tight"], tomorrowPriorities: ["Verify prod"], notes: "  Good day  " })).toEqual({
      dateKey: "2026-08-30", wins: ["Shipped"], lessons: ["Keep scope tight"], tomorrowPriorities: ["Verify prod"], notes: "Good day",
    });
  });
  it("rejects invalid dates and unsafe aggregation windows", () => {
    expect(normalizeDateKey("2026-02-30")).toBe("");
    const start = Date.now() - 12 * 60 * 60_000;
    expect(normalizeDayRange(start, start + 24 * 60 * 60_000)).not.toBeNull();
    expect(normalizeDayRange(start, start + 2 * 60 * 60_000)).toBeNull();
  });
  it("renders compact context for the next day", () => {
    const text = renderDayCloseout({ dateKey: "2026-08-30", wins: ["Deployed"], lessons: [], tomorrowPriorities: ["Measure"], notes: "" });
    expect(text).toContain("Wins:\n- Deployed");
    expect(text).toContain("Next priorities:\n- Measure");
  });
});
