import {it,expect,vi} from "vitest";
import {accountConnectors} from "./account-connectors.ts";
it("uses the shared Composio catalog including auth configuration",async()=>{
 const call=vi.fn().mockResolvedValue({items:[{slug:"gmail",name:"Gmail",authConfigId:"ac_example"}]});
 const result=await accountConnectors(new Request("https://bots.magicteams.ai/api/connectors/catalog"),"Bearer user",call);
 expect(await result!.json()).toMatchObject({source:"api",cards:[{slug:"gmail",authConfigId:"ac_example"}]});
});
it("returns OAuth to the production domain",async()=>{
 const call=vi.fn().mockResolvedValue({redirectUrl:"https://example.com/oauth"});
 await accountConnectors(new Request("https://bots.magicteams.ai/api/connectors/gmail/authorize",{method:"POST",body:'{"authConfigId":"ac_example"}'}),"Bearer user",call);
 expect(call).toHaveBeenCalledWith("/api/composio/connect",expect.objectContaining({body:expect.objectContaining({callbackUrl:"https://bots.magicteams.ai",toolkit:"gmail",authConfigId:"ac_example"})}));
});
it("does not substitute an old catalog after a backend failure",async()=>{
 await expect(accountConnectors(new Request("https://bots.magicteams.ai/api/connectors/catalog"),"Bearer user",vi.fn().mockRejectedValue(new Error("unavailable")))).rejects.toThrow("unavailable");
});
it("reads current user connections without waiting for or merging a stale catalog",async()=>{
 const call=vi.fn().mockResolvedValue({items:[]});
 const response=await accountConnectors(new Request("https://bots.magicteams.ai/api/connectors/connected"),"Bearer user-a",call);
 expect(await response!.json()).toEqual({configured:true,services:{}});
 expect(call).toHaveBeenCalledTimes(1);
 expect(call).toHaveBeenCalledWith("/api/composio/connections",{authorization:"Bearer user-a"});
});
it("passes the signed-in user's authorization to disconnect",async()=>{
 const call=vi.fn().mockResolvedValue({});
 await accountConnectors(new Request("https://bots.magicteams.ai/api/connectors/gmail/accounts/ca_123",{method:"DELETE"}),"Bearer user-b",call);
 expect(call).toHaveBeenCalledWith("/api/composio/connections/ca_123",{method:"DELETE",authorization:"Bearer user-b"});
});
