import { expect, it } from "vitest";
import { campaignWorkspaceRoute } from "./campaign-workspace.ts";
it("allows the four campaign channels and read-only configuration", () => {
  for (const path of ["campaigns", "messaging/sms-campaigns", "messaging/gmail-campaigns", "whatsapp/campaigns"]) {
    expect(campaignWorkspaceRoute("GET", path)).toBe("/api/" + path);
    expect(campaignWorkspaceRoute("POST", path)).toBe("/api/" + path);
  }
  expect(campaignWorkspaceRoute("GET", "phone-configs")).toBe("/api/phone-configs");
  expect(campaignWorkspaceRoute("POST", "phone-configs")).toBeNull();
});
it("rejects arbitrary paths, credentials routes, traversal and deletes", () => {
  for (const path of ["../config", "campaigns/../../config", "https://evil.com", "config", "users", "campaigns?user_id=other"]) {
    expect(campaignWorkspaceRoute("GET", path)).toBeNull();
  }
  expect(campaignWorkspaceRoute("DELETE", "campaigns/123")).toBeNull();
});
