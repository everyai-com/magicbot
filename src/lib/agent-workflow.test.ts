import { describe, expect, it } from "vitest";
import { fallbackWorkflowBrief, nextWorkflowTriggerAt, normalizeAgentWorkflow, normalizeWorkflowTrigger, parseWorkflowReview, readyWorkflowSteps, validateAgentWorkflow, validateWorkflowTrigger, workflowCompletionPrompt, workflowReviewPrompt } from "../../shared/agent-workflow";

describe("agent workflows", () => {
  it("normalizes bounded workflows", () => {
    const input = normalizeAgentWorkflow({ name: " Launch ", goal: "Ship", maxAgentRuns: 99, maxDurationMinutes: 500, steps: [{ id: "research", targetBotId: "a", task: "Find evidence" }, { id: "write", targetBotId: "b", task: "Write", dependsOn: ["research", "research"] }] });
    expect(input.maxAgentRuns).toBe(24); expect(input.maxDurationMinutes).toBe(120);
    expect(input.steps[1].dependsOn).toEqual(["research"]); expect(validateAgentWorkflow(input)).toBeNull();
  });

  it("rejects cycles and undersized run budgets", () => {
    const cyclic = normalizeAgentWorkflow({ name: "x", goal: "y", maxAgentRuns: 2, steps: [{ id: "a", targetBotId: "1", task: "a", dependsOn: ["b"] }, { id: "b", targetBotId: "2", task: "b", dependsOn: ["a"] }] });
    expect(validateAgentWorkflow(cyclic)).toMatch(/cycle/);
    expect(validateAgentWorkflow({ ...cyclic, steps: cyclic.steps.map((step) => ({ ...step, dependsOn: [] })), maxAgentRuns: 1 })).toMatch(/budget/);
  });

  it("only schedules steps whose dependencies completed", () => {
    expect(readyWorkflowSteps([{ id: "a", status: "completed", dependsOn: [] }, { id: "b", status: "pending", dependsOn: ["a"] }, { id: "c", status: "pending", dependsOn: ["b"] }])).toEqual(["b"]);
  });

  it("builds bounded evidence-only completion briefs", () => {
    const steps = [{ targetBotName: "Research", task: "Find facts", result: "Evidence A" }, { targetBotName: "Writer", task: "Draft", result: "Draft B" }];
    const prompt = workflowCompletionPrompt("Make a decision", steps);
    expect(prompt).toContain("Do not use tools"); expect(prompt).toContain("Research"); expect(prompt).toContain("Evidence A");
    expect(fallbackWorkflowBrief("Make a decision", steps)).toContain("Writer: Draft B");
  });

  it("requires a coordinator for acceptance gates and parses strict reviews", () => {
    const gated = normalizeAgentWorkflow({ name: "QA", goal: "Ship", steps: [{ targetBotId: "a", task: "Draft", acceptanceCriteria: "Includes evidence" }] });
    expect(validateAgentWorkflow(gated)).toMatch(/coordinator/);
    const prompt = workflowReviewPrompt("Ship", { targetBotName: "Writer", task: "Draft", expectedOutput: "Memo", acceptanceCriteria: "Includes evidence", result: "Evidence", attempts: 1, maxAttempts: 2 });
    expect(prompt).toContain("Do not use tools"); expect(prompt).toContain("Includes evidence");
    expect(parseWorkflowReview("[ACCEPT] Evidence included")).toEqual({ verdict: "accept", feedback: "Evidence included" });
    expect(parseWorkflowReview("[REVISE: Add a source]")).toEqual({ verdict: "revise", feedback: "Add a source" });
    expect(parseWorkflowReview("looks fine").verdict).toBe("revise");
  });

  it("normalizes and advances durable workflow triggers", () => {
    const once = normalizeWorkflowTrigger({ kind: "once", at: 2_000, utcOffsetMinutes: 9999 });
    expect(once.utcOffsetMinutes).toBe(840);
    expect(validateWorkflowTrigger(once, 1_000)).toBeNull();
    expect(nextWorkflowTriggerAt(once, 1_000)).toBe(2_000);
    expect(validateWorkflowTrigger(once, 3_000)).toMatch(/future/);

    const daily = normalizeWorkflowTrigger({ kind: "daily", time: "09:30", weekdays: [1], utcOffsetMinutes: -330 });
    // Monday 08:00 in UTC+05:30 advances to Monday 09:30 in the same local offset.
    const mondayEight = Date.UTC(2026, 7, 31, 2, 30);
    expect(nextWorkflowTriggerAt(daily, mondayEight)).toBe(Date.UTC(2026, 7, 31, 4, 0));
  });
});
