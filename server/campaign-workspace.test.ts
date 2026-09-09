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
  expect(campaignWorkspaceRoute("DELETE", "campaigns/123")).toBe("/api/campaigns/123");
  expect(campaignWorkspaceRoute("DELETE", "campaigns")).toBeNull();
});

it("allows linking campaign phone numbers without exposing arbitrary writes", () => {
  expect(campaignWorkspaceRoute("PUT", "campaign-configs/phone-configs")).toBe("/api/campaign-configs/phone-configs");
  expect(campaignWorkspaceRoute("PUT", "phone-configs")).toBeNull();
  expect(campaignWorkspaceRoute("PUT", "campaign-configs/other")).toBeNull();
});

it("allows editing a contact but rejects bulk and arbitrary contact updates", () => {
 expect(campaignWorkspaceRoute("PATCH", "contacts/contact_1")).toBe("/api/contacts/contact_1");
 expect(campaignWorkspaceRoute("PATCH", "contacts")).toBeNull();
 expect(campaignWorkspaceRoute("PATCH", "contacts/../../users")).toBeNull();
});

it("allows deleting an individual SMS campaign without permitting bulk or unrelated deletes", () => {
  expect(campaignWorkspaceRoute("DELETE", "messaging/sms-campaigns/campaign_123-abc")).toBe("/api/messaging/sms-campaigns/campaign_123-abc");
  for (const path of ["messaging/sms-campaigns", "messaging/sms-templates/template_1", "messaging/sms-campaigns/id/start", "messaging/sms-campaigns/../../users", "messaging/sms-campaigns/id?user_id=other"]) {
    expect(campaignWorkspaceRoute("DELETE", path)).toBeNull();
  }
});

it("allows individual Gmail template deletion and preserves template creation and editing", () => {
  expect(campaignWorkspaceRoute("POST", "messaging/gmail-templates")).toBe("/api/messaging/gmail-templates");
  expect(campaignWorkspaceRoute("DELETE", "messaging/gmail-templates/template_1")).toBe("/api/messaging/gmail-templates/template_1");
  expect(campaignWorkspaceRoute("DELETE", "messaging/gmail-templates")).toBeNull();
  expect(campaignWorkspaceRoute("DELETE", "messaging/gmail-templates/../../users")).toBeNull();
});

it("permits contact-saving routes for all four campaign channels", () => {
  for (const path of ["contacts/contact_1", "messaging/sms-campaigns/campaign_1", "messaging/gmail-campaigns/campaign_1", "whatsapp/campaigns/campaign_1"]) {
    expect(campaignWorkspaceRoute("PATCH", path)).toBe("/api/" + path);
    expect(campaignWorkspaceRoute("PATCH", path + "/../../users")).toBeNull();
  }
  for (const path of ["whatsapp/contacts/bulk", "whatsapp/audiences"]) {
    expect(campaignWorkspaceRoute("POST", path)).toBe("/api/" + path);
  }
});

it('allows reading the signed-in balance but rejects balance writes', () => {
  expect(campaignWorkspaceRoute('GET', 'billing/balance')).toBe('/api/billing/balance');
  expect(campaignWorkspaceRoute('POST', 'billing/balance')).toBeNull();
});
