import { useCallback, useEffect, useState } from "react";
import { Clock3, Database, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/state/store";
import { CONNECTOR_SYNC_MINUTES } from "../../shared/connector-snapshot";

type Snapshot = {
  id: string; label: string; source_type: string; connector_service: string | null; connector_tool: string | null;
  status: string; item_count: number; last_error: string | null; last_synced_at: number | null;
  auto_sync: number; sync_interval_minutes: number; next_sync_at: number | null;
};
type Tool = { name: string; description?: string };

function timeLabel(value: number | null) {
  if (!value) return "Not synced yet";
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ConnectorSnapshots() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [tool, setTool] = useState("");
  const [label, setLabel] = useState("");
  const [args, setArgs] = useState("{}");
  const [interval, setIntervalMinutes] = useState(60);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [sourceResult, toolResult] = await Promise.all([
      api("/api/context/sources") as Promise<{ sources: Snapshot[] }>,
      api("/api/context/tools") as Promise<{ tools: Tool[] }>,
    ]);
    setSnapshots((sourceResult.sources ?? []).filter((source) => source.source_type !== "attachment"));
    setTools(toolResult.tools ?? []);
  }, []);

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }, [load]);

  const create = async () => {
    setBusy("new"); setError("");
    try {
      const argumentsValue = JSON.parse(args) as Record<string, unknown>;
      await api("/api/context/sources", { method: "POST", body: JSON.stringify({
        sourceType: tool.toLowerCase().includes("github") ? "github" : tool.toLowerCase().match(/gmail|email/) ? "email" : "connector",
        label: label.trim() || tool.replaceAll("_", " "), connectorTool: tool, arguments: argumentsValue,
        scopeType: "user", autoSync: true, syncIntervalMinutes: interval,
      }) });
      setTool(""); setLabel(""); setArgs("{}");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  };

  const update = async (snapshot: Snapshot, patch: { autoSync?: boolean; syncIntervalMinutes?: number }) => {
    setBusy(snapshot.id); setError("");
    try { await api(`/api/context/sources/${snapshot.id}`, { method: "PATCH", body: JSON.stringify(patch) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  };

  const refresh = async (snapshot: Snapshot) => {
    setBusy(snapshot.id); setError("");
    try { await api(`/api/context/sources/${snapshot.id}/refresh`, { method: "POST" }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  };

  const remove = async (snapshot: Snapshot) => {
    if (!window.confirm(`Remove the local snapshot “${snapshot.label}”? The connected app and its original data will not be changed.`)) return;
    setBusy(snapshot.id); setError("");
    try { await api(`/api/context/sources/${snapshot.id}`, { method: "DELETE" }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  };

  return <div className="space-y-5">
    <section className="rounded-2xl border border-hairline/40 bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3"><Database size={19} className="mt-0.5 shrink-0 text-accent" /><div><h3 className="text-[15px] font-medium text-ink">Agent data snapshots</h3><p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-secondary">Keep selected inbox, calendar, CRM, or workspace reads locally available to every agent. Refreshes are read-only; sending or changing anything still uses approval.</p></div></div>
      {tools.length === 0 ? <div className="mt-4 rounded-xl bg-inset px-4 py-5 text-center text-[12.5px] text-ink-secondary">Connect an app with readable data to create a snapshot.</div> : <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <label className="block"><span className="mb-1.5 block text-[11.5px] text-ink-secondary">Read-only action</span><select value={tool} onChange={(event) => setTool(event.target.value)} className="min-h-11 w-full rounded-xl border border-hairline/40 bg-inset px-3 text-[12px] text-ink"><option value="">Choose an app read…</option>{tools.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}</select></label>
        <label className="block"><span className="mb-1.5 block text-[11.5px] text-ink-secondary">Snapshot name</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Example: Recent priority email" className="min-h-11 w-full rounded-xl border border-hairline/40 bg-inset px-3 text-[13px] text-ink" /></label>
        <label className="block lg:col-span-2"><span className="mb-1.5 block text-[11.5px] text-ink-secondary">Query arguments</span><textarea value={args} onChange={(event) => setArgs(event.target.value)} aria-label="Snapshot query arguments" className="min-h-24 w-full resize-y rounded-xl border border-hairline/40 bg-inset p-3 font-mono text-[11.5px] text-ink" /></label>
        <label className="block"><span className="mb-1.5 block text-[11.5px] text-ink-secondary">Refresh</span><select value={interval} onChange={(event) => setIntervalMinutes(Number(event.target.value))} className="min-h-11 w-full rounded-xl border border-hairline/40 bg-inset px-3 text-[12.5px] text-ink">{CONNECTOR_SYNC_MINUTES.map((minutes) => <option value={minutes} key={minutes}>{minutes < 60 ? `Every ${minutes} minutes` : minutes === 60 ? "Every hour" : minutes === 1440 ? "Every day" : `Every ${minutes / 60} hours`}</option>)}</select></label>
        <button disabled={!tool || busy === "new"} onClick={() => void create()} className="flex min-h-11 items-center justify-center gap-2 self-end rounded-xl bg-accent px-4 text-[13px] font-medium text-white disabled:opacity-50">{busy === "new" ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}Create snapshot</button>
      </div>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>}
    </section>

    <section>
      <div className="mb-2 text-[12px] font-medium text-ink-secondary">Saved snapshots {snapshots.length ? `(${snapshots.length})` : ""}</div>
      {snapshots.length === 0 ? <div className="rounded-2xl border border-dashed border-hairline/50 px-4 py-10 text-center text-[13px] text-ink-secondary">No connector snapshots yet.</div> : <div className="grid gap-3 md:grid-cols-2">{snapshots.map((snapshot) => <article key={snapshot.id} className="rounded-2xl border border-hairline/40 bg-card p-4">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="truncate text-[13.5px] font-medium text-ink">{snapshot.label}</h4><p className="mt-1 truncate font-mono text-[10.5px] text-ink-secondary">{snapshot.connector_tool}</p></div><span className="shrink-0 rounded-md bg-inset px-2 py-1 text-[10px] capitalize text-ink-secondary">{snapshot.status}</span></div>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-secondary"><Clock3 size={13} /><span>{timeLabel(snapshot.last_synced_at)} · {snapshot.item_count} chunks</span></div>
        {snapshot.last_error && <p className="mt-2 line-clamp-2 text-[11.5px] text-danger">{snapshot.last_error}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex min-h-10 items-center gap-2 rounded-lg bg-inset px-3 text-[11.5px] text-ink"><input type="checkbox" checked={Boolean(snapshot.auto_sync)} onChange={(event) => void update(snapshot, { autoSync: event.target.checked })} />Auto refresh</label>
          <select aria-label={`Refresh interval for ${snapshot.label}`} disabled={!snapshot.auto_sync || busy === snapshot.id} value={snapshot.sync_interval_minutes} onChange={(event) => void update(snapshot, { syncIntervalMinutes: Number(event.target.value) })} className="min-h-10 rounded-lg border border-hairline/30 bg-inset px-2 text-[11.5px] text-ink disabled:opacity-50">{CONNECTOR_SYNC_MINUTES.map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}</option>)}</select>
          <button disabled={busy === snapshot.id} onClick={() => void refresh(snapshot)} aria-label={`Refresh ${snapshot.label}`} className="flex size-10 items-center justify-center rounded-lg text-ink-secondary hover:bg-inset"><RefreshCw size={14} className={busy === snapshot.id ? "animate-spin" : ""} /></button>
          <button disabled={busy === snapshot.id} onClick={() => void remove(snapshot)} aria-label={`Remove ${snapshot.label}`} className="flex size-10 items-center justify-center rounded-lg text-ink-secondary hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
        </div>
      </article>)}</div>}
    </section>
  </div>;
}
