import { describe, expect, it } from "vitest";
import { normalizeDueAt, normalizePriorityTitle, priorityRow } from "../../shared/today";

describe("today command center", () => {
  it("bounds and cleans actionable priority titles", () => {
    expect(normalizePriorityTitle("  Ship   the web app\u0000 ")).toBe("Ship the web app");
    expect(normalizePriorityTitle("x".repeat(300))).toHaveLength(240);
  });

  it("accepts only positive integer due dates", () => {
    expect(normalizeDueAt(1_800_000_000_000)).toBe(1_800_000_000_000);
    expect(normalizeDueAt(-1)).toBeNull();
    expect(normalizeDueAt("tomorrow")).toBeNull();
  });

  it("maps database rows into the public contract", () => {
    expect(priorityRow({ id: "p", title: "Act", status: "done", rank: 2, due_at: null, source: "agent", created_at: 1, updated_at: 2, completed_at: 2 }))
      .toMatchObject({ id: "p", title: "Act", status: "done", source: "agent", completedAt: 2 });
  });
});
