import { describe, expect, it } from "vitest";
import { delegationPrompt, normalizeDelegationInput, parseDelegationCommand, parseDelegationMarker, stripDelegationMarker } from "../../shared/delegation";

describe("delegation contract", () => {
  it("bounds and normalizes a handoff", () => {
    const input = normalizeDelegationInput({ sourceBotId: " source ", targetBotId: " target ", task: ` do it \u0000${"x".repeat(5_000)}`, context: " facts ", expectedOutput: " memo " });
    expect(input.sourceBotId).toBe("source"); expect(input.targetBotId).toBe("target"); expect(input.task.length).toBe(4_000); expect(input.context).toBe("facts");
  });
  it("makes governance and expected output explicit", () => {
    const prompt = delegationPrompt({ task: "Analyze it", context: "Verified input", expectedOutput: "Decision memo" }, "Lena");
    expect(prompt).toContain("Delegated by: Lena"); expect(prompt).toContain("Decision memo"); expect(prompt).toContain("approval-gated");
  });
  it("parses one bounded control marker and strips it from display", () => {
    const reply = "I will ask the researcher.\n\n[DELEGATE: Sam | Verify the three primary sources]";
    expect(parseDelegationMarker(reply)).toEqual({ targetName: "Sam", task: "Verify the three primary sources" });
    expect(stripDelegationMarker(reply)).toBe("I will ask the researcher.");
    expect(parseDelegationMarker("[DELEGATE: Sam | ]")).toBeNull();
  });
  it("supports an unambiguous user delegation command", () => {
    expect(parseDelegationCommand("/delegate Max | Return a verified release checklist")).toEqual({ targetName: "Max", task: "Return a verified release checklist" });
    expect(parseDelegationCommand("delegate Max please")).toBeNull();
  });
});
