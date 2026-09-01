import { describe, expect, it } from "vitest";
import { extractCommitmentSuggestion, normalizeCommitmentDueAt } from "../../shared/commitment";

describe("relationship commitments", () => {
  const now = Date.UTC(2026, 7, 30, 12);

  it("captures promises I make without activating them", () => {
    expect(extractCommitmentSuggestion("I'll send the proposal tomorrow.", true, now)).toEqual({
      direction: "mine", kind: "promise", text: "I'll send the proposal tomorrow.", confidence: 0.86, suggestedDueAt: now + 86_400_000,
    });
  });

  it("captures direct requests and promises from the other person", () => {
    expect(extractCommitmentSuggestion("Could you review the deck today?", false, now)).toMatchObject({ direction: "mine", kind: "request" });
    expect(extractCommitmentSuggestion("I will confirm the venue tomorrow", false, now)).toMatchObject({ direction: "theirs", kind: "promise" });
  });

  it("ignores uncertain statements and normal conversation", () => {
    expect(extractCommitmentSuggestion("I might send it later", true, now)).toBeNull();
    expect(extractCommitmentSuggestion("That looks great", false, now)).toBeNull();
  });

  it("normalizes optional due dates", () => {
    expect(normalizeCommitmentDueAt("1788100000000")).toBe(1_788_100_000_000);
    expect(normalizeCommitmentDueAt("")).toBeNull();
  });
});
