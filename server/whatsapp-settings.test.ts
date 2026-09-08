import { expect, it, vi } from "vitest";
import { whatsappSettings } from "./whatsapp-settings.ts";
it("loads the shared account settings in the UI format", async () => {
 const call=vi.fn(async (path:string)=>path.endsWith("/api")?{meta_access_token:"test",meta_phone_number_id:"p",meta_business_account_id:"b"}:null);
 const result=await whatsappSettings("GET","/api/whatsapp/configs",{},"Bearer account",call);
 expect(result?.body).toMatchObject({api:{configured:true,phone_number_id:"p"},webhook:{}});
 expect(call.mock.calls).toHaveLength(3);
});
it("turns provider validation failure into an error response",async()=>{
 const result=await whatsappSettings("POST","/api/whatsapp/configs/validate",{},"Bearer account",vi.fn().mockResolvedValue({valid:false,error:"Invalid token"}));
 expect(result?.status).toBe(400);
});
it("preserves an existing token when saving other settings",async()=>{
 const call=vi.fn().mockResolvedValue({meta_access_token:"saved-token"});
 await whatsappSettings("POST","/api/whatsapp/configs/api",{meta_access_token:"",meta_phone_number_id:"p"},"Bearer account",call);
 expect(call).toHaveBeenCalledWith("/api/whatsapp/configs/api",expect.objectContaining({method:"POST",body:expect.objectContaining({meta_access_token:"saved-token",meta_phone_number_id:"p"})}));
});
it("requires account authorization before reading shared settings",async()=>{
 const call=vi.fn();
 expect((await whatsappSettings("GET","/api/whatsapp/configs",{},undefined,call))?.status).toBe(401);
 expect(call).not.toHaveBeenCalled();
});
