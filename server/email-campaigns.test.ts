import { expect, it, vi } from "vitest";
import { EmailCampaigns, emailSendResult } from "./email-campaigns.ts";
it("sends personalized email through Composio and keeps owner-scoped outcomes", async () => {
 const service = new EmailCampaigns(":memory:");
 const call = vi.fn(async (path: string) => {
  if (path === "/api/messaging/gmail-campaigns") return [{id:"c1",extracted_contacts:[{name:"Sam",email:"sam@example.com"}]}];
  if (path === "/api/messaging/gmail-templates") return [{id:"t1",message:JSON.stringify({to:"<<email>>",subject:"Hi <<name>>",body:"Welcome <<name>>"})}];
  if (path === "/api/composio/connections") return {items:[{id:"ca_1",slug:"gmail",status:"ACTIVE"}]};
  if (path === "/api/composio/execute") return {ok:true,result:{successful:true,data:{id:"m1"}}};
  if (path.endsWith("/completed")) return [];
  throw new Error("Unexpected call " + path);
 });
 await service.handle("/start","POST",{campaign_id:"c1",template_id:"t1",selected_contact_indexes:[0],delay_seconds:0},call);
 await vi.waitFor(async () => {
  const runs = await service.handle("/completed","GET",null,call) as any[];
  expect(runs[0].status).toBe("completed"); expect(runs[0].outcomes[0].provider_message_id).toBe("m1");
 });
 expect(call).toHaveBeenCalledWith("/api/composio/execute",expect.objectContaining({body:expect.objectContaining({tool:"GMAIL_SEND_EMAIL",arguments:expect.objectContaining({recipient_email:"sam@example.com",subject:"Hi Sam",body:"Welcome Sam"})})}));
 expect(await service.handle("/completed","GET",null,async()=>[])).toEqual([]);
});
it("rejects campaigns outside the authenticated user's list",async()=>{
 const service=new EmailCampaigns(":memory:");
 await expect(service.handle("/start","POST",{campaign_id:"other",template_id:"t",selected_contact_indexes:[0]},async()=>[])).rejects.toThrow("not found in your account");
});
it("does not treat failed or unconfirmed provider responses as sent",()=>{
 expect(()=>emailSendResult({ok:true,result:{successful:false,error:"reconnect"}})).toThrow("reconnect");
 expect(()=>emailSendResult({ok:true,result:{successful:true,data:{}}})).toThrow("No Gmail message ID");
});
