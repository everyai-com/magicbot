import { describe, expect, it } from "vitest";
import { normalizeSessionCloseout, renderCarryForward } from "../../shared/session-closeout";

describe("session closeout", () => {
  it("normalizes bounded structured closeout input", () => {
    const result = normalizeSessionCloseout({ outcome: "  Shipped web  ", decisions: ["Use D1", "Use D1", ""], openLoops: ["Verify mobile"] });
    expect(result).toMatchObject({ outcome: "Shipped web", decisions: ["Use D1"], openLoops: ["Verify mobile"], createNext: true, promoteOpenLoops: true });
  });

  it("renders a compact handoff without copying transcript history", () => {
    const handoff = renderCarryForward("Launch", { outcome: "Deployed", decisions: ["Keep Cloudflare"], openLoops: ["Watch errors"] });
    expect(handoff).toContain("Previous task: Launch");
    expect(handoff).toContain("Outcome:\nDeployed");
    expect(handoff).toContain("Open loops:\n- Watch errors");
  });
});
