import { useEffect, useRef, useState } from 'react';
import { api } from '@/state/store';
import { CampaignOutcomes } from './CampaignOutcomes';
import { VoiceCallHistory } from './VoiceCallHistory';
import { CallDetail } from './CallDetail';
import {
  extractCallId,
  extractPlatformAgentId,
  extractRowTime,
  needsLiveRefresh,
  normalizeLiveCall,
  type LiveCall,
} from '@/lib/ultravox-calls';

type Row = Record<string, unknown>;
const paths = { 'Voice Calls': 'call-logs/with-agent-name', SMS: 'messaging/sms-campaigns/completed', Email: 'messaging/gmail-campaigns/completed', WhatsApp: 'whatsapp/campaigns' };

/** Resolve one history row to its live provider call: direct id first,
// then time-proximity matching through the server. */
async function resolveLiveCall(raw: Row): Promise<LiveCall | null> {
  const callId = extractCallId(raw);
  if (callId) {
    try {
      const data = await api(`/api/ultravox/calls/${encodeURIComponent(callId)}`);
      if (data && typeof data.call === "object" && data.call) {
        return normalizeLiveCall(data.call as Row);
      }
    } catch {
      // Fall through to time-proximity matching below.
    }
  }
  const platformAgentId = extractPlatformAgentId(raw);
  const at = extractRowTime(raw);
  if (!platformAgentId || !at) return null;
  const data = await api('/api/ultravox/match-calls', {
    method: 'POST',
    body: JSON.stringify({ items: [{ key: 'r', platformAgentId, at }] }),
  });
  const found = Array.isArray(data?.results) ? data.results[0] : null;
  if (found && found.matched && found.call && typeof found.call === "object") {
    return normalizeLiveCall(found.call as Row);
  }
  return null;
}

export function HistorySection() {
  const [tab, setTab] = useState<keyof typeof paths>('Voice Calls');
  const [rows, setRows] = useState<Row[]>([]);
  const [rawRows, setRawRows] = useState<Row[]>([]);
  const [liveByIndex, setLiveByIndex] = useState<Record<number, LiveCall>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [demoItems, setDemoItems] = useState<Array<{ row: Row; raw: Row; live: LiveCall }>>([]);
  const [demoState, setDemoState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [demoError, setDemoError] = useState('');

  const refreshIndices = async (rawData: Row[], indices: number[]) => {
    const entries = await Promise.all(indices.map(async (index) => {
      try {
        const live = await resolveLiveCall((rawData[index] ?? {}) as Row);
        return live ? ([index, live] as const) : null;
      } catch {
        return null;
      }
    }));
    const next: Record<number, LiveCall> = {};
    for (const entry of entries) if (entry) next[entry[0]] = entry[1];
    if (Object.keys(next).length) setLiveByIndex((old) => ({ ...old, ...next }));
  };

  // Rows worth a provider lookup: non-final statuses (they can change)
  // plus any row already carrying a provider call id — even when final, the
  // id resolves exact status, transcript source, recording and transport
  // (phone vs browser demo), which the platform row may lack.
  const lookupIndices = (mapped: Row[], raws: Row[], live: Record<number, LiveCall>): number[] =>
    mapped
      .map((row, index) => ({ row, index }))
      .filter(({ row, index }) =>
        needsLiveRefresh(live[index]?.status ?? row.Result) ||
        (!live[index] && !!extractCallId((raws[index] ?? {}) as Row)),
      )
      .slice(0, 25)
      .map(({ index }) => index);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(''); setRows([]); setRawRows([]); setLiveByIndex({}); setSelected(null);
    setDemoItems([]); setDemoState('idle'); setDemoError('');
    api('/api/campaign-workspace/' + paths[tab]).then((data) => {
      if (!Array.isArray(data)) throw new Error('The server returned an unexpected history response.');
      if (!alive) return;
      const mapped = historyRows(data, tab);
      setRows(mapped);
      setRawRows(data);
      if (tab === 'Voice Calls') {
        // Platform call status can lag (finished calls stuck on "initiated").
        // Re-check rows worth a provider lookup (see lookupIndices).
        const stale = lookupIndices(mapped, data, {});
        if (stale.length && alive) void refreshIndices(data, stale);
        // Browser demos live outside the platform logs — fetch alongside.
        if (alive) void fetchDemoItems(data, () => alive);
      }
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Could not load history.'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // refreshIndices is stable logic over explicit args; tab drives reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Stable identity for a row so an open detail drawer survives list
  // refreshes that prepend new rows above it.
  const rowKey = (raw: Row, row: Row): string => {
    const id = extractCallId(raw);
    if (id) return `id:${id}`;
    const agent = extractPlatformAgentId(raw) || String(row.Agent ?? "");
    const at = extractRowTime(raw) || String(row.Time ?? "");
    return `row:${agent}|${at}`;
  };

  // While any voice row is still live, keep re-checking so an ongoing call
  // flips to its final result on its own. Only non-final rows re-poll here —
  // id-carrying final rows resolve once on load (see lookupIndices).
  const liveRef = useRef(liveByIndex);
  liveRef.current = liveByIndex;
  const rawRef = useRef(rawRows);
  rawRef.current = rawRows;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect(() => {
    if (tab !== 'Voice Calls') return;
    const timer = setInterval(() => {
      const mapped = rowsRef.current;
      if (!mapped.length) return;
      const stale = lookupIndices(mapped, rawRef.current, liveRef.current)
        .filter((index) => needsLiveRefresh(liveRef.current[index]?.status ?? mapped[index]?.Result));
      if (!stale.length) return;
      void refreshIndices(rawRef.current, stale);
    }, 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // The list itself stays live: re-fetch on a slow tick so new calls appear
  // without any manual refresh. An open drawer follows its call by stable
  // key instead of by position.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    const timer = setInterval(() => {
      void (async () => {
        let data: unknown;
        try {
          data = await api('/api/campaign-workspace/' + paths[tab]);
        } catch {
          return; // Keep the old list; the next tick retries.
        }
        if (!Array.isArray(data) || !data.length) return;
        const mapped = historyRows(data, tab);
        const prev = selectedRef.current;
        if (prev != null) {
          const oldPlatLen = rowsRef.current.length;
          if (prev < oldPlatLen) {
            const prevKey = rowKey((rawRef.current[prev] ?? {}) as Row, (rowsRef.current[prev] ?? {}) as Row);
            const nextIndex = data.findIndex((entry, i) => rowKey((entry ?? {}) as Row, (mapped[i] ?? {}) as Row) === prevKey);
            selectedRef.current = nextIndex >= 0 ? nextIndex : null;
            setSelected(selectedRef.current);
          } else {
            // Demo region sits after the platform rows — shift with them.
            selectedRef.current = mapped.length + (prev - oldPlatLen);
            setSelected(selectedRef.current);
          }
        }
        // Carry live overlays across by stable key so they don't stick to
        // the wrong row after new entries prepend above.
        const keyedLive: Record<string, LiveCall> = {};
        rowsRef.current.forEach((oldRow, oldIndex) => {
          const entry = liveRef.current[oldIndex];
          if (entry) keyedLive[rowKey((rawRef.current[oldIndex] ?? {}) as Row, oldRow)] = entry;
        });
        const remapped: Record<number, LiveCall> = {};
        mapped.forEach((newRow, newIndex) => {
          const entry = keyedLive[rowKey((data[newIndex] ?? {}) as Row, newRow)];
          if (entry) remapped[newIndex] = entry;
        });
        setLiveByIndex(remapped);
        setRows(mapped);
        setRawRows(data);
        if (tab === 'Voice Calls') {
          const stale = lookupIndices(mapped, data, remapped);
          if (stale.length) void refreshIndices(data, stale);
        }
      })();
    }, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const displayRows = tab === 'Voice Calls'
    ? rows.map((row, index) => {
      const live = liveByIndex[index];
      if (!live) return row;
      return {
        ...row,
        Result: live.status === 'in-progress' ? 'Live' : live.status,
        Duration: live.durationSeconds != null ? `${live.durationSeconds} s` : row.Duration,
      };
    })
    : rows;

  // Demo calls never appear in the platform call-logs, so they load
  // straight from the provider account right after the list — without ever
  // blocking it. Invoked directly (not an effect), so dep-timing and remount
  // races can't leave it stuck.
  const fetchDemoItems = async (rawData: Row[], isAlive: () => boolean) => {
    setDemoState('loading');
    setDemoError('');
    const timer = setTimeout(() => {
      setDemoError('Demo calls are taking too long to load. Please try again.');
      setDemoState('done');
    }, 45000);
    try {
      const safeRows = rawData.filter((raw): raw is Row => !!raw && typeof raw === "object");
        const agentNames: Record<string, string> = {};
        safeRows.forEach((raw) => {
          const id = extractPlatformAgentId(raw);
          const agents = raw.agents && typeof raw.agents === "object" ? (raw.agents as Row) : null;
          const name = agents?.name ?? raw.agent_name;
          if (id && typeof name === "string" && name) agentNames[id] = name;
        });
        const agentIds = [...new Set(safeRows.map(extractPlatformAgentId).filter(Boolean))];
        const data = await api('/api/ultravox/demo-calls', {
          method: 'POST',
          body: JSON.stringify({ agentIds }),
        });
        if (!isAlive()) return;
      const items: Array<{ row: Row; raw: Row; live: LiveCall }> = [];
      const pushCall = (call: unknown, platformAgentId: string, agentName: string) => {
        if (!call || typeof call !== "object") return;
        const live = normalizeLiveCall(call as Row);
        if (!live.callId) return;
        const created = live.created ? new Date(live.created) : null;
        items.push({
          live,
          raw: { call_id: live.callId, agent_id: platformAgentId, direction: "Demo", started_at: live.created },
          row: {
            Time: created && !Number.isNaN(created.getTime()) ? created.toLocaleString() : "—",
            Agent: agentName || "—",
            Contact: live.to || "—",
            Result: live.status === 'in-progress' ? 'Live' : live.status,
            Duration: live.durationSeconds != null ? `${live.durationSeconds} s` : "—",
            'Billed seconds': live.billedDuration || "—",
            Transcript: "",
            'AI Summary': live.summary || "",
          },
        });
      };
      for (const entry of (data?.agents ?? []) as Array<{ platformAgentId?: unknown; agentName?: unknown; calls?: unknown }>) {
        const platformAgentId = typeof entry?.platformAgentId === "string" ? entry.platformAgentId : "";
        const agentName = (typeof entry?.agentName === "string" && entry.agentName) || agentNames[platformAgentId] || "—";
        for (const call of (Array.isArray(entry?.calls) ? entry.calls : [])) pushCall(call, platformAgentId, agentName);
      }
      for (const call of (Array.isArray(data?.unassigned) ? data.unassigned : [])) pushCall(call, "", "—");
      items.sort((a, b) => String(b.live.created ?? "").localeCompare(String(a.live.created ?? "")));
      if (!isAlive()) return;
      setDemoItems(items);
      setDemoState('done');
    } catch (error) {
      if (!isAlive()) return;
      setDemoError(error instanceof Error ? error.message : 'Could not load demo calls.');
      setDemoState('done');
    } finally {
      clearTimeout(timer);
    }
  };

  // One unified voice list: platform phone rows first, browser demos appended.
  const voiceRows = [...displayRows];
  const voiceRaw: Row[] = [...rawRows];
  const voiceLive: Record<number, LiveCall> = { ...liveByIndex };
  let demoStart = -1;
  if (demoItems.length) {
    demoStart = voiceRows.length;
    demoItems.forEach((item, offset) => {
      voiceLive[demoStart + offset] = item.live;
      voiceRows.push(item.row);
      voiceRaw.push(item.raw);
    });
  }

  return <div className="space-y-4"><p className="text-sm text-ink-secondary">Review calls and campaign delivery history for your account.</p><div className="flex flex-wrap items-center gap-2">{(Object.keys(paths) as (keyof typeof paths)[]).map(name => <button key={name} aria-pressed={tab === name} className={`rounded-lg px-3 py-2 text-sm ${tab === name ? 'bg-accent text-white' : 'bg-control'}`} onClick={() => setTab(name)}>{name}</button>)}</div>{loading ? <p role="status">Loading history…</p> : error ? <p role="alert" className="text-danger">{error}</p> : rows.length ? (tab === 'Voice Calls'
    ? <>
      {demoState === 'loading' ? <p role="status" className="text-xs text-ink-secondary">Loading browser demos…</p> : null}
      {demoState === 'done' && demoError ? <p role="alert" className="text-xs text-danger">{demoError}</p> : null}
      <VoiceCallHistory rows={voiceRows} rawRows={voiceRaw} liveByIndex={voiceLive} demoStart={demoStart} onSelect={setSelected} />
    </>
    : <CampaignOutcomes showErrorSummary={false} key={tab} rows={displayRows} resultValues={displayRows.map(row => String(row.Result ?? ''))} campaignName={tab + ' history'} onExport={() => {}} />) : <p className="text-sm text-ink-secondary">No {tab.toLowerCase()} history yet.</p>}
    {selected != null && voiceRows[selected] && (
      <CallDetail
        row={voiceRows[selected]}
        raw={(voiceRaw[selected] ?? {}) as Row}
        live={voiceLive[selected] ?? null}
        onClose={() => setSelected(null)}
        onLiveUpdate={(live) => {
          if (selected >= displayRows.length) {
            setDemoItems((old) => old.map((item, index) => (index === selected - displayRows.length ? { ...item, live } : item)));
          } else {
            setLiveByIndex((old) => ({ ...old, [selected]: live }));
          }
        }}
      />
    )}
  </div>;
}

export function historyRows(data: Row[], channel: string): Row[] {
  const time = (value: unknown) => { if (!value) return '—'; const date = new Date(typeof value === 'number' ? value : String(value)); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(); };
  if (channel === 'Voice Calls') return data.map(row => ({ Time: time(row.started_at ?? row.created_at), Agent: (row.agents as Row | null)?.name ?? row.agent_name, Contact: row.to_number ?? row.phone_number ?? row.from_number, Result: row.status, Duration: row.duration == null ? '—' : `${row.duration} s`, 'Billed seconds': row.billed_seconds, Transcript: row.transcript, 'AI Summary': row.summary }));
  return data.filter(row => channel !== 'WhatsApp' || ['completed', 'failed', 'interrupted'].includes(String(row.status))).flatMap(campaign => (Array.isArray(campaign.outcomes) ? campaign.outcomes as Row[] : []).map(row => ({ Time: time(row.created_at ?? row.sent_at ?? campaign.completed_at ?? campaign.created_at), Campaign: campaign.name ?? campaign.campaign_name, Contact: row.name ?? row.contact_name, Recipient: row.recipient_email ?? row.email ?? row.to_email ?? row.recipient_phone ?? row.phone_number ?? row.to ?? row.recipient, Message: row.rendered_message ?? row.rendered_body ?? row.message ?? row.body, 'Provider message ID': row.provider_message_id ?? row.message_id, Result: row.status ?? row.result, Error: row.error })));
}
