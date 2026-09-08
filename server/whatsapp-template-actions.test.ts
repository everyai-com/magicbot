import { expect,it,vi } from 'vitest';
import { whatsappTemplateAction } from './whatsapp-template-actions.ts';
const owned={id:'local',meta_template_id:'123',normalized_name:'welcome',language:'en_US'};
it('rejects foreign templates before contacting Meta',async()=>{
 const send=vi.fn();
 await expect(whatsappTemplateAction('edit',{templateId:'other',components:[{type:'BODY',text:'Hello'}]},async()=>[owned],send)).rejects.toThrow('not found');
 expect(send).not.toHaveBeenCalled();
});
it('edits the owned Meta ID and syncs only after confirmation',async()=>{
 const call=vi.fn(async(path:string)=>path.endsWith('/templates')?[owned]:path.endsWith('/api')?{meta_access_token:'test'}:{success:true});
 const send=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({success:true})));
 await whatsappTemplateAction('edit',{templateId:'local',meta_template_id:'999',components:[{type:'BODY',text:'Hello'}]},call,send);
 expect(send.mock.calls[0][0]).toContain('/123');
 expect(call).toHaveBeenCalledWith('/api/whatsapp/templates/sync',{method:'POST',body:{}});
});
it('reports Meta rejection without syncing',async()=>{
 const call=vi.fn(async(path:string)=>path.endsWith('/templates')?[owned]:{meta_access_token:'test'});
 const send=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({error:{message:'Edit not allowed'}}),{status:400}));
 await expect(whatsappTemplateAction('edit',{templateId:'local',components:[{type:'BODY'}]},call,send)).rejects.toThrow('Edit not allowed');
 expect(call).toHaveBeenCalledTimes(2);
});
it('deletes using owned identity instead of browser supplied name',async()=>{
 const call=vi.fn(async(path:string)=>path.endsWith('/templates')?[owned]:{success:true});
 await whatsappTemplateAction('delete',{templateId:'local',templateName:'foreign'},call);
 expect(call).toHaveBeenLastCalledWith('/api/whatsapp/templates/delete',{method:'POST',body:{templateId:'local',templateName:'welcome',metaTemplateId:'123',language:'en_US'}});
});
