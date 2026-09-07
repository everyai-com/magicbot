import { describe, expect, it } from "vitest";
import { estimateTextTokens, formatRunDuration, runDurationMs } from "../../shared/run-receipt";

describe("run receipts", () => {
  it("makes token fallback deterministic", () => {
    expect(estimateTextTokens("12345678")).toBe(2);
    expect(estimateTextTokens(" ")).toBe(0);
    expect(estimateTextTokens("😀")).toBe(1);
  });

  it("never returns a negative duration", () => {
    expect(runDurationMs(2_000, 1_000)).toBe(0);
    expect(runDurationMs(1_000, 62_000)).toBe(61_000);
    expect(runDurationMs(undefined, 1_000)).toBeNull();
  });

  it("formats compact durations", () => {
    expect(formatRunDuration(9_700)).toBe("10s");
    expect(formatRunDuration(61_000)).toBe("1m 1s");
    expect(formatRunDuration(null)).toBe("Not reported");
  });
});
