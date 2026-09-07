import { useEffect, useState } from "react";
import { api } from "@/state/store";
import { gmailDraftUrl, type EmailTemplate } from "@/lib/crm-email";
type Row = Record<string, unknown>;
const id = (row: Row) => String(row.id ?? row._id ?? "");
export function CrmCampaignResults({ agentId, template, connected }: { agentId?: string; template: EmailTemplate; connected: boolean }) {
  const [campaigns, setCampaigns] = useState<Row[]>([]);
  const [campaign, setCampaign] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCampaign(""); setRows([]); setCampaigns([]);
    if (!agentId) return;
    setLoading(true); setError("");
    api("/api/platform/crm/campaigns", { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(result)) throw new Error("Could not read campaigns.");
      setCampaigns(result.filter((row: Row) => row.agent_id === agentId));
    }).catch((e) => { if (!controller.signal.aborted) setError(String(e.message)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [agentId, revision]);
  useEffect(() => {
    const controller = new AbortController();
    setRows([]);
    if (!campaign) return;
    setLoading(true); setError("");
    Promise.all([
      api(`/api/platform/crm/campaigns/${encodeURIComponent(campaign)}/contacts`, { signal: controller.signal }),
      api(`/api/platform/crm/campaigns/${encodeURIComponent(campaign)}/outcomes`, { signal: controller.signal }),
    ]).then(([contactResult, outcomes]) => {
      const contacts = Array.isArray(contactResult) ? contactResult : contactResult.contacts;
      if (!Array.isArray(contacts) || !Array.isArray(outcomes)) throw new Error("Could not read campaign results.");
      if (controller.signal.aborted) return;
      setRows(outcomes.map((outcome: Row) => {
        const matches = contacts.filter((c: Row) => outcome.contact_id ? id(c) === outcome.contact_id : c.phone_number && c.phone_number === outcome.phone_number);
        const contact = matches.length === 1 ? matches[0] : {};
        return { ...contact, matchedContact: matches.length === 1, outcomeId: id(outcome) };
      }));
    }).catch((e) => { if (!controller.signal.aborted) setError(String(e.message)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [campaign]);
  return <section className="grid gap-3 rounded-xl border border-hairline/40 bg-card p-4">
    <div className="flex justify-between"><h3 className="font-semibold">Campaign results</h3><button type="button" onClick={() => setRevision((v) => v + 1)} className="text-accent">Refresh</button></div>
    <p className="text-sm text-ink-secondary">Uses the saved agent template. Open Email prepares a Gmail draft for you to review and send.</p>
    {!connected && <p className="text-sm text-ink-secondary">Connect Gmail in Settings → Integrations, then refresh CRM connections.</p>}
    <select aria-label="Campaign" value={campaign} onChange={(e) => setCampaign(e.target.value)} className="rounded-lg bg-inset p-2 text-ink">
      <option value="">Select a campaign</option>{campaigns.map((row) => <option key={id(row)} value={id(row)}>{String(row.name ?? row.title ?? id(row))}</option>)}
    </select>
    {loading && <p role="status">Loading campaign results…</p>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {!loading && !campaigns.length && <p className="text-sm text-ink-secondary">No campaigns found for this agent.</p>}
    {!loading && campaign && !rows.length && <p className="text-sm text-ink-secondary">No call results for this campaign.</p>}
    {rows.map((row) => <div key={String(row.outcomeId)} className="flex items-center justify-between gap-3 border-t border-hairline/40 pt-3">
      <span>{String(row.name ?? row.first_name ?? row.email ?? "Contact details unavailable")}</span>
      <button type="button" disabled={!connected || !row.matchedContact} className="text-accent disabled:opacity-40" onClick={() => {
        try { const url = gmailDraftUrl(template, row); setError(""); window.open(url, "_blank", "noopener,noreferrer"); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      }}>Open Email</button>
    </div>)}
  </section>;
}
