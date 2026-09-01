import { describe, expect, it } from "vitest";
import { challengePrompt, normalizeDecision, renderDecisionContext } from "../../shared/decision-journal";
describe("decision journal", () => {
  it("normalizes bounded decision fields", () => { const item = normalizeDecision({ question: " Choose? ", options: ["A", "A", "B"], assumptions: ["Demand"], confidence: 130, status: "decided", reviewAt: 123 }); expect(item).toMatchObject({ question: "Choose?", options: ["A", "B"], assumptions: ["Demand"], confidence: 100, status: "decided", reviewAt: 123 }); });
  it("renders only committed decisions into shared context", () => { const decided = normalizeDecision({ question: "Ship?", choice: "Yes", rationale: "Validated", status: "decided" }); const exploring = normalizeDecision({ question: "Hire?", status: "exploring" }); const text = renderDecisionContext([{ ...decided }, { ...exploring }]); expect(text).toContain("Decision: Ship?"); expect(text).not.toContain("Hire?"); });
  it("builds a concrete adversarial prompt", () => { const prompt = challengePrompt(normalizeDecision({ question: "Launch?", options: ["Now", "Later"], assumptions: ["Ready"], choice: "Now" })); expect(prompt).toContain("Strongest opposing case"); expect(prompt).toContain("Leading choice: Now"); });
});
