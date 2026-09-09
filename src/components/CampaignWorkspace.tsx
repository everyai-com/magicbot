import { WhatsappCampaignList } from "./WhatsappCampaignList";
import { WhatsappTemplates } from "./WhatsappTemplates";
import { prepareEmailContacts } from "@/lib/email-campaign";
import { EmailTemplates } from "./EmailTemplates";
import { SmsTemplates } from "./SmsTemplates";
import { CampaignOutcomes } from "./CampaignOutcomes";
import { matchOutcomeContact } from "@/lib/campaign-outcomes";
import { parseCampaignCsv } from "@/lib/campaign-csv";
import { Phone, MessageSquare, Mail, MessageCircle, ChevronLeft, ChevronRight, FileSpreadsheet, Megaphone, LayoutTemplate, ChartColumn, Upload, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/state/store";
import { NewVoiceCampaign, type VoiceCampaignFields } from "./NewVoiceCampaign";
import { CampaignContacts, contactColumns, contactMetadata } from "./CampaignContacts";
import { Card } from "./SettingsPrimitives";

type Row = Record<string, unknown>;
type Channel = "voice" | "sms" | "gmail" | "whatsapp";
const channels: Record<Channel, string> = { voice: "Voice", sms: "SMS", gmail: "Email", whatsapp: "WhatsApp" };
const roots: Record<Channel, string> = { voice: "campaigns", sms: "messaging/sms-campaigns", gmail: "messaging/gmail-campaigns", whatsapp: "whatsapp/campaigns" };
const recordId = (row: Row) => String(row.id ?? row._id ?? "");
const list = (value: unknown): Row[] => {
  if (!Array.isArray(value)) throw new Error("The server returned an unexpected list.");
  return value as Row[];
};
const request = async (path: string, method = "GET", body?: Row) => {
  const result = await api("/api/campaign-workspace/" + path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (method !== "GET") window.dispatchEvent(new Event("campaign-workspace-changed"));
  return result;
};
const control = "rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink";
const button = "rounded-lg bg-accent px-3 py-2 text-[13px] text-white disabled:opacity-40";
function Select({ label, value, onChange, rows }: { label: string; value: string; onChange: (v: string) => void; rows: Row[] }) {
  return <label className="flex min-w-0 flex-col gap-1 text-[13px] text-ink-secondary">{label}<select className={control} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Select {label.toLowerCase()}</option>{rows.map((row) => <option key={recordId(row)} value={recordId(row)}>{String(row.name ?? row.venue_name ?? row.friendly_name ?? row.phone_number ?? recordId(row))}</option>)}</select></label>;
}
function exportRows(rows: Row[], name: string) {
  if (!rows.length) return;
  const columns = [...new Set(rows.flatMap(Object.keys))];
  const quote = (value: unknown) => {
    let text = typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
    if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const csv = [columns.map(quote).join(","), ...rows.map((row) => columns.map((key) => quote(row[key])).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Rows({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p className="text-[13px] text-ink-secondary">No records yet.</p>;
  const keys = [...new Set(rows.flatMap(Object.keys))].filter((key) => !/user_id|user_email|_creation_time/.test(key));
  return <div className="max-h-80 min-w-0 space-y-2 overflow-y-auto">{rows.slice(0, 100).map((row, i) => <dl key={i} className="grid min-w-0 gap-3 rounded-lg border border-hairline/40 p-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr))]">{keys.map((key) => <div key={key} className="min-w-0"><dt className="text-xs text-ink-secondary [overflow-wrap:anywhere]">{key.replaceAll("_", " ")}</dt><dd className="mt-1 text-[13px] whitespace-pre-wrap [overflow-wrap:anywhere]">{typeof row[key] === "object" ? JSON.stringify(row[key]) : String(row[key] ?? "")}</dd></div>)}</dl>)}{rows.length > 100 && <p className="p-2 text-sm">Showing the first 100 records. Export for all records.</p>}</div>;
}
const channelCards = [
  { id: "voice" as const, title: "Voice campaigns", icon: Phone, description: "Clean contacts, prepare outbound calls and review call outcomes." },
  { id: "sms" as const, title: "SMS campaigns", icon: MessageSquare, description: "Prepare text messages, choose a sender and track campaign results." },
  { id: "gmail" as const, title: "Email campaigns", icon: Mail, description: "Create email templates, organize contacts and review Gmail campaigns." },
  { id: "whatsapp" as const, title: "WhatsApp campaigns", icon: MessageCircle, description: "Prepare audiences, select approved templates and review delivery results." },
];

const toolCards = [
  { id: "Data cleaning", icon: FileSpreadsheet, description: "Upload a CSV, clean your contacts and save a campaign draft." },
  { id: "Campaigns", icon: Megaphone, description: "Choose a campaign, review recipients and start when you’re ready." },
  { id: "Templates", icon: LayoutTemplate, description: "Review and manage the content used in your campaigns." },
  { id: "Outcomes", icon: ChartColumn, description: "Review campaign results and export your outcomes." },
] as const;
type CampaignTool = typeof toolCards[number]["id"];

export function CampaignWorkspace() {
  const [active, setActive] = useState<Channel | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const channelButtons = useRef<Partial<Record<Channel, HTMLButtonElement | null>>>({});
  const openChannel = (channel: Channel) => {
    setActive(channel);
    requestAnimationFrame(() => {
      const visibleHeading = workspaceRef.current?.querySelector<HTMLElement>(`[data-channel="${channel}"] [data-channel-heading]`);
      visibleHeading?.focus({ preventScroll: true });
      workspaceRef.current?.scrollIntoView({ block: "start" });
    });
  };
  const backToChannels = () => {
    const previous = active;
    setActive(null);
    requestAnimationFrame(() => {
      if (previous) channelButtons.current[previous]?.focus({ preventScroll: true });
      workspaceRef.current?.scrollIntoView({ block: "start" });
    });
  };
  return <div ref={workspaceRef}>
    <section hidden={active !== null} aria-labelledby="campaign-channels-heading" className="rounded-2xl bg-card p-4">
      <h2 id="campaign-channels-heading" className="text-lg font-medium text-ink">Campaigns</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">Clean contacts, prepare campaigns and review results across your channels.</p>
        <div className="mt-4 flex flex-col gap-2">
          {channelCards.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} type="button" ref={(element) => { channelButtons.current[item.id] = element; }} onClick={() => openChannel(item.id)}
              className="group flex min-h-[76px] w-full items-center gap-3 rounded-xl border border-hairline/35 bg-inset p-3 text-left transition-colors hover:border-hairline/60 hover:bg-control/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-control text-ink"><Icon size={18} /></div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium text-ink">{item.title}</div>
                <div className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{item.description}</div>
              </div>
              <ChevronRight size={20} className="shrink-0 text-ink-secondary transition-colors group-hover:text-ink" />
            </button>;
          })}
        </div>
    </section>
    {channelCards.map((item) => <ChannelPane key={item.id} channel={item.id} active={active === item.id} onBack={backToChannels} />)}
  </div>;
}

function ChannelPane({ channel, active, onBack }: { channel: Channel; active: boolean; onBack: () => void }) {
  const [opened, setOpened] = useState(false);
  useEffect(() => { if (active) setOpened(true); }, [active]);
  // Keep entered drafts when returning to the channel menu.
  return opened || active ? <div hidden={!active} data-channel={channel}><CampaignDetail channel={channel} active={active} onBack={onBack} /></div> : null;
}

function CampaignDetail({ channel, active, onBack }: { channel: Channel; active: boolean; onBack: () => void }) {
  const toolLabel = (id: CampaignTool) => channel === "voice" ? id : id === "Outcomes" ? "Completed" : id === "Campaigns" ? "Campaign" : id;
  const navigationTools = channel === "voice"
    ? toolCards.filter((item) => item.id !== "Templates")
    : [...toolCards].sort((a, b) => ["Templates", "Data cleaning", "Campaigns", "Outcomes"].indexOf(a.id) - ["Templates", "Data cleaning", "Campaigns", "Outcomes"].indexOf(b.id));

  const [outcomeId, setOutcomeId] = useState("");
  const [outcomeRows, setOutcomeRows] = useState<Row[]>([]);
  const [outcomeResults, setOutcomeResults] = useState<string[]>([]);
  const loadedOutcomeId = useRef("");
  const [outcomeLoading, setOutcomeLoading] = useState(false);
  const [outcomeError, setOutcomeError] = useState("");
  const [tab, setTab] = useState<CampaignTool | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const toolButtons = useRef<Partial<Record<CampaignTool, HTMLButtonElement | null>>>({});
  const openTool = (tool: CampaignTool) => {
    setTab(tool); setNotice(""); setError("");
    requestAnimationFrame(() => {
      detailRef.current?.querySelector<HTMLElement>("[data-channel-heading]")?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({ block: "start" });
    });
  };
  const backToTools = () => {
    const previous = tab;
    setTab(null);
    requestAnimationFrame(() => {
      if (previous) toolButtons.current[previous]?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({ block: "start" });
    });
  };
  const [importTarget, setImportTarget] = useState("");
  const [templateActionTarget, setTemplateActionTarget] = useState<HTMLDivElement | null>(null);
  const [exportTarget, setExportTarget] = useState<HTMLDivElement | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [campaignMenu, setCampaignMenu] = useState<string | null>(null);
  const campaignMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!campaignMenu) return;
    const close = (event: PointerEvent) => { if (!campaignMenuRef.current?.contains(event.target as Node)) setCampaignMenu(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [campaignMenu]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editFields, setEditFields] = useState<VoiceCampaignFields | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [outcomeDeleteId, setOutcomeDeleteId] = useState<string | null>(null);
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const [campaigns, setCampaigns] = useState<Row[]>([]);
  const outcomeCampaigns = channel === "sms"
    ? campaigns.filter((campaign) => String(campaign.status ?? "").toLowerCase() === "completed")
    : channel === "whatsapp"
      ? campaigns.filter((campaign) => ["completed", "failed", "interrupted"].includes(String(campaign.status ?? "").toLowerCase()))
      : campaigns;
  const [agents, setAgents] = useState<Row[]>([]);
  const [phones, setPhones] = useState<Row[]>([]);
  const [templates, setTemplates] = useState<Row[]>([]);
  const whatsappTemplatesLoaded = useRef(false);
  const [audiences, setAudiences] = useState<Row[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [agent, setAgent] = useState("");
  const [phone, setPhone] = useState("");
  const [template, setTemplate] = useState("");
  const [audience, setAudience] = useState("");
  const [delay, setDelay] = useState(30);
  const [locking, setLocking] = useState(true);
  const [name, setName] = useState("");
  const [csv, setCsv] = useState("");
  const [csvFileName, setCsvFileName] = useState("");
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [contacts, setContacts] = useState<Row[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const root = roots[channel];
  useEffect(() => {
    let alive = true;
    if (!active || busy) return;
    setLoading(campaigns.length === 0);
    const paths = [root, "agents", "phone-configs", ...(channel === "voice" ? [] : [channel === "whatsapp" ? "whatsapp/templates" : `messaging/${channel}-templates`]), ...(channel === "whatsapp" ? ["whatsapp/audiences"] : [])];
    Promise.all(paths.map((path) => path === "whatsapp/templates" && whatsappTemplatesLoaded.current ? Promise.resolve(null) : request(path))).then((data) => {
      if (!alive) return;
      setCampaigns(list(data[0])); setAgents(list(data[1])); setPhones(list(data[2]));
      if (data[3]) { setTemplates(list(data[3])); if (channel === "whatsapp") whatsappTemplatesLoaded.current = true; }
      if (data[4]) setAudiences(list(data[4]));
    }).catch((e) => alive && setError(e.message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [root, channel, revision, active, busy]);
  useEffect(() => {
    if (!active || ((channel === "gmail" || channel === "whatsapp") && tab === "Templates")) return;
    const refresh = () => {
      if (document.visibilityState === "visible") setRevision((value) => value + 1);
    };
    window.addEventListener("campaign-workspace-changed", refresh);
    if (channel === "whatsapp") return () => window.removeEventListener("campaign-workspace-changed", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 15000);
    return () => {
      window.removeEventListener("campaign-workspace-changed", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [active, channel, tab]);
  // Read only campaign status while runs are active; keep the rest of the page stable.
  const hasRunningWhatsapp = channel === "whatsapp" && campaigns.some(c => String(c.status).toLowerCase() === "active");
  useEffect(() => {
    if (!active || channel !== "whatsapp" || (!hasRunningWhatsapp && tab !== "Outcomes")) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = async () => {
      try {
        const next = list(await request(root));
        if (cancelled) return;
        setCampaigns(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
        if (next.some(c => String(c.status).toLowerCase() === "active")) timer = setTimeout(update, 3000);
      } catch {
        if (!cancelled && hasRunningWhatsapp) timer = setTimeout(update, 10000);
      }
    };
    void update();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [active, channel, root, tab, hasRunningWhatsapp]);
  const navigateBack = () => {
    if (tab === "Outcomes" && outcomeId) { setOutcomeId(""); setOutcomeRows([]); return; }
    if (tab === "Campaigns" && (detailOpen || creating || editFields)) {
      setDetailOpen(false); setCreating(false); setEditFields(null); setConfirmDelete(false);
      openTool("Campaigns");
    } else backToTools();
  };
  useEffect(() => {
    if (!active || tab !== "Outcomes" || !outcomeId) return;
    let alive = true;
    setOutcomeLoading(loadedOutcomeId.current !== outcomeId); setOutcomeError("");
    const path = channel === "voice" ? "call-outcomes/by-campaign/" + encodeURIComponent(outcomeId) : channel === "whatsapp" ? root + "/" + encodeURIComponent(outcomeId) : root + "/completed";
    Promise.all([request(path), channel === "voice" ? request("contacts/by-campaign/" + encodeURIComponent(outcomeId)) : Promise.resolve(null)]).then(([data, contactResponse]) => {
      if (!alive) return;
      const rows = channel === "voice" ? list(data) : channel === "whatsapp" ? list(data.outcomes ?? []) : list(data).filter((run) => String(run.source_campaign_id ?? "") === outcomeId).flatMap((run) => list(run.outcomes ?? []).map((outcome) => ({ ...outcome, run_id: recordId(run) })));
      loadedOutcomeId.current = outcomeId;
      const campaign = campaigns.find((row) => recordId(row) === outcomeId);
      const campaignContacts = channel === "voice" ? list(Array.isArray(contactResponse) ? contactResponse : contactResponse.contacts) : Array.isArray(campaign?.extracted_contacts) ? campaign.extracted_contacts as Row[] : [];
      const customColumns = [...new Set(campaignContacts.flatMap((contact) => Object.keys(contactColumns(contact))))];
      const normalize = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
      const standard = ["name", "firstname", "fullname", "contactname", "phone", "phonenumber", "mobile", "mobilenumber", "telephone", "contactnumber", "email", "emailaddress", "sheetreference", "sno", "serialnumber", "serialno"];
      const date = (value: unknown) => {
        if (value == null || value === "") return "—";
        const parsed = new Date(typeof value === "number" ? value : String(value));
        return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
      };
      setOutcomeResults(rows.map((outcome: Row) => String(outcome.outcome ?? outcome.status ?? "")));
      setOutcomeRows(rows.map((outcome: Row, index: number) => {
        const contact = matchOutcomeContact(outcome, campaignContacts);
        const fields = contact ? contactColumns(contact) : {};
        if (channel === "sms") {
          const savedFields = contactColumns(outcome);
          return Object.fromEntries(customColumns.map((key) => [key, fields[key] ?? savedFields[key] ?? null]));
        }
        const find = (aliases: string[]) => Object.entries(fields).find(([key]) => aliases.includes(normalize(key)))?.[1];
        const view: Row = {
          Time: date(outcome.call_timestamp ?? outcome.created_at),
          "S.No": find(["sno", "serialnumber", "serialno"]) ?? index + 1,
          Contact: find(["name", "firstname", "fullname", "contactname"]) ?? contact?.first_name ?? outcome.parent_name ?? outcome.name,
          Email: find(["email", "emailaddress"]) ?? contact?.email ?? outcome.email,
          Phone: outcome.phone_number ?? contact?.phone_number,
          Attempt: outcome.attempt_number,
          Result: outcome.outcome ?? outcome.status,
          Error: outcome.error ?? outcome.error_message ?? outcome.failure_reason,
          Duration: outcome.duration_seconds != null ? `${outcome.duration_seconds}s` : outcome.duration != null ? `${outcome.duration}s` : null,
          Transcript: outcome.transcript,
          "AI Summary": outcome.summary,
          "Creation Time": date(outcome.created_at),
          "Sheet Reference": find(["sheetreference"]) ?? contact?.sheet_reference ?? outcome.sheet_reference,
        };
        for (const key of customColumns) if (!standard.includes(normalize(key))) view[Object.hasOwn(view, key) ? `Contact: ${key}` : key] = fields[key] ?? null;
        return view;
      }));
    }).catch((error) => { if (alive) setOutcomeError(error.message); }).finally(() => { if (alive) setOutcomeLoading(false); });
    return () => { alive = false; };
  }, [active, tab, outcomeId, root, channel, revision]);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const chooseCampaign = (id: string) => {
    setDetailOpen(Boolean(id)); setEditFields(null); setConfirmDelete(false);
    requestAnimationFrame(() => { detailPanelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); detailPanelRef.current?.focus({ preventScroll: true }); });
    setCampaignId(id); setContacts([]); setSelected([]);
    const row = campaigns.find((r) => recordId(r) === id);
    setAgent(String(row?.agent_id ?? "")); setTemplate(String(row?.template_id ?? ""));
    setDelay(Number(row?.delay_seconds ?? 30)); setLocking(row?.enable_number_locking !== false);
    setPhone(String(row?.phone_config_id ?? "")); setAudience(String(row?.audience_id ?? ""));
    if (id) void run(async () => {
      if (channel === "voice") {
        const fresh = await request(root + "/" + encodeURIComponent(id));
        setCampaigns((old) => old.map((row) => recordId(row) === id ? fresh : row));
        const response = await request("contacts/by-campaign/" + encodeURIComponent(id));
        const data = list(Array.isArray(response) ? response : response.contacts);
        setContacts(data); setSelected(data.map((_, i) => i));
      } else {
        const data = list(row?.extracted_contacts ?? []);
        setContacts(data); setSelected(data.map((_, i) => i));
      }
    });
  };
  const analyze = () => run(async () => {
    if (!csv.trim()) throw new Error("Upload a CSV first.");
    const data = parseCampaignCsv(csv);
    setContacts(data); setSelected(data.map((_, i) => i)); setCampaignId("");
    setNotice("Review the extracted contacts before saving. Missing country codes must be corrected in the CSV.");
  });
  const save = () => run(async () => {
    if (channel === "voice" && importTarget) {
      const rows = selected.map((i) => contacts[i]);
      if (!rows.length) throw new Error("Process a CSV and select contacts first.");
      await request("contacts/bulk", "POST", { campaign_id: importTarget, contacts: rows });
      const target = importTarget;
      setImportTarget(""); setContacts([]); setSelected([]); setCsv(""); setCsvFileName("");
      const response = await request("contacts/by-campaign/" + encodeURIComponent(target));
      const saved = list(Array.isArray(response) ? response : response.contacts);
      await request(root + "/" + target, "PATCH", { total_contacts: saved.length });
      setCampaigns((old) => old.map((row) => recordId(row) === target ? { ...row, total_contacts: saved.length } : row));
      setContacts(saved); setSelected(saved.map((_, i) => i)); setCampaignId(target);
      openTool("Campaigns"); setNotice("CSV contacts added to the campaign."); return;
    }
    if (!name.trim()) throw new Error("Enter a campaign name.");
    const rows = selected.map((i) => contacts[i]);
    if (!rows.length) throw new Error("Select contacts to save.");
    let audienceId = channel === "whatsapp" ? "" : audience;
    if (channel === "whatsapp") {
      if (!audienceId && rows.length) {
        const imported = await request("whatsapp/contacts/bulk", "POST", { contacts: rows.map((row) => ({ ...row, name: row.first_name ?? row.name })) });
        const audienceRow = await request("whatsapp/audiences", "POST", { name: name.trim(), contactIds: imported.ids });
        audienceId = recordId(audienceRow);
        setAudience(audienceId);
      }
      if (!audienceId) throw new Error("Choose an audience or import contacts.");
    }
    const payload: Row = { name: name.trim(), status: "draft", total_contacts: rows.length };
    // The voice API requires venue_name; use the user’s campaign label for compatibility.
    if (channel === "voice") Object.assign(payload, { venue_name: name.trim(), agent_id: agent || null, phone_config_id: phone || null, delay_seconds: delay, enable_number_locking: locking });
    else if (channel === "whatsapp") Object.assign(payload, { audience_id: audienceId, template_id: null, extracted_contacts: rows });
    else Object.assign(payload, { extracted_contacts: rows, template_id: template || null });
    const created = await request(root, "POST", payload);
    const id = recordId(created);
    if (!id) throw new Error("Campaign response was missing its ID. Refresh before trying again.");
    if (channel === "voice") {
      try { await request("contacts/bulk", "POST", { campaign_id: id, contacts: rows }); }
      catch { setRevision((v) => v + 1); throw new Error("Draft created, but contact import failed. Check the draft before creating another campaign."); }
    }
    setCampaigns((old) => [created, ...old.filter((row) => recordId(row) !== id)]);
    setCampaignId(id); setDetailOpen(true);
    if (channel === "voice") {
      const response = await request("contacts/by-campaign/" + encodeURIComponent(id));
      const savedContacts = list(Array.isArray(response) ? response : response.contacts);
      setContacts(savedContacts); setSelected(savedContacts.map((_, i) => i));
    }
    setNotice("Draft saved with your CSV contacts. Review the campaign before starting."); openTool("Campaigns");
  });
  const createVoiceCampaign = async (fields: VoiceCampaignFields) => {
    let success = false;
    await run(async () => {
      if (!fields.venue_name.trim()) throw new Error("Enter a venue name.");
      if (fields.end_date && fields.start_date && fields.end_date < fields.start_date) throw new Error("End date must be on or after start date.");
      const imported = campaignId ? [] : selected.map((i) => contacts[i]);
      const { phone_config_ids, ...values } = fields;
      const created = await request(root, "POST", { ...values, venue_name: fields.venue_name.trim(), start_date: fields.start_date ? Date.parse(fields.start_date) : null, end_date: fields.end_date ? Date.parse(fields.end_date) : null, booking_target: fields.booking_target ? Number(fields.booking_target) : null, agent_id: fields.agent_id || null, phone_config_id: phone_config_ids[0] || null, total_contacts: imported.length });
      const id = recordId(created);
      if (!id) throw new Error("Campaign response was missing its ID. Refresh before creating another.");
      setCampaigns((old) => [created, ...old]); setCampaignId(id); setCreating(false); setDetailOpen(true);
      setAgent(fields.agent_id); setPhone(phone_config_ids[0] || ""); setDelay(fields.delay_seconds); setLocking(fields.enable_number_locking);
      setContacts([]); setSelected([]);
      try {
        if (phone_config_ids.length) await request("campaign-configs/phone-configs", "PUT", { campaign_id: id, phone_config_ids });
        if (imported.length) await request("contacts/bulk", "POST", { campaign_id: id, contacts: imported });
        const response = await request("contacts/by-campaign/" + encodeURIComponent(id));
        const rows = list(Array.isArray(response) ? response : response.contacts);
        setContacts(rows); setSelected(rows.map((_, i) => i));
      } catch { throw new Error("Campaign created, but linking numbers or loading contacts failed. Select this campaign and refresh before creating another."); }
      setNotice("Campaign created. Review recipients before starting calls."); success = true;
    });
    return success;
  };
  const selectedCampaign = campaigns.find((row) => recordId(row) === campaignId);
  const updateCampaign = async (fields: VoiceCampaignFields) => {
    let success = false;
    await run(async () => {
      if (!fields.venue_name.trim()) throw new Error("Enter a venue name.");
      if (fields.start_date && fields.end_date && fields.end_date < fields.start_date) throw new Error("End date must be on or after start date.");
      const { phone_config_ids, ...values } = fields;
      await request(root + "/" + campaignId, "PATCH", { ...values, venue_name: fields.venue_name.trim(), start_date: fields.start_date ? Date.parse(fields.start_date) : null, end_date: fields.end_date ? Date.parse(fields.end_date) : null, booking_target: fields.booking_target ? Number(fields.booking_target) : null, agent_id: fields.agent_id || null, phone_config_id: phone_config_ids[0] || null });
      try { await request("campaign-configs/phone-configs", "PUT", { campaign_id: campaignId, phone_config_ids }); }
      catch { throw new Error("Campaign details saved, but phone-number links could not be updated. Retry Save changes."); }
      const saved = await request(root + "/" + campaignId);
      setCampaigns((old) => old.map((row) => recordId(row) === campaignId ? saved : row));
      setAgent(fields.agent_id); setPhone(phone_config_ids[0] || ""); setDelay(fields.delay_seconds); setLocking(fields.enable_number_locking);
      setEditFields(null); setNotice("Campaign changes saved."); success = true;
    });
    return success;
  };
  const deleteCampaign = () => run(async () => {
    await request(root + "/" + campaignId, "DELETE");
    setCampaigns((old) => old.filter((row) => recordId(row) !== campaignId));
    setCampaignId(""); setContacts([]); setSelected([]); setDetailOpen(false); setConfirmDelete(false); setEditFields(null);
    setNotice("Campaign deleted.");
  });
  const start = () => run(async () => {
    if (!campaignId) throw new Error("Choose a campaign.");
    if (channel === "voice") {
      if (!agent || !phone || !selected.length) throw new Error("Select agent, caller number and contacts.");
      await request(root + "/" + campaignId, "PATCH", { agent_id: agent, phone_config_id: phone, delay_seconds: delay, enable_number_locking: locking });
      await request(root + "/" + campaignId + "/start", "POST", { contact_ids: selected.map((i) => recordId(contacts[i])) });
    } else if (channel === "whatsapp") {
      if (!audience || !template) throw new Error("Choose audience and template.");
      await request(root + "/" + campaignId, "PATCH", { audience_id: audience, template_id: template });
      await request(root + "/" + campaignId + "/start", "POST", {});
    } else if (channel === "gmail") {
      const chosenTemplate = templates.find((row) => recordId(row) === template);
      if (!chosenTemplate) throw new Error("Choose an email template.");
      const prepared = prepareEmailContacts(contacts, selected, String(chosenTemplate.message ?? ""));
      const accounts = list(await request("messaging/gmail-campaigns/accounts"));
      if (!accounts.length) throw new Error("Connect your Gmail account in Integrations before starting an email campaign.");
      await request(root + "/" + encodeURIComponent(campaignId), "PATCH", { extracted_contacts: prepared, template_id: template });
      setContacts(prepared);
      setCampaigns((old) => old.map((row) => recordId(row) === campaignId ? { ...row, extracted_contacts: prepared, template_id: template } : row));
      await request(root + "/start", "POST", { campaign_id: campaignId, template_id: template, selected_contact_indexes: [...selected].sort((a, b) => a - b), delay_seconds: delay });
    } else {
      if (!template || !selected.length || (channel === "sms" && !phone)) throw new Error("Select template, contacts and sender number where required.");
      await request(root + "/" + campaignId + "/start", "POST", { campaign_id: campaignId, template_id: template, phone_config_id: phone, selected_contact_indexes: selected, delay_seconds: delay });
    }
    setNotice("Start request accepted. Check Outcomes for delivery results."); setRevision((v) => v + 1);
  });
  return <div ref={detailRef} className="flex min-w-0 flex-col gap-4">
    <button hidden={tab === null} type="button" onClick={navigateBack} className={tab === null ? "hidden" : control + " inline-flex items-center gap-1.5 self-start"}><ChevronLeft size={14} /> Back</button>
    <section className={tab === null ? "rounded-2xl bg-card p-4" : undefined}>
      <div className="flex items-center gap-2">
        {tab === null && <button type="button" onClick={onBack} aria-label="Back to Campaigns" title="Back to Campaigns" className="-ml-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"><ChevronLeft size={18} /></button>}
        <h2 data-channel-heading tabIndex={-1} className="text-lg font-medium text-ink outline-none">{tab ? toolLabel(tab) : `${channels[channel]} campaigns`}</h2>
        {tab === "Campaigns" && <button type="button" disabled={busy || loading} className={button + " ml-auto shrink-0"} onClick={() => { setDetailOpen(false); setEditFields(null); (channel === "voice" || channel === "whatsapp") ? setCreating(true) : openTool("Data cleaning"); }}>+ New Campaign</button>}
        {tab === "Templates" && (channel === "gmail" || channel === "whatsapp") && <div ref={setTemplateActionTarget} className="ml-auto shrink-0" />}
        {tab === "Outcomes" && <div ref={setExportTarget} className="ml-auto shrink-0" />}
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{tab ? toolCards.find((item) => item.id === tab)?.description : channelCards.find((item) => item.id === channel)?.description}</p>
      {tab === null && <div className="mt-4 flex flex-col gap-2">
        {navigationTools.map((item) => {
          const Icon = item.icon;
          const description = item.id === "Templates" && channel === "voice"
            ? "Review how your selected agent’s prompt and tools guide voice campaigns."
            : item.id === "Templates" && channel === "whatsapp"
              ? "Review approved WhatsApp templates from your connected account."
              : item.description;
          return <button key={item.id} type="button" ref={(element) => { toolButtons.current[item.id] = element; }} onClick={() => openTool(item.id)}
            className="group flex min-h-[60px] w-full items-center gap-3 rounded-xl border border-hairline/35 bg-inset px-3 py-2 text-left transition-colors hover:border-hairline/60 hover:bg-control/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-control text-ink"><Icon size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-ink">{toolLabel(item.id)}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-ink-secondary">{description}</span>
            </span>
            <ChevronRight size={20} className="shrink-0 text-ink-secondary transition-colors group-hover:text-ink" />
          </button>;
        })}
      </div>}
    </section>
    <fieldset hidden={tab === null} disabled={busy || loading} className={tab === null ? "hidden" : "flex min-w-0 max-w-full flex-col gap-4 disabled:opacity-70"}>
      {tab === "Data cleaning" && <Card title="Prepare a campaign" subtitle="Save a draft first. Starting a campaign is a separate action.">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="rounded-xl border border-hairline/40 bg-panel p-4">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink"><FileSpreadsheet size={18} aria-hidden="true" />Upload CSV</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">Upload a contacts CSV to detect columns and prepare your data.</p>
            <input ref={csvInputRef} className="hidden" aria-label="Contacts CSV" type="file" accept=".csv,text/csv" onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              e.target.value = "";
              setCsv(""); setCsvFileName(""); setContacts([]); setSelected([]); setNotice("");
              void run(async () => {
                if (file.size > 100000) throw new Error("Use a CSV smaller than 100 KB for this import.");
                const text = await file.text();
                setCsv(text); setCsvFileName(file.name);
              });
            }} />
            <button type="button" onClick={() => csvInputRef.current?.click()} className="mt-4 flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-hairline/50 bg-inset/30 px-4 py-5 text-ink-secondary transition-colors hover:border-accent hover:bg-accent/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <Upload size={28} strokeWidth={1.75} aria-hidden="true" />
              <span className="max-w-full break-all text-[13px]">{csvFileName || "Click to upload CSV"}</span>
              <span className="text-[11px]">{csvFileName ? "Click to choose a different file" : "CSV files up to 100 KB"}</span>
            </button>
          </div>
          <button type="button" className={button} disabled={!csv.trim()} onClick={analyze}>Process &amp; Analyze</button>
          <Rows rows={contacts.map(contactColumns)} />
          {contacts.length > 0 && <p className="text-sm">{contacts.length} contacts ready to review in Campaigns.</p>}

          <input aria-label="Campaign name" className={control} placeholder="Campaign name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className={button} onClick={save}>{importTarget ? "Add contacts to campaign" : "Save draft"}</button>
        </div>
      </Card>}
      {tab === "Campaigns" && channel === "whatsapp" && <WhatsappCampaignList campaigns={campaigns} audiences={audiences} templates={templates} creating={creating} onCreating={setCreating} request={request} onSaved={row => setCampaigns(old => old.some(c => recordId(c) === recordId(row)) ? old.map(c => recordId(c) === recordId(row) ? row : c) : [...old,row])} />}
      {tab === "Campaigns" && channel !== "whatsapp" && <div className="flex min-w-0 flex-col gap-3">
        {channel === "voice" && creating && <NewVoiceCampaign agents={agents.map((row) => ({ id: recordId(row), name: String(row.name ?? recordId(row)) }))} phones={phones.map((row) => ({ id: recordId(row), name: String(row.friendly_name ?? row.phone_number ?? recordId(row)) }))} contactCount={campaignId ? 0 : selected.length} onCreate={createVoiceCampaign} onCancel={() => setCreating(false)} />}
        {!creating && !detailOpen && <div className="grid gap-2 sm:grid-cols-2">{campaigns.map((row) => {
          const id = recordId(row);
          const title = String(row.name ?? row.venue_name ?? id);
          return <div key={id} className="relative flex min-h-20 min-w-0 items-center rounded-lg border border-hairline/40 bg-inset">
            {renamingId === id ? <form className="min-w-0 flex-1 p-3" onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const name = campaignName.trim();
                if (!name) throw new Error("Enter a campaign name.");
                await request(root + "/" + encodeURIComponent(id), "PATCH", channel === "voice" ? { venue_name: name } : { name });
                setCampaigns((old) => old.map((campaign) => recordId(campaign) === id ? { ...campaign, ...(channel === "voice" ? { venue_name: name } : {}), name } : campaign));
                setRenamingId(null); setNotice("Campaign name updated.");
              });
            }}>
              <label className="text-xs text-ink-secondary">Campaign name<input autoFocus className={control + " mt-1 w-full min-w-0"} value={campaignName} onChange={(event) => setCampaignName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setRenamingId(null); } }} required /></label>
              <div className="mt-2 flex gap-2"><button type="submit" className={button}>Save</button><button type="button" className={control} onClick={() => setRenamingId(null)}>Cancel</button></div>
            </form> : <>
            <button type="button" onClick={() => { setCampaignMenu(null); chooseCampaign(id); }} className="min-w-0 flex-1 rounded-lg px-3 py-5 text-left text-[13px] hover:bg-control/30 focus-visible:outline-2 focus-visible:outline-accent"><span className="block break-words font-medium">{title}</span></button>            </>}

            {channel === "voice" && <div ref={campaignMenu === id ? campaignMenuRef : undefined} className="relative mr-2 shrink-0" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setCampaignMenu(null); } }}>
              <button type="button" aria-label={`Actions for ${title}`} aria-expanded={campaignMenu === id} className="rounded-md p-2 text-ink-secondary hover:bg-control hover:text-ink" onClick={() => setCampaignMenu(campaignMenu === id ? null : id)}><MoreHorizontal size={18} /></button>
              {campaignMenu === id && <div className="absolute right-0 top-full z-20 mt-1 flex min-w-32 flex-col rounded-lg border border-hairline/50 bg-panel p-1 shadow-xl">
                <button type="button" className="rounded px-3 py-2 text-left text-sm hover:bg-control" onClick={() => { setCampaignMenu(null); setRenamingId(id); setCampaignName(title); }}>Edit</button>
                <button type="button" className="rounded px-3 py-2 text-left text-sm text-danger hover:bg-control" onClick={() => { setCampaignMenu(null); chooseCampaign(id); setConfirmDelete(true); }}>Delete</button>
              </div>}
            </div>}
          </div>;
        })}{!campaigns.length && <p className="text-sm text-ink-secondary">No campaigns yet. Save a CSV draft or create a new campaign.</p>}</div>}

      </div>}
      {tab === "Campaigns" && detailOpen && selectedCampaign && <div ref={detailPanelRef} tabIndex={-1} className="flex flex-col gap-3 outline-none">
        {confirmDelete && <div role="alert" className="rounded-xl border border-danger/40 p-4 text-sm"><p>Delete “{String(selectedCampaign.venue_name ?? selectedCampaign.name)}”? Its contacts and call outcomes will also be deleted. This cannot be undone.</p><div className="mt-3 flex gap-2"><button type="button" className={button + " bg-danger"} onClick={deleteCampaign}>Delete permanently</button><button type="button" className={control} onClick={() => setConfirmDelete(false)}>Cancel</button></div></div>}
        {editFields ? <NewVoiceCampaign key={campaignId} editing initialValues={editFields} agents={agents.map((row) => ({ id: recordId(row), name: String(row.name ?? recordId(row)) }))} phones={phones.map((row) => ({ id: recordId(row), name: String(row.friendly_name ?? row.phone_number ?? recordId(row)) }))} contactCount={0} onCreate={updateCampaign} onCancel={() => setEditFields(null)} /> : <><Card title="Campaign details">
          <dl className="grid gap-3 text-[13px] sm:grid-cols-2">{[
            ["Campaign name", selectedCampaign.name ?? selectedCampaign.venue_name ?? "—"],
            ["Delay", selectedCampaign.delay_seconds != null ? `${selectedCampaign.delay_seconds} seconds` : "—"],
            ["Created", (() => {
              const value = selectedCampaign.created_at ?? selectedCampaign._creation_time;
              if (value == null || value === "") return "—";
              const date = new Date(typeof value === "number" ? value : String(value));
              return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
            })()],
            ["Location", selectedCampaign.venue_location || selectedCampaign.location || "—"],
            ["Total contacts", selectedCampaign.total_contacts ?? contacts.length],
          ].map(([label, value]) => <div key={String(label)} className="min-w-0"><dt className="text-ink-secondary">{String(label)}</dt><dd className="mt-1 text-ink [overflow-wrap:anywhere]">{String(value)}</dd></div>)}</dl>
        </Card>
        <Card title="Contacts"><CampaignContacts key={campaignId} rows={contacts} selected={selected} onSelectionChange={setSelected} onDelete={async (row) => {
            if (channel !== "voice") throw new Error("Contact deletion is currently available for voice campaigns.");
            await request("contacts/" + encodeURIComponent(recordId(row)), "DELETE");
            const index = contacts.findIndex((contact) => recordId(contact) === recordId(row));
            const remaining = contacts.filter((contact) => recordId(contact) !== recordId(row));
            setContacts(remaining);
            setSelected((old) => old.filter((value) => value !== index).map((value) => value > index ? value - 1 : value));
            setCampaigns((old) => old.map((campaign) => recordId(campaign) === campaignId ? { ...campaign, total_contacts: remaining.length } : campaign));
            await request(root + "/" + campaignId, "PATCH", { total_contacts: remaining.length });
          }} onSave={async (edited) => {
            const normalizedRows = edited.map((row) => {
              const metadata = contactMetadata(row);
              const updated: Row = { ...row, metadata };
              for (const [key, value] of Object.entries(metadata)) {
                const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
                if (["name", "fullname", "contactname", "firstname"].includes(normalized)) updated.first_name = value;
                if (["phone", "phonenumber", "mobile", "mobilenumber", "telephone", "contactnumber"].includes(normalized)) updated.phone_number = value;
                if (["email", "emailaddress"].includes(normalized)) updated.email = value;
              }
              return updated;
            });
            if (!campaignId) throw new Error("Select a campaign before saving contacts.");
            if (channel === "voice") {
              for (const row of normalizedRows) {
                const updated = await request("contacts/" + encodeURIComponent(recordId(row)), "PATCH", {
                  metadata: row.metadata, first_name: row.first_name, phone_number: row.phone_number, email: row.email,
                });
                setContacts((old) => old.map((contact) => recordId(contact) === recordId(row) ? { ...row, ...updated } : contact));
              }
              return;
            }
            const payload: Row = { extracted_contacts: normalizedRows, total_contacts: normalizedRows.length };
            if (channel === "whatsapp") {
              const imported = await request("whatsapp/contacts/bulk", "POST", {
                contacts: normalizedRows.map((row) => ({ ...row, name: row.first_name ?? row.name, phone: row.phone_number ?? row.phone })),
              });
              if (!Array.isArray(imported.ids) || imported.ids.length !== normalizedRows.length) throw new Error("Not all WhatsApp contacts were saved. Review the contacts and try again.");
              const savedAudience = await request("whatsapp/audiences", "POST", {
                name: String(selectedCampaign.name ?? "Campaign") + " contacts", contactIds: imported.ids,
              });
              const savedAudienceId = recordId(savedAudience);
              if (!savedAudienceId) throw new Error("Could not save the WhatsApp audience. Try again.");
              payload.audience_id = savedAudienceId;
              await request(root + "/" + encodeURIComponent(campaignId), "PATCH", payload);
              setAudience(savedAudienceId);
              setAudiences((old) => [...old, savedAudience]);
            } else {
              await request(root + "/" + encodeURIComponent(campaignId), "PATCH", payload);
            }
            setContacts(normalizedRows);
            setCampaigns((old) => old.map((campaign) => recordId(campaign) === campaignId ? { ...campaign, ...payload } : campaign));
          }} />
        </Card></>}
      </div>}
      {tab === "Campaigns" && detailOpen && !editFields && <Card title={channels[channel] + " campaigns"} subtitle="Choose the campaign and recipients before starting."><div className="flex min-w-0 flex-col gap-3">
        <Select label="Campaign" value={campaignId} onChange={chooseCampaign} rows={campaigns} />
        <div className="grid gap-3 sm:grid-cols-2">
          {channel === "voice" && <Select label="Agent" value={agent} onChange={setAgent} rows={agents} />}
          {(channel === "voice" || channel === "sms") && <Select label="Caller number" value={phone} onChange={setPhone} rows={phones} />}
          {channel !== "voice" && <Select label="Template" value={template} onChange={setTemplate} rows={templates} />}
          {channel === "whatsapp" && <Select label="Audience" value={audience} onChange={setAudience} rows={audiences} />}
        </div>
        <label className="text-sm">Delay between starts (seconds)<input className={control + " ml-2 w-24"} type="number" min="1" max="3600" value={delay} onChange={(e) => setDelay(Math.max(1, Math.min(3600, Number(e.target.value) || 1)))} /></label>
        {channel === "voice" && <label className="text-sm"><input type="checkbox" checked={locking} onChange={(e) => setLocking(e.target.checked)} /> Lock caller number</label>}
        <button className={button} disabled={!campaignId} onClick={start}>Start {channels[channel]} campaign</button>
      </div></Card>}
      {tab === "Templates" && channel === "sms" && <SmsTemplates templates={templates} onSave={async (draft) => {
        const saved = await request("messaging/sms-templates", "POST", draft);
        setTemplates((old) => draft.template_id ? old.map((row) => recordId(row) === draft.template_id ? saved : row) : [...old, saved]);
        setNotice("Template saved.");
      }} />}
      {tab === "Templates" && channel === "gmail" && <EmailTemplates actionTarget={templateActionTarget} templates={templates} onSave={async (draft) => {
        await request("messaging/gmail-templates", "POST", draft);
        if (draft.template_id) {
          setTemplates((old) => old.map((row) => recordId(row) === draft.template_id ? { ...row, name: draft.name, category: draft.category, message: draft.message } : row));
        } else {
          setTemplates(list(await request("messaging/gmail-templates")));
        }
        setNotice("");
      }} onDelete={async (id) => {
        await request("messaging/gmail-templates/" + encodeURIComponent(id), "DELETE");
        setTemplates((old) => old.filter((row) => recordId(row) !== id));
        setNotice("");
      }} />}
      {tab === "Templates" && channel === "whatsapp" && <WhatsappTemplates actionTarget={templateActionTarget} templates={templates} onUpdate={(updated) => setTemplates(old => old.map(row => recordId(row) === recordId(updated) ? updated : row))} onDelete={(id) => setTemplates(old => old.filter(row => recordId(row) !== id))} request={request} refresh={async () => setTemplates(list(await request("whatsapp/templates")))} />}
      {tab === "Templates" && channel === "voice" && <Card title="Templates"><div className="flex min-w-0 flex-col gap-3"><Rows rows={templates} /><p className="text-sm text-ink-secondary">Voice campaigns use the selected agent’s prompt and tools.</p></div></Card>}
      {tab === "Outcomes" && <div className="min-w-0 space-y-3">
        {outcomeDeleteId && <div role="alert" className="rounded-xl border border-danger/40 p-4 text-sm">
          <p>Delete “{String(campaigns.find((row) => recordId(row) === outcomeDeleteId)?.name ?? campaigns.find((row) => recordId(row) === outcomeDeleteId)?.venue_name ?? "Campaign") }”? Its contacts and outcomes will also be deleted. This cannot be undone.</p>
          {error && <p className="mt-2 text-danger">{error}</p>}
          <div className="mt-3 flex gap-2"><button type="button" className={button + " bg-danger"} onClick={() => void run(async () => {
            await request(root + "/" + encodeURIComponent(outcomeDeleteId), "DELETE");
            setCampaigns((old) => old.filter((row) => recordId(row) !== outcomeDeleteId));
            if (campaignId === outcomeDeleteId) { setCampaignId(""); setContacts([]); setSelected([]); setDetailOpen(false); }
            setOutcomeDeleteId(null); setNotice("Campaign deleted.");
          })}>{busy ? "Deleting…" : "Delete permanently"}</button><button type="button" className={control} onClick={() => setOutcomeDeleteId(null)}>Cancel</button></div>
        </div>}

        {!outcomeId ? <div className="grid gap-2 sm:grid-cols-2">{outcomeCampaigns.map((row) => {
          const id = recordId(row);
          const title = String(row.name ?? row.venue_name ?? id);
          return <div key={id} className="relative flex min-h-20 min-w-0 items-center rounded-lg border border-hairline/40 bg-inset">
            {renamingId === id ? <form className="min-w-0 flex-1 p-3" onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const name = campaignName.trim();
                if (!name) throw new Error("Enter a campaign name.");
                await request(root + "/" + encodeURIComponent(id), "PATCH", channel === "voice" ? { venue_name: name } : { name });
                setCampaigns((old) => old.map((campaign) => recordId(campaign) === id ? { ...campaign, ...(channel === "voice" ? { venue_name: name } : {}), name } : campaign));
                setRenamingId(null); setNotice("Campaign name updated.");
              });
            }}>
              <label className="text-xs text-ink-secondary">Campaign name<input autoFocus className={control + " mt-1 w-full min-w-0"} value={campaignName} onChange={(event) => setCampaignName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setRenamingId(null); } }} required /></label>
              <div className="mt-2 flex gap-2"><button type="submit" className={button}>Save</button><button type="button" className={control} onClick={() => setRenamingId(null)}>Cancel</button></div>
            </form> : <>
            <button type="button" onClick={() => { setCampaignMenu(null); setOutcomeRows([]); setOutcomeId(id); }} className="min-w-0 flex-1 rounded-lg px-3 py-5 text-left text-[13px] hover:bg-control/30 focus-visible:outline-2 focus-visible:outline-accent"><span className="block break-words font-medium">{title}</span></button>            </>}

            {<div ref={campaignMenu === id ? campaignMenuRef : undefined} className="relative mr-2 shrink-0" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setCampaignMenu(null); } }}>
              <button type="button" aria-label={`Actions for ${title}`} aria-expanded={campaignMenu === id} className="rounded-md p-2 text-ink-secondary hover:bg-control hover:text-ink" onClick={() => setCampaignMenu(campaignMenu === id ? null : id)}><MoreHorizontal size={18} /></button>
              {campaignMenu === id && <div className="absolute right-0 top-full z-20 mt-1 flex min-w-32 flex-col rounded-lg border border-hairline/50 bg-panel p-1 shadow-xl">
                <button type="button" className="rounded px-3 py-2 text-left text-sm hover:bg-control" onClick={() => { setCampaignMenu(null); setRenamingId(id); setCampaignName(title); }}>Edit</button>
                <button type="button" className="rounded px-3 py-2 text-left text-sm text-danger hover:bg-control" onClick={() => { setCampaignMenu(null); setOutcomeDeleteId(id); }}>Delete</button>
              </div>}
            </div>}
          </div>;
        })}{!loading && !outcomeCampaigns.length && <p className="text-sm text-ink-secondary">{(channel === "sms" || channel === "whatsapp") ? "No completed campaigns yet. Campaigns appear here after all recipients have been processed." : "No campaigns yet."}</p>}</div> : <Card title={String(campaigns.find((row) => recordId(row) === outcomeId)?.name ?? campaigns.find((row) => recordId(row) === outcomeId)?.venue_name ?? "Campaign outcomes")}>
          <div className="min-w-0 space-y-3">
            {outcomeLoading && <p role="status" className="text-sm text-ink-secondary">Loading outcomes…</p>}
            {outcomeError && <p role="alert" className="text-sm text-danger">{outcomeError}</p>}
            {!outcomeLoading && !outcomeError && !outcomeRows.length && <p className="text-sm text-ink-secondary">No outcomes recorded for this campaign yet.</p>}
            {outcomeRows.length > 0 && <><CampaignOutcomes exportTarget={exportTarget} key={outcomeId} agentId={String(campaigns.find((row) => recordId(row) === outcomeId)?.agent_id ?? "")} campaignName={String(campaigns.find((row) => recordId(row) === outcomeId)?.name ?? campaigns.find((row) => recordId(row) === outcomeId)?.venue_name ?? "Campaign")} rows={outcomeRows} resultValues={channel === "sms" ? outcomeResults : undefined} onExport={(rows) => exportRows(rows, "outcomes.csv")} /></>}
          </div>
        </Card>}
      </div>}
    </fieldset>
    {(busy || loading) && <p role="status" className="text-sm">Loading…</p>}
    {error && <p role="alert" className="rounded-lg bg-inset p-3 text-sm text-danger">{error}</p>}
    {notice && !((channel === "gmail" || channel === "whatsapp") && tab === "Templates") && <p role="status" className="rounded-lg bg-inset p-3 text-sm">{notice}</p>}
  </div>;
}
