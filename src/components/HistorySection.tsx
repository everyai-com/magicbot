import { useEffect, useState } from 'react';
import { api } from '@/state/store';
import { CampaignOutcomes } from './CampaignOutcomes';

type Row = Record<string, unknown>;
const paths = { 'Voice Calls': 'call-logs/with-agent-name', SMS: 'messaging/sms-campaigns/completed', Email: 'messaging/gmail-campaigns/completed', WhatsApp: 'whatsapp/campaigns' };
export function HistorySection() {
  const [tab, setTab] = useState<keyof typeof paths>('Voice Calls');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(''); setRows([]);
    api('/api/campaign-workspace/' + paths[tab]).then((data) => {
      if (!Array.isArray(data)) throw new Error('The server returned an unexpected history response.');
      if (alive) setRows(historyRows(data, tab));
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Could not load history.'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tab, revision]);
  return <div className="space-y-4"><p className="text-sm text-ink-secondary">Review calls and campaign delivery history for your account.</p><div className="flex flex-wrap gap-2">{(Object.keys(paths) as (keyof typeof paths)[]).map(name => <button key={name} aria-pressed={tab === name} className={`rounded-lg px-3 py-2 text-sm ${tab === name ? 'bg-accent text-white' : 'bg-control'}`} onClick={() => setTab(name)}>{name}</button>)}<button className="ml-auto rounded-lg bg-control px-3 py-2 text-sm disabled:opacity-50" disabled={loading} onClick={() => setRevision(n => n + 1)}>Refresh</button></div>{loading ? <p role="status">Loading history…</p> : error ? <p role="alert" className="text-danger">{error}</p> : rows.length ? <CampaignOutcomes showErrorSummary={false} key={tab} rows={rows} resultValues={rows.map(row => String(row.Result ?? ''))} campaignName={tab + ' history'} onExport={() => {}} /> : <p className="text-sm text-ink-secondary">No {tab.toLowerCase()} history yet.</p>}</div>;
}

export function historyRows(data: Row[], channel: string): Row[] {
  const time = (value: unknown) => { if (!value) return '—'; const date = new Date(typeof value === 'number' ? value : String(value)); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(); };
  if (channel === 'Voice Calls') return data.map(row => ({ Time: time(row.started_at ?? row.created_at), Agent: (row.agents as Row | null)?.name ?? row.agent_name, Contact: row.to_number ?? row.phone_number ?? row.from_number, Result: row.status, Duration: row.duration == null ? '—' : `${row.duration} s`, 'Billed seconds': row.billed_seconds, Transcript: row.transcript, 'AI Summary': row.summary }));
  return data.filter(row => channel !== 'WhatsApp' || ['completed', 'failed', 'interrupted'].includes(String(row.status))).flatMap(campaign => (Array.isArray(campaign.outcomes) ? campaign.outcomes as Row[] : []).map(row => ({ Time: time(row.created_at ?? row.sent_at ?? campaign.completed_at ?? campaign.created_at), Campaign: campaign.name ?? campaign.campaign_name, Contact: row.name ?? row.contact_name, Recipient: row.recipient_email ?? row.email ?? row.to_email ?? row.recipient_phone ?? row.phone_number ?? row.to ?? row.recipient, Message: row.rendered_message ?? row.rendered_body ?? row.message ?? row.body, 'Provider message ID': row.provider_message_id ?? row.message_id, Result: row.status ?? row.result, Error: row.error })));
}
