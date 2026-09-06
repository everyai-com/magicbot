import { describe, expect, it } from "vitest";
import { normalizeOperatingProfile, renderOperatingProfile } from "../../shared/operating-profile";

describe("operating profile", () => {
  it("normalizes, deduplicates, and bounds user-entered fields", () => {
    const profile = normalizeOperatingProfile({ roles: ["Founder", "Founder", ""], priorities: ["Ship web"], timezone: " Asia/Kolkata " });
    expect(profile.roles).toEqual(["Founder"]);
    expect(profile.priorities).toEqual(["Ship web"]);
    expect(profile.timezone).toBe("Asia/Kolkata");
  });

  it("renders only populated fields as compact model context", () => {
    const text = renderOperatingProfile(normalizeOperatingProfile({ roles: ["Founder"], boundaries: ["Ask before sending messages"] }));
    expect(text).toContain("Roles: Founder");
    expect(text).toContain("Boundaries: Ask before sending messages");
    expect(text).not.toContain("Working style:");
  });
});
