import { describe, expect, it } from "vitest";
import { decideAutonomy, legacyWhatsAppMode } from "../../shared/autonomy";

describe("decideAutonomy", () => {
  it("allows reads but no writing in observe mode", () => {
    expect(decideAutonomy({ mode: "observe" }, { action: "search", risk: "read", unattended: true }).verdict).toBe("allow");
    expect(decideAutonomy({ mode: "observe" }, { action: "send", risk: "external", unattended: false }).verdict).toBe("deny");
  });

  it("keeps drafts reviewable", () => {
    expect(decideAutonomy({ mode: "draft" }, { action: "reply", risk: "external", unattended: true }).verdict).toBe("draft");
  });

  it("never auto-approves sensitive or destructive actions", () => {
    expect(decideAutonomy({ mode: "act" }, { action: "send otp", risk: "sensitive", unattended: true }).verdict).toBe("ask");
    expect(decideAutonomy({ mode: "act" }, { action: "delete", risk: "destructive", unattended: false }).verdict).toBe("ask");
  });

  it("enforces action rate limits", () => {
    expect(decideAutonomy(
      { mode: "act", maxPerHour: 5, maxPerDay: 30 },
      { action: "reply", risk: "external", unattended: true, countLastHour: 5, countLastDay: 10 },
    ).verdict).toBe("ask");
  });

  it("maps legacy WhatsApp settings without widening authority", () => {
    expect(legacyWhatsAppMode("off")).toBe("observe");
    expect(legacyWhatsAppMode("draft")).toBe("draft");
    expect(legacyWhatsAppMode("autonomous")).toBe("act");
  });
});
