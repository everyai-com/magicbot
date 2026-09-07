import { describe, expect, it } from "vitest";
import { extractContextObservations, normalizeObservationCorrection, observationKey } from "../../shared/context-observation";

describe("observed context", () => {
  it("extracts useful claims but leaves them pending for review", () => {
    expect(extractContextObservations("Riya is my manager. I usually send her a short update on Fridays.")).toEqual([
      expect.objectContaining({ kind: "relationship", text: "Riya is my manager." }),
      expect.objectContaining({ kind: "habit", text: "I usually send her a short update on Fridays." }),
    ]);
    expect(extractContextObservations("Asha is my advisor.")).toEqual([
      expect.objectContaining({ kind: "relationship", text: "Asha is my advisor." }),
    ]);
  });

  it("does not duplicate explicit memory commands", () => {
    expect(extractContextObservations("Remember that I prefer concise replies.")).toEqual([]);
    expect(extractContextObservations("I prefer concise replies.")).toEqual([]);
  });

  it("normalizes corrections and multilingual keys safely", () => {
    expect(normalizeObservationCorrection("  Riya   is my design lead.  ")).toBe("Riya is my design lead.");
    expect(observationKey("  José — Cliente  ")).toBe("josé cliente");
  });
});
