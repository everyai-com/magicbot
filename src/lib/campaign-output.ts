type Row = Record<string, unknown>;
export const outputRoots = { Voice: 'campaigns', SMS: 'messaging/sms-campaigns', Email: 'messaging/gmail-campaigns', WhatsApp: 'whatsapp/campaigns' };
export type OutputCampaign = { id: string; name: string; channel: keyof typeof outputRoots; status: string };
export function outputCampaigns(data: unknown, channel: OutputCampaign['channel']): OutputCampaign[] {
  if (!Array.isArray(data)) throw new Error('Unexpected campaign list.');
  return data.filter(row => row && (row.id ?? row._id)).map(row => ({ id: String(row.id ?? row._id), name: String(row.name ?? row.venue_name ?? row.id ?? row._id), channel, status: String(row.status ?? '') }));
}
export function findOutputCampaign(args: string, campaigns: OutputCampaign[]) {
  if (!/^[@$]/.test(args)) throw new Error('Use /output $Campaign Name');
  const name = args.slice(1).trim().toLowerCase();
  const matches = campaigns.filter(row => row.name.toLowerCase() === name || `${row.channel}:${row.id}`.toLowerCase() === name);
  if (matches.length !== 1) throw new Error(matches.length ? 'Several campaigns have that name. Select one from the campaign suggestions.' : 'Campaign not found. Choose a campaign from the suggestions.');
  return matches[0];
}
export async function readCampaignOutput(campaign: OutputCampaign, request: (path: string) => Promise<unknown>): Promise<Row[]> {
  const root = outputRoots[campaign.channel];
  const data = await request(campaign.channel === 'Voice' ? 'call-outcomes/by-campaign/' + encodeURIComponent(campaign.id) : campaign.channel === 'WhatsApp' ? root + '/' + encodeURIComponent(campaign.id) : root + '/completed');
  const rows = campaign.channel === 'Voice' ? data : campaign.channel === 'WhatsApp' ? (data as Row)?.outcomes ?? [] : Array.isArray(data) ? data.filter(run => String(run.source_campaign_id ?? '') === campaign.id).flatMap(run => run.outcomes ?? []) : null;
  if (!Array.isArray(rows)) throw new Error('Unexpected campaign output response.');
  return rows;
}
