import { z } from 'zod';
type Call = (path: string, options?: {method?: string;body?: unknown}) => Promise<any>;
export async function whatsappTemplateAction(action: string, body: Record<string,unknown>, call: Call, fetcher: typeof fetch = fetch) {
 const input=z.object({templateId:z.string().min(1),components:z.array(z.record(z.string(),z.unknown())).min(1).optional()}).parse(body);
 const templates=z.array(z.record(z.string(),z.any())).parse(await call('/api/whatsapp/templates'));
 const owned=templates.find(t=>String(t.id??t._id)===input.templateId);
 if(!owned)throw new Error('Template not found in your account.');
 if(action==='delete')return call('/api/whatsapp/templates/delete',{method:'POST',body:{templateId:input.templateId,templateName:owned.normalized_name??owned.name,metaTemplateId:owned.meta_template_id,language:owned.language}});
 if(!input.components)throw new Error('Template components are required.');
 if(!/^\d+$/.test(String(owned.meta_template_id??'')))throw new Error('This template has no Meta ID. Sync the template before editing.');
 const config=await call('/api/whatsapp/configs/api');
 if(!config?.meta_access_token)throw new Error('Connect WhatsApp API credentials before editing.');
 const response=await fetcher(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION??'v23.0'}/${owned.meta_template_id}`,{method:'POST',headers:{Authorization:`Bearer ${config.meta_access_token}`,'Content-Type':'application/json'},body:JSON.stringify({components:input.components}),signal:AbortSignal.timeout(30000)});
 const result=await response.json() as {success?:boolean;error?:{message?:string}};
 if(!response.ok||result.success!==true)throw new Error(result.error?.message??'Meta did not confirm the template update.');
 try { const sync=await call('/api/whatsapp/templates/sync',{method:'POST',body:{}});if(sync?.success===false)throw new Error('Sync failed'); } catch { return {success:true,warning:'Saved to Meta, but the local template list could not be synchronized.'}; }
 return {success:true};
}
