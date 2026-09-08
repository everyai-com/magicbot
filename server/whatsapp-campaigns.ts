import { chmodSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
const record = z.record(z.string(), z.any());
type Row = z.infer<typeof record>;
type Call = (path: string, options?: { method?: string; body?: unknown }) => Promise<any>;
const rows = z.array(record);
const id = (r: Row) => String(r.id ?? r._id ?? '');
const parse = (v: any) => typeof v === 'string' ? JSON.parse(v) : v;
const root = '/api/whatsapp';

export function whatsappPayload(template: Row, rawContact: Row, bindings: Row = {}): Row {
  const contact = { ...parse(rawContact.metadata ?? {}), ...rawContact };
  contact.name ??= contact.first_name;
  contact.phone_number ??= contact.phone;
  const phone = String(contact.phone_number ?? '').replace(/[\s()+-]/g, '');
  if (!/^[1-9]\d{7,14}$/.test(phone)) throw new Error('A valid international phone number is required.');
  const value = (key: string) => {
    const field = bindings[key] ?? key;
    const result = contact[field];
    if (result == null || String(result).trim() === '') throw new Error(`Missing contact field: ${field}`);
    return String(result);
  };
  const parameters = (text: string) => [...new Set([...text.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map(m => m[1]))].map(key => ({ type: 'text', text: value(key), ...(/^\d+$/.test(key) ? {} : { parameter_name: key }) }));
  const components: Row[] = [];
  for (const c of rows.parse(template.components)) {
    const type = String(c.type).toLowerCase();
    if (type === 'body' || (type === 'header' && (!c.format || c.format === 'TEXT'))) {
      const p = parameters(String(c.text ?? ''));
      if (p.length) components.push({ type, parameters: p });
    } else if (type === 'header') {
      const media = String(c.format).toLowerCase();
      if (!['image', 'video', 'document'].includes(media)) throw new Error(`Unsupported header: ${media}`);
      const link = value('header_media_url');
      if (!link.startsWith('https://')) throw new Error('Header media must use HTTPS.');
      components.push({ type, parameters: [{ type: media, [media]: { link } }] });
    } else if (type === 'buttons') {
      for (const [index, button] of rows.parse(c.buttons).entries()) {
        const p = parameters(String(button.url ?? ''));
        if (p.length) components.push({ type: 'button', sub_type: 'url', index: String(index), parameters: p.map(({ text }) => ({ type: 'text', text })) });
        else if (!['URL', 'PHONE_NUMBER', 'QUICK_REPLY'].includes(button.type)) throw new Error(`Unsupported button: ${button.type}`);
      }
    } else if (type !== 'footer') throw new Error(`Unsupported template component: ${type}`);
  }
  return { messaging_product: 'whatsapp', to: phone, type: 'template', template: { name: template.name, language: { code: template.language }, components } };
}

export class WhatsappCampaigns {
  private db: DatabaseSync;
  private locks = new Set<string>();
  constructor(path: string, privateFetch: typeof fetch = fetch) {
    this.sendFetch = privateFetch;
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS wa_runs (campaign_id TEXT PRIMARY KEY, data TEXT NOT NULL)");
    for (const row of this.db.prepare('SELECT * FROM wa_runs').all()) {
      const run = JSON.parse(String(row.data));
      if (run.status === 'active') { run.status = 'interrupted'; this.save(run); }
    }
  }
  private sendFetch: typeof fetch;
  private save(run: Row) { this.db.prepare('INSERT OR REPLACE INTO wa_runs VALUES (?,?)').run(run.id, JSON.stringify(run)); }
  private get(cid: string): Row | undefined { const row = this.db.prepare('SELECT data FROM wa_runs WHERE campaign_id=?').get(cid); return row ? JSON.parse(String(row.data)) : undefined; }
  async handle(path: string, method: string, body: Row, call: Call): Promise<any> {
    const campaigns = rows.parse(await call(root + '/campaigns'));
    if (method === 'GET') {
      const merge = (campaign: Row) => ({ ...campaign, ...this.get(id(campaign)) });
      if (path === root + '/campaigns') return campaigns.map(merge);
      const campaign = campaigns.find(r => id(r) === path.split('/').at(-1));
      if (!campaign) throw new Error('Campaign not found in your account.');
      const run = this.get(id(campaign));
      if (run && run.status !== 'active') {
        // Existing platform webhooks update chat message receipts. Pull those authenticated receipts into outcomes.
        for (const outcome of run.outcomes) {
          if (!outcome.conversation_id || !outcome.provider_message_id) continue;
          try {
            const messages = rows.parse(await call(`${root}/conversations/${encodeURIComponent(outcome.conversation_id)}/messages`));
            const message = messages.find(m => m.provider_message_id === outcome.provider_message_id);
            if (message && ['delivered', 'read', 'failed'].includes(message.status)) outcome.status = message.status;
          } catch { /* Preserve the last confirmed status if receipts are unavailable. */ }
        }
        run.delivered = run.outcomes.filter((o: Row) => ['delivered','read'].includes(o.status)).length;
        run.read_count = run.outcomes.filter((o: Row) => o.status === 'read').length;
        this.save(run);
      }
      return merge(campaign);
    }
    const cid = path.split('/').at(-2)!;
    const campaign = campaigns.find(r => id(r) === cid);
    if (!campaign) throw new Error('Campaign not found in your account.');
    if (this.locks.has(cid)) throw new Error('Campaign is already sending.');
    this.locks.add(cid);
    try {
      if (this.get(cid)) throw new Error('This campaign already has a run. Create a new campaign to avoid duplicate messages.');
      const templateId = String(body.template_id ?? campaign.template_id ?? '');
      const template = rows.parse(await call(root + '/templates')).find(r => id(r) === templateId);
      if (!template) throw new Error('Template not found in your account.');
      const details = await call(`${root}/templates/details?template_name=${encodeURIComponent(template.normalized_name ?? template.name)}&language=${encodeURIComponent(template.language)}`);
      const canonical = record.parse(details.raw);
      if (canonical.status !== 'APPROVED' || canonical.language !== template.language) throw new Error('The selected template language must be approved by Meta.');
      const audience = rows.parse(await call(root + '/audiences')).find(r => id(r) === campaign.audience_id);
      if (!audience) throw new Error('Audience not found in your account.');
      const memberIds = z.array(z.string()).parse(await call(`${root}/audiences/${encodeURIComponent(id(audience))}/contacts`));
      const contacts = rows.parse(await call(root + '/contacts')).filter(r => memberIds.includes(id(r)));
      const requested = body.selected_contact_ids;
      let selected = contacts;
      if (requested !== undefined) {
        const ids = z.array(z.string()).min(1).parse(requested);
        if (ids.some(cid => !contacts.some(c => id(c) === cid))) throw new Error('Selected contact is not in this audience.');
        selected = contacts.filter(c => ids.includes(id(c)));
      } else if (body.selected_contact_indexes !== undefined) {
        const indexes = z.array(z.number().int().nonnegative()).min(1).parse(body.selected_contact_indexes);
        if (indexes.some(i => i >= contacts.length)) throw new Error('Invalid contact index.');
        selected = [...new Set(indexes)].map(i => contacts[i]);
      }
      if (!selected.length) throw new Error('Audience is empty.');
      const bindings = record.parse(body.parameter_bindings ?? {});
      const prepared = selected.map(contact => ({ contact, payload: whatsappPayload(canonical, contact, bindings) }));
      const config = record.parse(await call(root + '/configs/api'));
      if (!config.meta_access_token || !/^\d+$/.test(String(config.meta_phone_number_id))) throw new Error('Connect WhatsApp API credentials first.');
      const safety = await call('/api/campaign-configs/safety-settings') ?? {};
      if (Number(safety.daily_send_cap ?? 0) > 0) throw new Error('A daily send cap is configured. Shared quota reservation is required before this local runner can send.');
      const dnc = safety.respect_dnc === false || safety.respect_dnc === 0 ? [] : rows.parse(await call('/api/do-not-call'));
      const blocked = new Set(dnc.map(r => String(r.phone_number).replace(/[\s()+-]/g, '')));
      if (prepared.some(r => blocked.has(r.payload.to))) throw new Error('Selection includes a do-not-contact number. Remove it before starting.');
      const delay = Math.max(Number(safety.min_seconds_between_sends ?? 0), z.number().min(0.1).max(3600).parse(body.delay_seconds ?? 0.1));
      const run: Row = { id: cid, status: 'active', template_name: canonical.name, template_language: canonical.language, template_structure: canonical, contacts: selected, parameter_bindings: bindings, outcomes: [], total_contacts: selected.length, sent_count: 0, failed_count: 0, created_at: Date.now() };
      this.save(run);
      void this.execute(run, prepared, config, delay, call).finally(() => this.locks.delete(cid));
      return { id: cid, status: 'active', total_contacts: selected.length };
    } catch (error) { this.locks.delete(cid); throw error; }
  }
  private async execute(run: Row, prepared: Array<{contact: Row; payload: Row}>, config: Row, delay: number, call: Call) {
    try {
      for (const { contact, payload } of prepared) {
        const outcome: Row = { contact_id: id(contact), name: contact.name, phone_number: payload.to, email: contact.email, status: 'sending', created_at: Date.now() };
        run.outcomes.push(outcome); this.save(run);
        try {
          const response = await this.sendFetch(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION ?? 'v23.0'}/${config.meta_phone_number_id}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${config.meta_access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
          const result = await response.json() as Row;
          if (!response.ok) { outcome.status = 'failed'; throw new Error(String(result.error?.message ?? 'Meta rejected the message.')); }
          if (!result.messages?.[0]?.id) throw new Error('Meta returned no message ID; delivery is unknown.');
          outcome.provider_message_id = result.messages[0].id;
          outcome.status = 'sent'; run.sent_count++; this.save(run);
          try {
            const conversation = await call(root + '/conversations', { method: 'POST', body: { phone_number: payload.to, contact_name: contact.name } });
            outcome.conversation_id = id(conversation);
            await call(root + '/messages', { method: 'POST', body: { conversation_id: id(conversation), direction: 'outbound', body: canonicalBody(run.template_structure, contact, run.parameter_bindings), provider_message_id: outcome.provider_message_id, status: 'sent' } });
          } catch { outcome.record_error = 'Message sent; chat record could not be saved.'; }
        } catch (error) {
          if (outcome.status === 'sending') outcome.status = 'unknown';
          outcome.error = error instanceof Error ? error.message : String(error);
          if (outcome.status === 'failed') run.failed_count++;
        }
        this.save(run);
        if (run.outcomes.length < prepared.length) await new Promise(resolve => setTimeout(resolve, delay * 1000));
      }
      run.status = run.outcomes.some((o: Row) => o.status === 'unknown') ? 'interrupted' : run.sent_count ? 'completed' : 'failed';
      run.completed_at = Date.now(); this.save(run);
    } catch { run.status = 'interrupted'; this.save(run); }
  }
}
function canonicalBody(template: Row, contact: Row, bindings: Row) {
  const fields = { ...parse(contact.metadata ?? {}), ...contact };
  return String(template.components.find((c: Row) => c.type === 'BODY')?.text ?? template.name).replace(/{{\s*([^{}]+?)\s*}}/g, (_: string, key: string) => String(fields[bindings[key] ?? key] ?? `{{${key}}}`));
}
