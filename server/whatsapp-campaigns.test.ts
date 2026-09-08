import { expect, it, vi } from 'vitest';
import { WhatsappCampaigns, whatsappPayload } from './whatsapp-campaigns.ts';
const template = { name: 'welcome', language: 'en_US', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi {{name}}, {{order}}' }] };
const contact = { id: 'one', name: 'Sam', phone_number: '+15551234567', metadata: { order: '123' } };
function setup(status = 'APPROVED', send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] })))) {
 const service = new WhatsappCampaigns(':memory:', send);
 const call = vi.fn(async (path: string) => {
  if (path.endsWith('/safety-settings')) return {};
  if (path.endsWith('/do-not-call')) return [];
  if (path.endsWith('/campaigns')) return [{ id: 'c', audience_id: 'a', template_id: 't' }];
  if (path.endsWith('/templates')) return [{ id: 't', name: 'welcome', language: 'en_US' }];
  if (path.includes('/templates/details?')) return { raw: { ...template, status } };
  if (path.endsWith('/audiences')) return [{ id: 'a' }];
  if (path.endsWith('/audiences/a/contacts')) return ['one', 'two'];
  if (path.endsWith('/contacts')) return [contact, { ...contact, id: 'two', phone_number: '+15557654321' }];
  if (path.endsWith('/configs/api')) return { meta_access_token: 'test', meta_phone_number_id: '123' };
  if (path.endsWith('/conversations')) return { id: 'conv' };
  if (path.endsWith('/conversations/conv/messages')) return [{ provider_message_id: 'wamid.1', status: 'read' }];
  if (path.endsWith('/messages')) return { id: 'm' };
  throw new Error(path);
 });
 return { service, call, send };
}
it('renders metadata and named parameters without sending text fallback', () => {
 const result = whatsappPayload(template, contact);
 expect(result.type).toBe('template');
 expect(result.template.components[0].parameters).toEqual([{type:'text',text:'Sam',parameter_name:'name'},{type:'text',text:'123',parameter_name:'order'}]);
 expect(() => whatsappPayload(template, {...contact,metadata:{}})).toThrow('order');
});
it('supports positional mappings, media and dynamic URLs', () => {
 const t = {...template,components:[{type:'HEADER',format:'IMAGE'},{type:'BODY',text:'{{1}}'},{type:'BUTTONS',buttons:[{type:'URL',url:'https://example.com/{{1}}'}]}]};
 const result = whatsappPayload(t,{...contact,media:'https://example.com/a.png'},{'1':'name',header_media_url:'media'});
 expect(result.template.components[0].parameters[0].image.link).toBe('https://example.com/a.png');
 expect(result.template.components[2].parameters[0].text).toBe('Sam');
});
it('rejects unapproved templates before sending', async () => {
 const {service,call,send}=setup('PENDING');
 await expect(service.handle('/api/whatsapp/campaigns/c/start','POST',{},call)).rejects.toThrow('approved');
 expect(send).not.toHaveBeenCalled();
});
it('sends only selected members, saves chat records, reconciles receipts and blocks duplicates', async () => {
 const {service,call,send}=setup();
 await service.handle('/api/whatsapp/campaigns/c/start','POST',{selected_contact_ids:['two']},call);
 await vi.waitFor(async()=>expect((await service.handle('/api/whatsapp/campaigns','GET',{},call))[0].status).toBe('completed'));
 expect(send).toHaveBeenCalledTimes(1);
 expect(JSON.parse(String(send.mock.calls[0][1]?.body)).to).toBe('15557654321');
 const result=await service.handle('/api/whatsapp/campaigns/c','GET',{},call);
 expect(result.outcomes[0].status).toBe('read');
 expect(result.read_count).toBe(1);
 await expect(service.handle('/api/whatsapp/campaigns/c/start','POST',{},call)).rejects.toThrow('already has a run');
 expect(await service.handle('/api/whatsapp/campaigns','GET',{},async()=>[])).toEqual([]);
});
it('rejects foreign recipients and campaigns', async()=>{
 const {service,call,send}=setup();
 await expect(service.handle('/api/whatsapp/campaigns/c/start','POST',{selected_contact_ids:['foreign']},call)).rejects.toThrow('not in this audience');
 await expect(service.handle('/api/whatsapp/campaigns/foreign/start','POST',{},call)).rejects.toThrow('not found');
 expect(send).not.toHaveBeenCalled();
});
it('records uncertain transport failures without retrying', async()=>{
 const send=vi.fn<typeof fetch>().mockRejectedValue(new Error('timeout'));
 const {service,call}=setup('APPROVED',send);
 await service.handle('/api/whatsapp/campaigns/c/start','POST',{selected_contact_ids:['one']},call);
 await vi.waitFor(async()=>expect((await service.handle('/api/whatsapp/campaigns','GET',{},call))[0].status).toBe('interrupted'));
 expect(send).toHaveBeenCalledTimes(1);
});
