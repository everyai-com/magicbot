import { describe, it, expect, vi } from "vitest";
import { platformResources } from "../cloudflare/web/src/platform-resources.ts";
describe("hosted platform resources", () => {
  it("wraps phone configuration responses for the UI", async () => {
    const upstream = vi.fn().mockResolvedValue([{ id: "phone-1" }]);
    const response = await platformResources(new Request("https://app.test/api/platform/phone-configs"), "/api/platform/phone-configs", "Bearer test", "", upstream);
    expect(await response!.json()).toEqual({ phoneConfigs: [{ id: "phone-1" }] });
    expect(upstream).toHaveBeenCalledWith("/api/phone-configs?activeOnly=false&channel=voice", { authorization: "Bearer test" });
  });
  it("reports forwarding sync failure after saving", async () => {
    const upstream = vi.fn().mockResolvedValueOnce({ id: "agent-1" }).mockResolvedValueOnce({ id: "forward-1" }).mockRejectedValueOnce(new Error("Provider unavailable"));
    const path = "/api/platform/agents/agent-1/call-forwarding";
    const response = await platformResources(new Request("https://app.test"+path, {method:"POST", body:JSON.stringify({phone_number:"+15555550123"})}), path, "Bearer test", "", upstream);
    expect(await response!.json()).toMatchObject({forwardingNumber:{id:"forward-1"},syncError:"Provider unavailable"});
  });
  it("checks agent access before modifying resources", async () => {
    const upstream = vi.fn().mockRejectedValue(new Error("Forbidden"));
    const path = "/api/platform/agents/other/appointment-tools/item";
    await expect(platformResources(new Request("https://app.test"+path,{method:"DELETE"}), path, "Bearer test", "", upstream)).rejects.toThrow("Forbidden");
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it("leaves unrelated routes to their existing handlers", async () => {
    expect(await platformResources(new Request("https://app.test/"), "/api/platform/unknown", "Bearer test", "", vi.fn())).toBeNull();
  });
});
