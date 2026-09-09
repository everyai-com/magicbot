import { cachedVoices, loadVoiceCatalog } from "@/lib/voice-catalog";
import { CalendarDays, Check, ChevronDown, ChevronLeft, Edit3, Eye, FileText, Link, Loader2, MoreHorizontal, Pause, PhoneForwarded, Play, Plus, Search, Trash2, UploadCloud, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, useStore, type Bot } from "@/state/store";
import { betterAuthToken } from "@/lib/auth";
import { stateForBot } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { customToolNotes } from "@/lib/custom-tool-entries";
import { CrmCampaignResults } from "./CrmCampaignResults";
import { BotProfileAvatarCard } from "./BotProfileAvatarCard";
import { BOT_PROFILE_LIMITS } from "../../shared/bot-profile";
import type { AgentProfileConfig } from "../../shared/agent-config";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[13px] text-ink-secondary">{label}</div>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none focus:border-hairline";

const selectCls = `${inputCls} appearance-none`;

const textareaCls = `${inputCls} min-h-[84px] resize-y leading-relaxed`;

const defaultAgentConfig: AgentProfileConfig = {
  aiProvider: "ultravox",
  model: "MagicTeams v0.7",
  firstSpeaker: "agent",
  temperature: 0.7,
  language: "en",
  maxDuration: 600,
};

interface UltravoxVoiceOption {
  voiceId: string;
  name: string;
  languageLabel?: string;
  primaryLanguage?: string;
  provider?: string;
}

interface PhoneConfigOption {
  id: string;
  phoneNumber: string;
  friendlyName?: string;
  provider?: string;
}

interface CallForwardingRow {
  id?: string;
  _id?: string;
  phone_number?: string;
  phoneNumber?: string;
  label?: string | null;
  priority?: number | null;
  localIndex?: number;
}

interface CalendarIntegrationRow {
  id?: string;
  _id?: string;
  provider?: string;
  display_name?: string | null;
  displayName?: string | null;
  calendar_id?: string | null;
  is_active?: boolean | number | null;
}

interface AppointmentToolRow {
  id?: string;
  _id?: string;
  name?: string;
  provider?: string;
  calendar_integration_id?: string | null;
  business_hours?: unknown;
  appointment_types?: unknown;
  is_active?: boolean | number | null;
  localIndex?: number;
}

interface WebhookRow {
  id?: string;
  _id?: string;
  url?: string;
  events?: unknown;
  agent_id?: string | null;
  agentId?: string | null;
}

interface KnowledgeBaseRow {
  id?: string;
  _id?: string;
  name?: string;
  title?: string;
  type?: string;
  content?: string | null;
  description?: string | null;
  website_url?: string | null;
  file_path?: string | null;
  processing_status?: string | null;
  ultravox_corpus_id?: string | null;
  ultravoxCorpusId?: string | null;
  ultravoxCorpusCreated?: boolean;
  localIndex?: number;
}

type CustomToolStep = "info" | "integration" | "parameters" | "advanced";
type CustomToolParameterKind = "Dynamic" | "Static";
type CustomToolParameterLocation = "Body" | "Query" | "Header" | "Path";
type CustomToolParameterValueType = "String" | "Number" | "Boolean" | "Object" | "Array";
type WebhookEventType = "call.started" | "call.ended" | "call.billed" | "call.joined";

interface CustomToolParameter {
  kind: CustomToolParameterKind;
  name: string;
  location: CustomToolParameterLocation;
  description: string;
  valueType: CustomToolParameterValueType;
  required: boolean;
}

const ALL_LANGUAGES = "All languages";
const MAGICTEAMS_MODELS = ["MagicTeams v0.7", "MagicTeams v0.5"];
const CUSTOM_TOOL_STEPS: Array<{ id: CustomToolStep; label: string }> = [
  { id: "info", label: "Info" },
  { id: "integration", label: "Integration" },
  { id: "parameters", label: "Parameters" },
  { id: "advanced", label: "Advanced" },
];
const CUSTOM_TOOL_STEP_INDEX = {
  info: 0,
  integration: 1,
  parameters: 2,
  advanced: 3,
} satisfies Record<CustomToolStep, number>;
const CUSTOM_PARAMETER_LOCATIONS: CustomToolParameterLocation[] = ["Body", "Query", "Header", "Path"];
const CUSTOM_PARAMETER_VALUE_TYPES: CustomToolParameterValueType[] = ["String", "Number", "Boolean", "Object", "Array"];
const WEBHOOK_EVENTS: Array<{ value: WebhookEventType; label: string }> = [
  { value: "call.started", label: "Start Call" },
  { value: "call.ended", label: "End Call" },
  { value: "call.billed", label: "Billed Call" },
  { value: "call.joined", label: "Joined Call" },
];
const CUSTOM_CRM_PROVIDERS = [
  { id: "gmail", label: "Email", detail: "Send CRM outcome emails with a saved template", icon: Edit3 },
  { id: "google_docs", label: "Google Docs", detail: "Enable document-based CRM outcomes for this agent", icon: FileText },
  { id: "google_sheets", label: "Google Sheets", detail: "Enable spreadsheet-based CRM outcomes for this agent", icon: CalendarDays },
] as const;
type CustomCrmProvider = (typeof CUSTOM_CRM_PROVIDERS)[number];

interface CustomCrmEmailTemplate {
  to: string;
  subject: string;
  body: string;
}

const DEFAULT_EMAIL_TEMPLATE: CustomCrmEmailTemplate = {
  to: "<<email>>",
  subject: "",
  body: "",
};

function parseCustomParameterKind(value: string): CustomToolParameterKind {
  if (value === "Static") return "Static";
  return "Dynamic";
}

function parseCustomParameterLocation(value: string): CustomToolParameterLocation {
  if (value === "Query" || value === "Header" || value === "Path") return value;
  return "Body";
}

function parseCustomParameterValueType(value: string): CustomToolParameterValueType {
  if (value === "Number" || value === "Boolean" || value === "Object" || value === "Array") return value;
  return "String";
}

function normalizeLanguageCode(language: string | undefined): string {
  const value = (language ?? "").trim().toLowerCase();
  if (!value) return "";
  if (value === "english") return "en";
  if (value === "telugu" || value === "te") return "tel";
  if (value === "hindi") return "hi";
  if (value === "spanish") return "es";
  if (value === "french") return "fr";
  if (value === "german") return "de";
  return value;
}

function looksLikeVoiceId(value: string | undefined): boolean {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim()));
}

function forwardingRowId(row: CallForwardingRow): string {
  return row.id ?? row._id ?? (row.localIndex === undefined ? "" : `local-forwarding-${row.localIndex}`);
}

function forwardingPhone(row: CallForwardingRow): string {
  return row.phone_number ?? row.phoneNumber ?? "";
}

function normalizeForwardingRows(value: unknown): CallForwardingRow[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { forwardingNumbers?: unknown }).forwardingNumbers)
      ? (value as { forwardingNumbers: unknown[] }).forwardingNumbers
      : value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
        ? (value as { items: unknown[] }).items
        : value && typeof value === "object" && Array.isArray((value as { call_forwarding_numbers?: unknown }).call_forwarding_numbers)
          ? (value as { call_forwarding_numbers: unknown[] }).call_forwarding_numbers
          : [];
  return rows
    .map((row) => row && typeof row === "object" ? row as Record<string, unknown> : {})
    .map((record) => ({
      id: typeof record.id === "string" ? record.id : undefined,
      _id: typeof record._id === "string" ? record._id : undefined,
      phone_number: typeof record.phone_number === "string" ? record.phone_number : undefined,
      phoneNumber: typeof record.phoneNumber === "string" ? record.phoneNumber : undefined,
      label: typeof record.label === "string" ? record.label : null,
      priority: typeof record.priority === "number" ? record.priority : null,
    }))
    .filter((row) => forwardingRowId(row) || forwardingPhone(row));
}

function localForwardingRows(value: string | undefined): CallForwardingRow[] {
  return (value ?? "")
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const [phone, ...labelParts] = entry.split(/\s+-\s+/);
      return {
        id: `local-forwarding-${index}`,
        localIndex: index,
        phone_number: phone?.trim() || entry,
        label: labelParts.join(" - ").trim() || null,
        priority: index + 1,
      };
    });
}

function forwardingSummary(rows: CallForwardingRow[], fallback: string | undefined): { count: number; title: string; detail: string } {
  const resolvedRows = rows.length > 0 ? rows : localForwardingRows(fallback);
  if (resolvedRows.length > 0) {
    const first = resolvedRows[0];
    const phone = forwardingPhone(first);
    return {
      count: resolvedRows.length,
      title: resolvedRows.length === 1 ? "1 forwarding number" : `${resolvedRows.length} forwarding numbers`,
      detail: [first.label, phone].filter(Boolean).join(" - ") || phone,
    };
  }
  return {
    count: 0,
    title: "No forwarding numbers",
    detail: "Add transfer destinations this agent can use",
  };
}

function appointmentToolId(row: AppointmentToolRow): string {
  return row.id ?? row._id ?? (row.localIndex === undefined ? "" : `local-appointment-${row.localIndex}`);
}

function normalizeAppointmentTools(value: unknown): AppointmentToolRow[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { appointmentTools?: unknown }).appointmentTools)
      ? (value as { appointmentTools: unknown[] }).appointmentTools
      : value && typeof value === "object" && Array.isArray((value as { tools?: unknown }).tools)
        ? (value as { tools: unknown[] }).tools
        : value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
          ? (value as { items: unknown[] }).items
          : [];
  return rows
    .map((row) => row && typeof row === "object" ? row as Record<string, unknown> : {})
    .map((record) => ({
      id: typeof record.id === "string" ? record.id : undefined,
      _id: typeof record._id === "string" ? record._id : undefined,
      name: typeof record.name === "string" ? record.name : undefined,
      provider: typeof record.provider === "string" ? record.provider : undefined,
      calendar_integration_id: typeof record.calendar_integration_id === "string" ? record.calendar_integration_id : null,
      business_hours: record.business_hours,
      appointment_types: record.appointment_types,
      is_active: typeof record.is_active === "boolean" || typeof record.is_active === "number" ? record.is_active : null,
    }))
    .filter((row) => appointmentToolId(row) || row.name);
}

function normalizeCalendarIntegrations(value: unknown): CalendarIntegrationRow[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { integrations?: unknown }).integrations)
      ? (value as { integrations: unknown[] }).integrations
      : [];
  return rows
    .map((row) => row && typeof row === "object" ? row as Record<string, unknown> : {})
    .map((record) => ({
      id: typeof record.id === "string" ? record.id : undefined,
      _id: typeof record._id === "string" ? record._id : undefined,
      provider: typeof record.provider === "string" ? record.provider : undefined,
      display_name: typeof record.display_name === "string" ? record.display_name : null,
      displayName: typeof record.displayName === "string" ? record.displayName : null,
      calendar_id: typeof record.calendar_id === "string" ? record.calendar_id : null,
      is_active: typeof record.is_active === "boolean" || typeof record.is_active === "number" ? record.is_active : null,
    }))
    .filter((row) => row.id || row._id);
}

function localAppointmentTools(value: string | undefined): AppointmentToolRow[] {
  return (value ?? "")
    .split(/\n\n---\n|\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => ({
      id: `local-appointment-${index}`,
      localIndex: index,
      name: entry,
      provider: "notes",
      is_active: true,
    }));
}

function appointmentToolSummary(rows: AppointmentToolRow[], fallback: string | undefined): { count: number; title: string; detail: string } {
  const resolvedRows = rows.length > 0 ? rows : localAppointmentTools(fallback);
  if (resolvedRows.length > 0) {
    const first = resolvedRows[0];
    return {
      count: resolvedRows.length,
      title: resolvedRows.length === 1 ? "1 appointment tool" : `${resolvedRows.length} appointment tools`,
      detail: [first.name, first.provider].filter(Boolean).join(" - "),
    };
  }
  return {
    count: 0,
    title: "No appointment tools",
    detail: "Connect calendar-backed availability and booking tools",
  };
}

function appointmentDurationsText(value: unknown): string {
  if (!Array.isArray(value)) return "30, 60";
  const durations = value
    .map((item) => {
      if (typeof item === "number") return item;
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const raw = record.duration_minutes ?? record.duration;
      return typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(raw, 10) : null;
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  return durations.length ? durations.join(", ") : "30, 60";
}

function providerLabel(provider: string | undefined): string {
  const labels: Record<string, string> = {
    google_calendar: "Google Calendar",
    cal_com: "Cal.com",
    gohighlevel: "GoHighLevel",
    notes: "Notes",
  };
  return labels[provider ?? ""] ?? provider ?? "Calendar";
}

function knowledgeRowId(row: KnowledgeBaseRow): string {
  return row.id ?? row._id ?? (row.localIndex === undefined ? "" : `local-${row.localIndex}`);
}

function parseKnowledgeCorpusMap(value: string | undefined): Record<string, string> {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] =>
        typeof entry[0] === "string" &&
        typeof entry[1] === "string" &&
        entry[1].trim().length > 0,
      ),
    );
  } catch {
    return {};
  }
}

function stringifyKnowledgeCorpusMap(value: Record<string, string>): string {
  const entries = Object.entries(value).filter(([, corpusId]) => corpusId.trim());
  return entries.length ? JSON.stringify(Object.fromEntries(entries)) : "";
}

function rowUltravoxCorpusId(row: KnowledgeBaseRow, map: Record<string, string>): string {
  const rowId = knowledgeRowId(row);
  return (
    row.ultravox_corpus_id ??
    row.ultravoxCorpusId ??
    (rowId ? map[rowId] : "") ??
    ""
  ).trim();
}

function knowledgeRowTitle(row: KnowledgeBaseRow): string {
  return row.title ?? row.name ?? "Untitled knowledge";
}

function normalizeKnowledgeRows(value: unknown): KnowledgeBaseRow[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : value && typeof value === "object" && Array.isArray((value as { knowledgeBaseItems?: unknown }).knowledgeBaseItems)
        ? (value as { knowledgeBaseItems: unknown[] }).knowledgeBaseItems
        : value && typeof value === "object" && Array.isArray((value as { knowledge_base_items?: unknown }).knowledge_base_items)
          ? (value as { knowledge_base_items: unknown[] }).knowledge_base_items
          : [];
  return rows
    .map((row) => row && typeof row === "object" ? row as Record<string, unknown> : {})
    .map((record) => ({
      id: typeof record.id === "string" ? record.id : undefined,
      _id: typeof record._id === "string" ? record._id : undefined,
      name: typeof record.name === "string" ? record.name : undefined,
      title: typeof record.title === "string" ? record.title : undefined,
      type: typeof record.type === "string" ? record.type : undefined,
      content: typeof record.content === "string" ? record.content : null,
      description: typeof record.description === "string" ? record.description : null,
      website_url: typeof record.website_url === "string" ? record.website_url : null,
      file_path: typeof record.file_path === "string" ? record.file_path : null,
      processing_status: typeof record.processing_status === "string" ? record.processing_status : null,
      ultravox_corpus_id: typeof record.ultravox_corpus_id === "string" ? record.ultravox_corpus_id : typeof record.corpus_id === "string" ? record.corpus_id : null,
      ultravoxCorpusId: typeof record.ultravoxCorpusId === "string" ? record.ultravoxCorpusId : null,
      ultravoxCorpusCreated: typeof record.ultravoxCorpusCreated === "boolean" ? record.ultravoxCorpusCreated : undefined,
    }))
    .filter((row) => knowledgeRowId(row) || knowledgeRowTitle(row) !== "Untitled knowledge");
}

function localKnowledgeRows(value: string | undefined): KnowledgeBaseRow[] {
  return (value ?? "")
    .split(/\n\n---\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const name = entry.match(/^Name:\s*(.+)$/m)?.[1]?.trim();
      const files = entry.match(/^Files:\s*(.+)$/m)?.[1]?.trim();
      const urls = entry.match(/^URLs:\s*(.+)$/m)?.[1]?.trim();
      return {
        id: `local-${index}`,
        localIndex: index,
        title: name || `Knowledge ${index + 1}`,
        type: urls ? "website" : files ? "document" : "text",
        content: entry,
        file_path: files || null,
        website_url: urls || null,
      };
    });
}

function knowledgeSummary(rows: KnowledgeBaseRow[], fallback: string | undefined): { count: number; title: string; detail: string } {
  if (rows.length > 0) {
    const latest = rows[0];
    return {
      count: rows.length,
      title: rows.length === 1 ? "1 knowledge source" : `${rows.length} knowledge sources`,
      detail: latest.file_path
        ? `${knowledgeRowTitle(latest)} - ${latest.file_path}`
        : latest.website_url
          ? `${knowledgeRowTitle(latest)} - ${latest.website_url}`
          : knowledgeRowTitle(latest),
    };
  }
  const localRows = localKnowledgeRows(fallback);
  if (localRows.length > 0) {
    const latest = localRows[0];
    return {
      count: localRows.length,
      title: localRows.length === 1 ? "1 local knowledge note" : `${localRows.length} local knowledge notes`,
      detail: latest.file_path
        ? `${knowledgeRowTitle(latest)} - ${latest.file_path}`
        : latest.website_url
          ? `${knowledgeRowTitle(latest)} - ${latest.website_url}`
          : knowledgeRowTitle(latest),
    };
  }
  return {
    count: 0,
    title: "No knowledge added",
    detail: "Add documents, URLs, or notes this agent should use",
  };
}

function customToolsSummary(value: string | undefined): { count: number; title: string; detail: string } {
  const notes = customToolNotes(value);
  if (notes.length > 0) {
    return {
      count: notes.length,
      title: notes.length === 1 ? "1 custom tool" : `${notes.length} custom tools`,
      detail: notes[0].replace(/\s+/g, " ").slice(0, 120),
    };
  }
  return {
    count: 0,
    title: "No custom tools",
    detail: "Add HTTP/API tools this agent can call",
  };
}

function webhookNotes(value: string | undefined): string[] {
  const raw = (value ?? "").trim();
  if (!raw) return [];
  return raw.split(/\n\n---\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function webhooksSummary(value: string | undefined): { count: number; title: string; detail: string } {
  const notes = webhookNotes(value);
  if (notes.length > 0) {
    return {
      count: notes.length,
      title: notes.length === 1 ? "1 webhook" : `${notes.length} webhooks`,
      detail: notes[0].replace(/\s+/g, " ").slice(0, 120),
    };
  }
  return {
    count: 0,
    title: "No webhooks",
    detail: "Add webhook URLs and event rules",
  };
}

function remoteWebhookRows(value: unknown): WebhookRow[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { webhooks?: unknown }).webhooks)
      ? (value as { webhooks: unknown[] }).webhooks
      : value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
        ? (value as { items: unknown[] }).items
        : value && typeof value === "object" && Array.isArray((value as { results?: unknown }).results)
          ? (value as { results: unknown[] }).results
          : [];
  return rows
    .map((row) => row && typeof row === "object" ? row as Record<string, unknown> : {})
    .map((record) => ({
      id: typeof record.id === "string" ? record.id : undefined,
      _id: typeof record._id === "string" ? record._id : undefined,
      url: typeof record.url === "string" ? record.url : undefined,
      events: record.events,
      agent_id: typeof record.agent_id === "string" ? record.agent_id : record.agent_id === null ? null : undefined,
      agentId: typeof record.agentId === "string" ? record.agentId : record.agentId === null ? null : undefined,
    }))
    .filter((row) => Boolean(row.url));
}

function webhookEntriesFromRemote(value: unknown, agentName: string): string[] {
  return remoteWebhookRows(value).map((row) => {
    const allowed = new Set(WEBHOOK_EVENTS.map((eventType) => eventType.value));
    const events = Array.isArray(row.events)
      ? row.events
        .map((eventType) => String(eventType).trim())
        .filter((eventType): eventType is WebhookEventType => allowed.has(eventType as WebhookEventType))
      : [];
    return formatWebhookEntry({
      id: row.id ?? row._id,
      url: row.url ?? "",
      events: events.length > 0 ? events : ["call.ended"],
      scope: row.agent_id || row.agentId ? agentName : "Global",
      secret: "",
    });
  });
}

function webhookTitle(note: string): string {
  return note.match(/^Destination URL:\s*(.+)$/m)?.[1]?.trim() || note.split(/\r?\n/)[0]?.trim() || "Webhook";
}

function webhookDetail(note: string): string {
  const events = note.match(/^Events:\s*(.+)$/m)?.[1]?.trim();
  const scope = note.match(/^Scope:\s*(.+)$/m)?.[1]?.trim();
  return [events, scope].filter(Boolean).join(" - ") || "Webhook event rule";
}

function webhookIdFromNote(note: string): string {
  return note.match(/^Webhook ID:\s*(.+)$/m)?.[1]?.trim() || "";
}

function webhookEventsFromNote(note: string): WebhookEventType[] {
  const allowed = new Set(WEBHOOK_EVENTS.map((eventType) => eventType.value));
  const events = note.match(/^Events:\s*(.+)$/m)?.[1]
    ?.split(",")
    .map((eventType) => eventType.trim())
    .filter((eventType): eventType is WebhookEventType => allowed.has(eventType as WebhookEventType)) ?? [];
  return events.length > 0 ? events : ["call.ended"];
}

function webhookScopeFromNote(note: string): string {
  const scope = note.match(/^Scope:\s*(.+)$/m)?.[1]?.trim();
  return scope?.toLowerCase() === "global" ? "global" : "agent";
}

function webhookSecretFromNote(note: string): string {
  return note.match(/^Secret:\s*(.+)$/m)?.[1]?.trim() || "";
}

function createdWebhookId(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const direct = record.id ?? record._id;
  if (typeof direct === "string") return direct;
  const webhook = record.webhook;
  if (webhook && typeof webhook === "object") {
    const nested = (webhook as Record<string, unknown>).id ?? (webhook as Record<string, unknown>)._id;
    if (typeof nested === "string") return nested;
  }
  return "";
}

function formatWebhookEntry({
  id,
  url,
  events,
  scope,
  secret,
}: {
  id?: string;
  url: string;
  events: WebhookEventType[];
  scope: string;
  secret: string;
}): string {
  return [
    id ? `Webhook ID: ${id}` : "",
    `Destination URL: ${url}`,
    `Events: ${events.join(", ")}`,
    `Scope: ${scope}`,
    secret ? `Secret: ${secret}` : "",
  ].filter(Boolean).join("\n");
}

function customCrmSummary(value: string | undefined): { title: string; detail: string } {
  const crm = (value ?? "").trim();
  const providers = customCrmProviderLabels(value);
  if (providers.length > 0) {
    return {
      title: providers.length === 1 ? "1 custom CRM" : `${providers.length} custom CRMs`,
      detail: providers.join(", "),
    };
  }
  if (crm) {
    return {
      title: "Custom CRM configured",
      detail: crm.replace(/\s+/g, " ").slice(0, 120),
    };
  }
  return {
    title: "No custom CRM",
    detail: "Add CRM provider settings or integration notes",
  };
}

function customCrmProviderLabels(value: string | undefined): string[] {
  const lower = (value ?? "").toLowerCase();
  return CUSTOM_CRM_PROVIDERS
    .filter((provider) => lower.includes(`provider: ${provider.label.toLowerCase()}`) || lower.includes(`provider id: ${provider.id}`))
    .map((provider) => provider.label);
}

function customCrmEntries(value: string | undefined): string[] {
  return (value ?? "")
    .split(/\n\n---\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function serializeEmailTemplateConfig(value: CustomCrmEmailTemplate): string {
  return JSON.stringify({
    to: value.to.trim() || DEFAULT_EMAIL_TEMPLATE.to,
    subject: value.subject,
    body: value.body,
  });
}

function parseEmailTemplateConfig(value: string | undefined): CustomCrmEmailTemplate {
  const raw = value?.match(/^Email Template JSON:\s*(\{.*\})$/m)?.[1];
  if (!raw) return DEFAULT_EMAIL_TEMPLATE;
  try {
    const parsed = JSON.parse(raw) as Partial<CustomCrmEmailTemplate>;
    return {
      to: typeof parsed.to === "string" && parsed.to.trim() ? parsed.to : DEFAULT_EMAIL_TEMPLATE.to,
      subject: typeof parsed.subject === "string" ? parsed.subject : "",
      body: typeof parsed.body === "string" ? parsed.body : "",
    };
  } catch {
    return DEFAULT_EMAIL_TEMPLATE;
  }
}

function customCrmProviderEntry(provider: CustomCrmProvider, emailTemplate?: CustomCrmEmailTemplate): string {
  const lines = [
    `Provider: ${provider.label}`,
    `Provider ID: ${provider.id}`,
    provider.detail,
  ];
  if (provider.id === "gmail") {
    lines.push(`Email Template JSON: ${serializeEmailTemplateConfig(emailTemplate ?? DEFAULT_EMAIL_TEMPLATE)}`);
  }
  return lines.join("\n");
}

function upsertCustomCrmProvider(value: string | undefined, provider: CustomCrmProvider, emailTemplate?: CustomCrmEmailTemplate): string {
  const entries = customCrmEntries(value).filter((entry) => {
    const lower = entry.toLowerCase();
    return !lower.includes(`provider id: ${provider.id}`) && !lower.includes(`provider: ${provider.label.toLowerCase()}`);
  });
  return [...entries, customCrmProviderEntry(provider, emailTemplate)].join("\n\n---\n");
}

function customToolTitle(note: string): string {
  return note.match(/^Tool Name:\s*(.+)$/m)?.[1]?.trim() || note.match(/^Name:\s*(.+)$/m)?.[1]?.trim() || note.split(/\r?\n/)[0]?.trim() || "Custom tool";
}

function customToolDetail(note: string): string {
  const method = note.match(/^HTTP Method:\s*(.+)$/m)?.[1]?.trim();
  const url = note.match(/^Base URL Pattern:\s*(.+)$/m)?.[1]?.trim();
  const description = note.match(/^Description:\s*(.+)$/m)?.[1]?.trim();
  return [method, url].filter(Boolean).join(" ") || description || "HTTP/API tool";
}

function formatCustomToolEntry({
  name,
  modelName,
  description,
  baseUrl,
  method,
  timeout,
  parameters,
  endBehavior,
  staticResponse,
}: {
  name: string;
  modelName: string;
  description: string;
  baseUrl: string;
  method: string;
  timeout: string;
  parameters: CustomToolParameter[];
  endBehavior: string;
  staticResponse: boolean;
}): string {
  const lines = [
    `Tool Name: ${name}`,
    modelName ? `Model Tool Name: ${modelName}` : "",
    description ? `Description: ${description}` : "",
    `Base URL Pattern: ${baseUrl}`,
    `HTTP Method: ${method}`,
    `Timeout: ${timeout}`,
    `Agent End Behavior: ${endBehavior}`,
    `Static Response: ${staticResponse ? "Enabled" : "Disabled"}`,
  ].filter(Boolean);
  if (parameters.length > 0) {
    lines.push("Parameters:");
    for (const parameter of parameters) {
      lines.push(
        `- ${parameter.name} (${parameter.kind}, ${parameter.location}, ${parameter.valueType}, ${parameter.required ? "required" : "optional"})${parameter.description ? `: ${parameter.description}` : ""}`,
      );
    }
  } else {
    lines.push("Parameters: none");
  }
  return lines.join("\n");
}

function withoutKnowledgeEntry(value: string | undefined, row: KnowledgeBaseRow, rowId: string): string {
  const title = knowledgeRowTitle(row).trim().toLowerCase();
  const filePath = row.file_path?.trim().toLowerCase() ?? "";
  const websiteUrl = row.website_url?.trim().toLowerCase() ?? "";
  const ids = (rowId ? [rowId] : []).concat(row.id ?? [], row._id ?? []).map((id) => id.trim()).filter(Boolean);
  const entries = (value ?? "").split(/\n\n---\n/).map((entry) => entry.trim()).filter(Boolean);
  const filtered = entries.filter((entry) => {
    const lower = entry.toLowerCase();
    if (ids.some((id) => lower.includes(id.toLowerCase()))) return false;
    if (title && lower.includes(`name: ${title}`)) return false;
    if (filePath && lower.includes(filePath)) return false;
    if (websiteUrl && lower.includes(websiteUrl)) return false;
    return true;
  });
  return filtered.join("\n\n---\n");
}

interface PreparedKnowledgeFile {
  name: string;
  content: string;
  error?: string;
}

function decodeXmlText(xml: string): string {
  const body = xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

async function inflateZipEntry(bytes: Uint8Array): Promise<Uint8Array> {
  const payload = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(payload).set(bytes);
  const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function extractDocxText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoder = new TextDecoder();
  let eocdOffset = -1;
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + index, 4);
    if (view.getUint32(0, true) === 0x06054b50) {
      eocdOffset = index;
      break;
    }
  }
  if (eocdOffset < 0) return "";
  const eocd = new DataView(bytes.buffer, bytes.byteOffset + eocdOffset);
  const centralDirectorySize = eocd.getUint32(12, true);
  const centralDirectoryOffset = eocd.getUint32(16, true);
  let offset = centralDirectoryOffset;
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  while (offset + 46 <= centralDirectoryEnd && offset + 46 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    if (view.getUint32(0, true) !== 0x02014b50) break;
    const compression = view.getUint16(10, true);
    const compressedSize = view.getUint32(20, true);
    const uncompressedSize = view.getUint32(24, true);
    const fileNameLength = view.getUint16(28, true);
    const extraLength = view.getUint16(30, true);
    const commentLength = view.getUint16(32, true);
    const localHeaderOffset = view.getUint32(42, true);
    const nameStart = offset + 46;
    const fileName = decoder.decode(bytes.slice(nameStart, nameStart + fileNameLength));
    if (fileName === "word/document.xml") {
      const local = new DataView(bytes.buffer, bytes.byteOffset + localHeaderOffset);
      if (local.getUint32(0, true) !== 0x04034b50) return "";
      const localNameLength = local.getUint16(26, true);
      const localExtraLength = local.getUint16(28, true);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      const compressed = bytes.slice(dataStart, dataEnd);
      const data = compression === 0
        ? compressed
        : compression === 8
          ? await inflateZipEntry(compressed)
          : new Uint8Array();
      const xml = decoder.decode(data.slice(0, uncompressedSize || undefined));
      return decodeXmlText(xml);
    }
    offset = nameStart + fileNameLength + extraLength + commentLength;
  }
  return "";
}

async function prepareKnowledgeFile(file: File): Promise<PreparedKnowledgeFile> {
  try {
    if (/\.(txt|md)$/i.test(file.name) || /^text\//i.test(file.type)) {
      return { name: file.name, content: (await file.text()).trim() };
    }
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      const { extractPdfText } = await import("@/lib/knowledge-pdf");
      return { name: file.name, content: await extractPdfText(new Uint8Array(await file.arrayBuffer())) };
    }
    if (/\.docx$/i.test(file.name)) {
      const content = (await extractDocxText(file)).trim();
      return {
        name: file.name,
        content,
        error: content ? undefined : "No text could be extracted from this DOCX file.",
      };
    }
    return {
      name: file.name,
      content: "",
      error: "Only PDF, TXT, MD, and DOCX files can be imported. Convert this file to a supported format first.",
    };
  } catch (caught) {
    return {
      name: file.name,
      content: "",
      error: caught instanceof Error ? caught.message : String(caught),
    };
  }
}

function AgentConfigurationFields({
  config,
  onChange,
  agentName,
  remoteAgentId,
}: {
  config: AgentProfileConfig | undefined;
  onChange: (config: AgentProfileConfig) => void;
  agentName: string;
  remoteAgentId?: string;
}) {
  const [voicesOpen, setVoicesOpen] = useState(false);
  const [voiceOptions, setVoiceOptions] = useState<UltravoxVoiceOption[]>(() => cachedVoices() ?? []);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicesError, setVoicesError] = useState("");
  const [playingVoiceId, setPlayingVoiceId] = useState("");
  const [voicePreviewPaused, setVoicePreviewPaused] = useState(false);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceObjectUrlRef = useRef<string | null>(null);
  const [voiceSearch, setVoiceSearch] = useState("");
  const [voiceLanguage, setVoiceLanguage] = useState(ALL_LANGUAGES);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [addingKnowledge, setAddingKnowledge] = useState(false);
  const [knowledgeName, setKnowledgeName] = useState("");
  const [knowledgeDescription, setKnowledgeDescription] = useState("");
  const [knowledgeContentMode, setKnowledgeContentMode] = useState<"files" | "urls">("files");
  const [knowledgeFiles, setKnowledgeFiles] = useState<File[]>([]);
  const [preparedKnowledgeFiles, setPreparedKnowledgeFiles] = useState<PreparedKnowledgeFile[]>([]);
  const [knowledgeFilesLoading, setKnowledgeFilesLoading] = useState(false);
  const [knowledgeUrls, setKnowledgeUrls] = useState("");
  const [knowledgeSaving, setKnowledgeSaving] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState("");
  const [knowledgeRows, setKnowledgeRows] = useState<KnowledgeBaseRow[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeDeletingId, setKnowledgeDeletingId] = useState("");
  const [viewingKnowledge, setViewingKnowledge] = useState<KnowledgeBaseRow | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneOptions, setPhoneOptions] = useState<PhoneConfigOption[]>([]);
  const [phonesLoading, setPhonesLoading] = useState(false);
  const [phonesError, setPhonesError] = useState("");
  const [phoneSavingId, setPhoneSavingId] = useState("");
  const [forwardingOpen, setForwardingOpen] = useState(false);
  const [forwardingRows, setForwardingRows] = useState<CallForwardingRow[]>([]);
  const [forwardingLoading, setForwardingLoading] = useState(false);
  const [forwardingError, setForwardingError] = useState("");
  const [forwardingSaving, setForwardingSaving] = useState(false);
  const [forwardingDeletingId, setForwardingDeletingId] = useState("");
  const [forwardingPhoneInput, setForwardingPhoneInput] = useState("");
  const [forwardingLabelInput, setForwardingLabelInput] = useState("");
  const [appointmentsOpen, setAppointmentsOpen] = useState(false);
  const [customToolsOpen, setCustomToolsOpen] = useState(false);
  const [editingCustomToolIndex, setEditingCustomToolIndex] = useState<number | null>(null);
  const [customToolMenuIndex, setCustomToolMenuIndex] = useState<number | null>(null);
  const [customToolSaving, setCustomToolSaving] = useState(false);
  const [customToolSyncMessage, setCustomToolSyncMessage] = useState("");
  const [crmConnections, setCrmConnections] = useState<Record<string, { connected?: boolean }>>({});
  const [crmConnectionsLoading, setCrmConnectionsLoading] = useState(false);
  const [crmConnectionsError, setCrmConnectionsError] = useState("");
  const [crmConnectionRevision, setCrmConnectionRevision] = useState(0);
  const [customCrmOpen, setCustomCrmOpen] = useState(false);
  const [webhooksOpen, setWebhooksOpen] = useState(false);
  const [addingWebhook, setAddingWebhook] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<WebhookEventType[]>(["call.ended"]);
  const [webhookScope, setWebhookScope] = useState("agent");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [webhookError, setWebhookError] = useState("");
  const [webhookMenuIndex, setWebhookMenuIndex] = useState<number | null>(null);
  const [editingWebhookIndex, setEditingWebhookIndex] = useState<number | null>(null);
  const [webhookDeletingIndex, setWebhookDeletingIndex] = useState<number | null>(null);
  const [addingCustomCrmProvider, setAddingCustomCrmProvider] = useState(false);
  const [emailTemplateTo, setEmailTemplateTo] = useState(DEFAULT_EMAIL_TEMPLATE.to);
  const [emailTemplateSubject, setEmailTemplateSubject] = useState(DEFAULT_EMAIL_TEMPLATE.subject);
  const [emailTemplateBody, setEmailTemplateBody] = useState(DEFAULT_EMAIL_TEMPLATE.body);
  const [addingCustomTool, setAddingCustomTool] = useState(false);
  const [customToolStep, setCustomToolStep] = useState<CustomToolStep>("info");
  const [editingParameterIndex, setEditingParameterIndex] = useState<number | null>(null);
  const [parameterMenuIndex, setParameterMenuIndex] = useState<number | null>(null);
  const [addingCustomParameter, setAddingCustomParameter] = useState(false);
  const [customToolName, setCustomToolName] = useState("");
  const [customToolModelName, setCustomToolModelName] = useState("");
  const [customToolDescription, setCustomToolDescription] = useState("");
  const [customToolBaseUrl, setCustomToolBaseUrl] = useState("");
  const [customToolMethod, setCustomToolMethod] = useState("GET");
  const [customToolTimeout, setCustomToolTimeout] = useState("20s");
  const [customToolEndBehavior, setCustomToolEndBehavior] = useState("Default");
  const [customToolStaticResponse, setCustomToolStaticResponse] = useState(false);
  const [customToolParameters, setCustomToolParameters] = useState<CustomToolParameter[]>([]);
  const [customParameterKind, setCustomParameterKind] = useState<CustomToolParameterKind>("Dynamic");
  const [customParameterName, setCustomParameterName] = useState("");
  const [customParameterError, setCustomParameterError] = useState("");
  const customParameterNameRef = useRef<HTMLInputElement>(null);
  const [customParameterLocation, setCustomParameterLocation] = useState<CustomToolParameterLocation>("Body");
  const [customParameterDescription, setCustomParameterDescription] = useState("");
  const [customParameterValueType, setCustomParameterValueType] = useState<CustomToolParameterValueType>("String");
  const [customParameterRequired, setCustomParameterRequired] = useState(false);
  const [appointmentTools, setAppointmentTools] = useState<AppointmentToolRow[]>([]);
  const [calendarIntegrations, setCalendarIntegrations] = useState<CalendarIntegrationRow[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [appointmentsError, setAppointmentsError] = useState("");
  const [addingAppointment, setAddingAppointment] = useState(false);
  const [appointmentSaving, setAppointmentSaving] = useState(false);
  const [appointmentDeletingId, setAppointmentDeletingId] = useState("");
  const [appointmentMenuId, setAppointmentMenuId] = useState("");
  const [editingAppointmentTool, setEditingAppointmentTool] = useState<AppointmentToolRow | null>(null);
  const [appointmentName, setAppointmentName] = useState("");
  const [appointmentIntegrationId, setAppointmentIntegrationId] = useState("");
  const [appointmentDurations, setAppointmentDurations] = useState("30, 60");
  const current = { ...defaultAgentConfig, ...config };
  const displayAgentName = agentName.trim() || "Agent";
  const update = <K extends keyof AgentProfileConfig>(key: K, value: AgentProfileConfig[K]) => {
    onChange({ ...current, [key]: value });
  };
  const updateNumber = (key: "temperature" | "maxDuration", raw: string) => {
    if (raw.trim() === "") {
      const next = { ...current };
      delete next[key];
      onChange(next);
      return;
    }
    const value = key === "maxDuration" ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
    if (Number.isFinite(value)) update(key, value);
  };
  const resetKnowledgeForm = () => {
    setKnowledgeName("");
    setKnowledgeDescription("");
    setKnowledgeContentMode("files");
    setKnowledgeFiles([]);
    setPreparedKnowledgeFiles([]);
    setKnowledgeFilesLoading(false);
    setKnowledgeUrls("");
  };
  const closeKnowledge = () => {
    setKnowledgeOpen(false);
    setAddingKnowledge(false);
    setViewingKnowledge(null);
    resetKnowledgeForm();
  };
  const refreshKnowledgeRows = async () => {
    if (!remoteAgentId) {
      setKnowledgeRows(localKnowledgeRows(current.knowledgeBase));
      return;
    }
    const result = await api(`/api/platform/agents/${encodeURIComponent(remoteAgentId)}/knowledge-base`) as { items?: unknown };
    setKnowledgeRows(normalizeKnowledgeRows(result.items));
  };
  const selectedPhone = phoneOptions.find((phone) => phone.id === current.phoneNumberId || phone.phoneNumber === current.phoneNumber);
  const knowledgeDisplay = knowledgeSummary(knowledgeRows, current.knowledgeBase);
  const forwardingDisplay = forwardingSummary(forwardingRows, current.callForwarding);
  const appointmentDisplay = appointmentToolSummary(appointmentTools, remoteAgentId ? undefined : current.appointmentTools);
  const customToolsDisplay = customToolsSummary(current.customTools);
  const customCrmDisplay = customCrmSummary(current.customCrm);
  const webhooksDisplay = webhooksSummary(current.webhooks);
  const webhookEntries = webhookNotes(current.webhooks);
  const selectedCustomCrmProviders = customCrmProviderLabels(current.customCrm);
  const emailCrmProvider = CUSTOM_CRM_PROVIDERS.find((provider) => provider.id === "gmail");
  const emailCrmEnabled = selectedCustomCrmProviders.includes("Email");
  const customToolEntries = customToolNotes(current.customTools);
  const crmConnected = (providerId: string) => Boolean(crmConnections[providerId]?.connected || crmConnections[providerId.replace("google_", "google")]?.connected);
  useEffect(() => {
    if (!customCrmOpen) return;
    const controller = new AbortController();
    setCrmConnectionsLoading(true); setCrmConnectionsError(""); setCrmConnections({});
    api("/api/connectors/connected", { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setCrmConnections(result.services ?? {});
    }).catch((error) => { if (!controller.signal.aborted) setCrmConnectionsError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setCrmConnectionsLoading(false); });
    return () => controller.abort();
  }, [customCrmOpen, crmConnectionRevision]);
  const customToolCurrentStepIndex = CUSTOM_TOOL_STEP_INDEX[customToolStep];
  const resetCustomParameterForm = () => {
    setEditingParameterIndex(null);
    setParameterMenuIndex(null);
    setCustomParameterError("");
    setCustomParameterKind("Dynamic");
    setCustomParameterName("");
    setCustomParameterLocation("Body");
    setCustomParameterDescription("");
    setCustomParameterValueType("String");
    setCustomParameterRequired(false);
  };
  const resetCustomToolForm = () => {
    setEditingCustomToolIndex(null);
    setCustomToolStep("info");
    setAddingCustomParameter(false);
    setCustomToolName("");
    setCustomToolModelName("");
    setCustomToolDescription("");
    setCustomToolBaseUrl("");
    setCustomToolMethod("GET");
    setCustomToolTimeout("20s");
    setCustomToolEndBehavior("Default");
    setCustomToolStaticResponse(false);
    setCustomToolParameters([]);
    resetCustomParameterForm();
  };
  const closeCustomTools = () => {
    if (customToolSaving) return;
    setCustomToolsOpen(false);
    setAddingCustomTool(false);
    resetCustomToolForm();
  };
  const closeCustomCrm = () => {
    setCustomCrmOpen(false);
    setAddingCustomCrmProvider(false);
  };
  const resetWebhookForm = () => {
    setWebhookUrl("");
    setWebhookEvents(["call.ended"]);
    setWebhookScope("agent");
    setWebhookSecret("");
    setWebhookSaving(false);
    setWebhookError("");
    setWebhookMenuIndex(null);
    setEditingWebhookIndex(null);
    setWebhookDeletingIndex(null);
  };
  const closeWebhooks = () => {
    setWebhooksOpen(false);
    setAddingWebhook(false);
    resetWebhookForm();
  };
  const openAddWebhook = () => {
    resetWebhookForm();
    setAddingWebhook(true);
  };
  const openEditWebhook = (entry: string, index: number) => {
    setWebhookUrl(webhookTitle(entry));
    setWebhookEvents(webhookEventsFromNote(entry));
    setWebhookScope(webhookScopeFromNote(entry));
    setWebhookSecret(webhookSecretFromNote(entry));
    setWebhookError("");
    setWebhookMenuIndex(null);
    setEditingWebhookIndex(index);
    setAddingWebhook(true);
  };
  const deleteWebhook = async (entry: string, index: number) => {
    setWebhookDeletingIndex(index);
    setWebhookMenuIndex(null);
    setWebhookError("");
    try {
      if (remoteAgentId) {
        const webhookId = webhookIdFromNote(entry);
        const path = webhookId
          ? `/api/platform/agents/${encodeURIComponent(remoteAgentId)}/webhooks/${encodeURIComponent(webhookId)}`
          : `/api/platform/agents/${encodeURIComponent(remoteAgentId)}/webhooks/by-url`;
        await api(path, {
          method: "DELETE",
          body: JSON.stringify({
            url: webhookTitle(entry),
            events: webhookEventsFromNote(entry),
            scope: webhookScopeFromNote(entry),
          }),
        });
      }
      const nextEntries = webhookEntries.filter((_, entryIndex) => entryIndex !== index);
      update("webhooks", nextEntries.join("\n\n---\n"));
      if (editingWebhookIndex === index) resetWebhookForm();
    } catch (caught) {
      setWebhookError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setWebhookDeletingIndex(null);
    }
  };
  const toggleWebhookEvent = (eventType: WebhookEventType) => {
    setWebhookEvents((events) => {
      if (events.includes(eventType)) return events.filter((event) => event !== eventType);
      return [...events, eventType];
    });
  };
  const saveWebhook = async () => {
    const url = webhookUrl.trim();
    if (!url || webhookEvents.length === 0) return;
    setWebhookSaving(true);
    setWebhookError("");
    try {
      let syncError = "";
      let createdId = editingWebhookIndex !== null ? webhookIdFromNote(webhookEntries[editingWebhookIndex] ?? "") : "";
      if (remoteAgentId) {
        const previousEntry = editingWebhookIndex !== null ? webhookEntries[editingWebhookIndex] : "";
        const editingPath = createdId
          ? `/api/platform/agents/${encodeURIComponent(remoteAgentId)}/webhooks/${encodeURIComponent(createdId)}`
          : `/api/platform/agents/${encodeURIComponent(remoteAgentId)}/webhooks/by-url`;
        const result = await api(editingWebhookIndex === null ? `/api/platform/agents/${encodeURIComponent(remoteAgentId)}/webhooks` : editingPath, {
          method: editingWebhookIndex === null ? "POST" : "PATCH",
          body: JSON.stringify({
            name: url,
            url,
            events: webhookEvents,
            scope: webhookScope,
            secret: webhookSecret.trim() || null,
            previous_url: previousEntry ? webhookTitle(previousEntry) : undefined,
            previous_scope: previousEntry ? webhookScopeFromNote(previousEntry) : undefined,
          }),
        }) as { syncError?: string };
        syncError = result.syncError ?? "";
        createdId = createdWebhookId(result) || createdId;
      }
      const entry = formatWebhookEntry({
        id: createdId,
        url,
        events: webhookEvents,
        scope: webhookScope === "global" ? "Global" : displayAgentName,
        secret: webhookSecret.trim(),
      });
      const nextEntries = [...webhookEntries];
      if (editingWebhookIndex !== null && nextEntries[editingWebhookIndex]) {
        nextEntries[editingWebhookIndex] = entry;
      } else {
        nextEntries.push(entry);
      }
      update("webhooks", nextEntries.join("\n\n---\n"));
      setAddingWebhook(false);
      resetWebhookForm();
      if (syncError) setWebhookError(`Webhook saved, but Ultravox sync failed: ${syncError}`);
    } catch (caught) {
      setWebhookError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setWebhookSaving(false);
    }
  };
  const addCustomCrmProvider = (provider: CustomCrmProvider) => {
    if (!crmConnected(provider.id)) return;
    if (selectedCustomCrmProviders.includes(provider.label)) {
      setAddingCustomCrmProvider(false);
      return;
    }
    update("customCrm", upsertCustomCrmProvider(current.customCrm, provider));
    setAddingCustomCrmProvider(false);
  };
  const saveEmailTemplate = () => {
    if (!emailCrmProvider) return;
    update("customCrm", upsertCustomCrmProvider(current.customCrm, emailCrmProvider, {
      to: emailTemplateTo,
      subject: emailTemplateSubject,
      body: emailTemplateBody,
    }));
  };
  const openAddCustomTool = () => {
    if (customToolSaving) return;
    setCustomToolMenuIndex(null);
    setCustomToolSyncMessage("");
    resetCustomToolForm();
    setAddingCustomTool(true);
  };
  const saveCustomParameter = () => {
    const name = customParameterName.trim();
    if (!name) {
      setCustomParameterError("Enter a parameter name before saving.");
      customParameterNameRef.current?.focus();
      return;
    }
    if (customToolParameters.some((parameter, index) => index !== editingParameterIndex && parameter.name === name)) {
      setCustomParameterError("A parameter with this name already exists.");
      customParameterNameRef.current?.focus();
      return;
    }
    const parameter: CustomToolParameter = {
      kind: customParameterKind, name, location: customParameterLocation,
      description: customParameterDescription.trim(), valueType: customParameterValueType,
      required: customParameterRequired,
    };
    setCustomToolParameters((parameters) => editingParameterIndex === null
      ? [...parameters, parameter]
      : parameters.map((saved, index) => index === editingParameterIndex ? parameter : saved));
    resetCustomParameterForm();
    setAddingCustomParameter(false);
  };
  const editCustomParameter = (parameter: CustomToolParameter, index: number) => {
    resetCustomParameterForm();
    setEditingParameterIndex(index);
    setCustomParameterKind(parameter.kind);
    setCustomParameterName(parameter.name);
    setCustomParameterLocation(parameter.location);
    setCustomParameterDescription(parameter.description);
    setCustomParameterValueType(parameter.valueType);
    setCustomParameterRequired(parameter.required);
    setAddingCustomParameter(true);
  };
  const editCustomTool = (entry: string, index: number) => {
    resetCustomToolForm();
    const field = (label: string) => entry.split(/\r?\n/).find((line) => line.startsWith(`${label}:`))?.slice(label.length + 1).trim() ?? "";
    setEditingCustomToolIndex(index);
    setCustomToolMenuIndex(null);
    setCustomToolSyncMessage("");
    setCustomToolName(field("Tool Name"));
    setCustomToolModelName(field("Model Tool Name"));
    setCustomToolDescription(field("Description"));
    setCustomToolBaseUrl(field("Base URL Pattern"));
    setCustomToolMethod(field("HTTP Method") || "POST");
    setCustomToolTimeout(field("Timeout") || "20s");
    setCustomToolEndBehavior(field("Agent End Behavior") || "Default");
    setCustomToolStaticResponse(field("Static Response") === "Enabled");
    setCustomToolParameters(entry.split(/\r?\n/).flatMap((line): CustomToolParameter[] => {
      const match = line.match(/^- (.+) \(([^,]+), ([^,]+), ([^,]+), (required|optional)\)(?:: (.*))?$/);
      return match ? [{ name: match[1], kind: match[2] as CustomToolParameterKind, location: match[3] as CustomToolParameterLocation, valueType: match[4] as CustomToolParameterValueType, required: match[5] === "required", description: match[6] ?? "" }] : [];
    }));
    setAddingCustomTool(true);
  };
  const deleteCustomTool = async (entry: string, index: number) => {
    if (customToolSaving) return;
    setCustomToolMenuIndex(null);
    setCustomToolSaving(true);
    setCustomToolSyncMessage("");
    try {
      if (!remoteAgentId) throw new Error("Connect this bot to its hosted agent before deleting the tool.");
      await api(`/api/platform/agents/${encodeURIComponent(remoteAgentId)}/custom-tools`, { method: "DELETE", body: JSON.stringify({ entry }) });
      update("customTools", customToolEntries.filter((_, i) => i !== index).join("\n\n---\n"));
      setCustomToolSyncMessage("Tool deleted from the backend and Ultravox.");
    } catch (error) { setCustomToolSyncMessage(error instanceof Error ? error.message : String(error)); }
    finally { setCustomToolSaving(false); }
  };
  const syncCustomTool = async (entry: string, previousEntry?: string) => {
    if (!remoteAgentId) throw new Error("Connect this bot to a hosted agent before creating a tool.");
    await api(`/api/platform/agents/${encodeURIComponent(remoteAgentId)}/custom-tools`, { method: previousEntry ? "PATCH" : "POST", body: JSON.stringify({ entry, previousEntry }) });
  };
  const retryCustomToolSync = async (entry: string) => {
    setCustomToolSaving(true);
    setCustomToolSyncMessage("");
    try {
      await syncCustomTool(entry);
      setCustomToolSyncMessage("Tool saved in Ultravox and assigned to this agent.");
    } catch (error) {
      setCustomToolSyncMessage(error instanceof Error ? error.message : String(error));
    } finally { setCustomToolSaving(false); }
  };
  const createCustomTool = async () => {
    if (customToolSaving) return;
    const name = customToolName.trim();
    const baseUrl = customToolBaseUrl.trim();
    if (!name || !baseUrl) return;
    const entry = formatCustomToolEntry({
      name,
      modelName: customToolModelName.trim(),
      description: customToolDescription.trim(),
      baseUrl,
      method: customToolMethod,
      timeout: customToolTimeout.trim() || "20s",
      parameters: customToolParameters,
      endBehavior: customToolEndBehavior,
      staticResponse: customToolStaticResponse,
    });
    setCustomToolSaving(true);
    setCustomToolSyncMessage("");
    try {
      await syncCustomTool(entry, editingCustomToolIndex !== null ? customToolEntries[editingCustomToolIndex] : undefined);
      const existing = (current.customTools ?? "").trim();
      update("customTools", editingCustomToolIndex !== null ? customToolEntries.map((saved, index) => index === editingCustomToolIndex ? entry : saved).join("\n\n---\n") : existing ? `${existing}\n\n---\n${entry}` : entry);
      setAddingCustomTool(false);
      resetCustomToolForm();
      setCustomToolSyncMessage("Tool saved in Ultravox and assigned to this agent.");
    } catch (error) {
      setCustomToolSyncMessage(error instanceof Error ? error.message : String(error));
    } finally { setCustomToolSaving(false); }
  };
  const goNextCustomToolStep = () => {
    if (addingCustomParameter) {
      saveCustomParameter();
      return;
    }
    if (customToolStep === "info") setCustomToolStep("integration");
    else if (customToolStep === "integration") setCustomToolStep("parameters");
    else if (customToolStep === "parameters") setCustomToolStep("advanced");
    else createCustomTool();
  };
  const goBackCustomToolStep = () => {
    if (addingCustomParameter) {
      setAddingCustomParameter(false);
      resetCustomParameterForm();
      return;
    }
    if (customToolStep === "advanced") setCustomToolStep("parameters");
    else if (customToolStep === "parameters") setCustomToolStep("integration");
    else if (customToolStep === "integration") setCustomToolStep("info");
    else {
      setAddingCustomTool(false);
      resetCustomToolForm();
    }
  };
  const customToolNextDisabled =
    (customToolStep === "info" && !customToolName.trim()) ||
    (customToolStep === "integration" && !customToolBaseUrl.trim()) ||
    (addingCustomParameter && !customParameterName.trim());
  const knowledgeCanSubmit =
    Boolean(knowledgeName.trim()) &&
    !knowledgeSaving &&
    !knowledgeFilesLoading &&
    (knowledgeContentMode === "files" || Boolean(knowledgeUrls.trim()));
  const addKnowledge = async () => {
    const name = knowledgeName.trim();
    if (!name) return;
    setKnowledgeSaving(true);
    setKnowledgeError("");
    const description = knowledgeDescription.trim();
    const urls = knowledgeUrls
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean);
    const createdIds: string[] = [];
    const corpusMap = parseKnowledgeCorpusMap(current.knowledgeBaseCorpusMap);
    try {
      if (remoteAgentId) {
        if (knowledgeContentMode === "urls") {
          const targets = urls.length ? urls : [""];
          for (const [index, websiteUrl] of targets.entries()) {
            const result = await api(`/api/platform/agents/${encodeURIComponent(remoteAgentId)}/knowledge-base`, {
              method: "POST",
              body: JSON.stringify({
                title: targets.length > 1 ? `${name} ${index + 1}` : name,
                type: websiteUrl ? "website" : "text",
                content: websiteUrl ? description || null : description || name,
                website_url: websiteUrl || null,
                description: description || null,
              }),
            }) as { item?: KnowledgeBaseRow; syncError?: string; ultravoxError?: string; ultravoxKnowledge?: { corpusId?: string }; ultravoxCorpusCreated?: boolean };
            const id = result.item?.id ?? result.item?._id;
            if (id) createdIds.push(id);
            const corpusId = result.ultravoxKnowledge?.corpusId;
            if (id && corpusId) corpusMap[id] = corpusId;
            if (result.ultravoxError) setKnowledgeError(`Knowledge saved, but Ultravox corpus was not created: ${result.ultravoxError}`);
            else if (result.syncError) setKnowledgeError(`Knowledge saved, but agent sync failed: ${result.syncError}`);
          }
        } else {
          const textFiles = preparedKnowledgeFiles.length
            ? preparedKnowledgeFiles
            : await Promise.all(knowledgeFiles.map((file) => prepareKnowledgeFile(file)));
          const unreadableFiles = textFiles.filter((file) => file.error || !file.content.trim());
          if (unreadableFiles.length) {
            throw new Error(`Knowledge was not uploaded. These files could not be read: ${unreadableFiles.map((file) => file.name).join(", ")}. Use PDF, TXT, MD, or DOCX files containing text.`);
          }
          if (!textFiles.length && !description) {
            throw new Error("Add a readable knowledge file or a text description before saving.");
          }
          const filePath = textFiles.length ? textFiles.map((file) => file.name).join(", ") : null;
          const content = [
            description,
            filePath ? `Files: ${filePath}` : "",
            ...textFiles
              .filter((file) => file.content.trim())
              .map((file) => `## ${file.name}\n${file.content.trim()}`),
          ].filter(Boolean).join("\n\n") || null;
          const result = await api(`/api/platform/agents/${encodeURIComponent(remoteAgentId)}/knowledge-base`, {
            method: "POST",
            body: JSON.stringify({
              title: name,
              type: textFiles.length ? "document" : "text",
              content,
              file_path: filePath,
              description: description || null,
            }),
          }) as { item?: KnowledgeBaseRow; syncError?: string; ultravoxError?: string; ultravoxKnowledge?: { corpusId?: string }; ultravoxCorpusCreated?: boolean };
          const id = result.item?.id ?? result.item?._id;
          if (id) createdIds.push(id);
          const corpusId = result.ultravoxKnowledge?.corpusId;
          if (id && corpusId) corpusMap[id] = corpusId;
          if (result.ultravoxError) setKnowledgeError(`Knowledge saved, but Ultravox corpus was not created: ${result.ultravoxError}`);
          else if (result.syncError) setKnowledgeError(`Knowledge saved, but agent sync failed: ${result.syncError}`);
        }
      } else {
        throw new Error("This bot is not connected to a hosted MagicTeams agent, so knowledge cannot sync to Ultravox.");
      }
      const files = knowledgeFiles.map((file) => file.name).join(", ");
      const parts = [
        `Name: ${name}`,
        description ? `Description: ${description}` : "",
        knowledgeContentMode === "files" && files ? `Files: ${files}` : "",
        knowledgeContentMode === "urls" && urls.length ? `URLs: ${urls.join(", ")}` : "",
        !remoteAgentId ? "Backend sync: unavailable for local-only bot" : "",
      ].filter(Boolean);
      const nextEntry = parts.join("\n");
      const existing = (current.knowledgeBase ?? "").trim();
      const existingIds = (current.knowledgeBaseIds ?? "").split(",").map((id) => id.trim()).filter(Boolean);
      onChange({
        ...current,
        knowledgeBase: existing ? `${existing}\n\n---\n${nextEntry}` : nextEntry,
        knowledgeBaseIds: [...existingIds, ...createdIds].join(","),
        knowledgeBaseCorpusMap: stringifyKnowledgeCorpusMap(corpusMap),
      });
      await refreshKnowledgeRows();
      setAddingKnowledge(false);
      resetKnowledgeForm();
    } catch (caught) {
      setKnowledgeError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setKnowledgeSaving(false);
    }
  };
  const deleteKnowledge = async (row: KnowledgeBaseRow) => {
    const rowId = knowledgeRowId(row);
    if (!rowId) return;
    setKnowledgeDeletingId(rowId);
    setKnowledgeError("");
    try {
      if (remoteAgentId && !rowId.startsWith("local-")) {
        const corpusMap = parseKnowledgeCorpusMap(current.knowledgeBaseCorpusMap);
        const corpusId = rowUltravoxCorpusId(row, corpusMap);
        const result = await api(`/api/platform/agents/${encodeURIComponent(remoteAgentId)}/knowledge-base/${encodeURIComponent(rowId)}`, {
          method: "DELETE",
          body: JSON.stringify({ ultravox_corpus_id: corpusId || null }),
        }) as { syncError?: string; ultravoxError?: string };
        const ids = (current.knowledgeBaseIds ?? "").split(",").map((id) => id.trim()).filter((id) => id && id !== rowId);
        delete corpusMap[rowId];
        const nextKnowledgeBase = withoutKnowledgeEntry(current.knowledgeBase, row, rowId);
        onChange({
          ...current,
          knowledgeBase: nextKnowledgeBase,
          knowledgeBaseIds: ids.join(","),
          knowledgeBaseCorpusMap: stringifyKnowledgeCorpusMap(corpusMap),
        });
        await refreshKnowledgeRows();
        if (result.ultravoxError) setKnowledgeError(`Knowledge deleted from MagicTeams, but Ultravox corpus delete failed: ${result.ultravoxError}`);
        else if (result.syncError) setKnowledgeError(`Knowledge deleted, but Ultravox sync failed: ${result.syncError}`);
      } else {
        const index = row.localIndex ?? Number.parseInt(rowId.replace("local-", ""), 10);
        const entries = (current.knowledgeBase ?? "").split(/\n\n---\n/).map((entry) => entry.trim()).filter(Boolean);
        entries.splice(index, 1);
        const nextKnowledgeBase = entries.join("\n\n---\n");
        update("knowledgeBase", nextKnowledgeBase);
        setKnowledgeRows(localKnowledgeRows(nextKnowledgeBase));
      }
      if (viewingKnowledge && knowledgeRowId(viewingKnowledge) === rowId) setViewingKnowledge(null);
    } catch (caught) {
      setKnowledgeError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setKnowledgeDeletingId("");
    }
  };
  const selectedVoice = voiceOptions.find((voice) => voice.voiceId === current.voices || voice.name === current.voices);
  const selectedVoiceDisplay = selectedVoice?.name ?? (
    looksLikeVoiceId(current.voices)
        ? "Saved voice"
        : current.voices ?? ""
  );
  const voiceLanguages = [
    ALL_LANGUAGES,
    ...Array.from(new Set(voiceOptions.map((voice) => voice.languageLabel || voice.primaryLanguage || "Unknown"))),
  ];
  const voiceQuery = voiceSearch.trim().toLowerCase();
  const filteredVoices = voiceOptions.filter((voice) => {
    const language = voice.languageLabel || voice.primaryLanguage || "Unknown";
    const languageMatch = voiceLanguage === ALL_LANGUAGES || language === voiceLanguage;
    const searchMatch =
      !voiceQuery ||
      voice.name.toLowerCase().includes(voiceQuery) ||
      voice.voiceId.toLowerCase().includes(voiceQuery) ||
      language.toLowerCase().includes(voiceQuery) ||
      (voice.provider ?? "").toLowerCase().includes(voiceQuery);
    return languageMatch && searchMatch;
  });
  const stopVoicePreview = () => {
    if (voiceAudioRef.current) {
      voiceAudioRef.current.pause();
      voiceAudioRef.current.src = "";
      voiceAudioRef.current = null;
    }
    if (voiceObjectUrlRef.current) {
      URL.revokeObjectURL(voiceObjectUrlRef.current);
      voiceObjectUrlRef.current = null;
    }
    setPlayingVoiceId("");
    setVoicePreviewPaused(false);
  };
  const playVoicePreview = async (voiceId: string) => {
    if (playingVoiceId === voiceId) {
      const audio = voiceAudioRef.current;
      if (!audio) {
        stopVoicePreview();
        return;
      }
      if (audio.paused) {
        setVoicesError("");
        try {
          await audio.play();
          setVoicePreviewPaused(false);
        } catch (caught) {
          setVoicesError(caught instanceof Error ? caught.message : String(caught));
          setVoicePreviewPaused(true);
        }
      } else {
        audio.pause();
        setVoicePreviewPaused(true);
      }
      return;
    }
    stopVoicePreview();
    setVoicesError("");
    setPlayingVoiceId(voiceId);
    setVoicePreviewPaused(false);
    try {
      const headers = new Headers();
      const token = betterAuthToken();
      if (token) headers.set("authorization", `Bearer ${token}`);
      const response = await fetch(`/api/ultravox/voices/${encodeURIComponent(voiceId)}/preview`, { headers });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : `Preview failed (${response.status})`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      voiceAudioRef.current = audio;
      voiceObjectUrlRef.current = objectUrl;
      audio.onended = stopVoicePreview;
      audio.onerror = () => {
        setVoicesError("That voice preview could not be played.");
        stopVoicePreview();
      };
      await audio.play();
      setVoicePreviewPaused(false);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "NotAllowedError") {
        setVoicesError("Allow audio playback in the browser, then try again.");
        stopVoicePreview();
        return;
      }
      setVoicesError(caught instanceof Error ? caught.message : String(caught));
      stopVoicePreview();
    }
  };
  useEffect(() => {
    if (!voicesOpen) stopVoicePreview();
  }, [voicesOpen]);
  useEffect(() => {
    if (!customCrmOpen) return;
    const template = parseEmailTemplateConfig(current.customCrm);
    setEmailTemplateTo(template.to);
    setEmailTemplateSubject(template.subject);
    setEmailTemplateBody(template.body);
  }, [customCrmOpen]);
  useEffect(() => {
    if (!webhooksOpen || addingWebhook || !remoteAgentId) return;
    let alive = true;
    setWebhooksLoading(true);
    setWebhookError("");
    api(`/api/platform/agents/${encodeURIComponent(remoteAgentId)}/webhooks`)
      .then((result: { webhooks?: unknown }) => {
        if (!alive) return;
        update("webhooks", webhookEntriesFromRemote(result.webhooks, displayAgentName).join("\n\n---\n"));
      })
      .catch((caught) => {
        if (alive) setWebhookError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (alive) setWebhooksLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [webhooksOpen, addingWebhook, remoteAgentId, displayAgentName]);
  useEffect(() => {
    if (!voicesOpen && !current.voices) return;
    let alive = true;
    setVoicesLoading(cachedVoices() === undefined);
    setVoicesError("");
    loadVoiceCatalog()
      .then((result: { voices?: UltravoxVoiceOption[]; error?: string }) => {
        if (!alive) return;
        setVoiceOptions(Array.isArray(result.voices) ? result.voices : []);
        setVoicesError(result.error ?? "");
      })
      .catch((caught) => alive && setVoicesError(caught instanceof Error ? caught.message : String(caught)))
      .finally(() => {
        if (alive) setVoicesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [voicesOpen, current.voices]);
  useEffect(() => {
    let alive = true;
    if (!remoteAgentId) {
      setKnowledgeRows(localKnowledgeRows(current.knowledgeBase));
      return () => {
        alive = false;
      };
    }
    api(`/api/platform/agents/${encodeURIComponent(remoteAgentId)}/knowledge-base`)
      .then((result: { items?: unknown }) => {
        if (alive) setKnowledgeRows(normalizeKnowledgeRows(result.items));
      })
      .catch(() => {
        if (alive) setKnowledgeRows([]);
      });
    return () => {
      alive = false;
    };
  }, [remoteAgentId, current.knowledgeBase]);
  useEffect(() => {
    if (!knowledgeOpen || addingKnowledge || viewingKnowledge) return;
    let alive = true;
    setKnowledgeLoading(true);
    const load = async () => {
      try {
        if (!remoteAgentId) {
          if (alive) setKnowledgeRows(localKnowledgeRows(current.knowledgeBase));
          return;
        }
        const result = await api(`/api/platform/agents/${encodeURIComponent(remoteAgentId)}/knowledge-base`) as { items?: unknown };
        if (alive) setKnowledgeRows(normalizeKnowledgeRows(result.items));
      } catch (caught) {
        if (alive) setKnowledgeError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (alive) setKnowledgeLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [knowledgeOpen, addingKnowledge, viewingKnowledge, remoteAgentId, current.knowledgeBase]);
  useEffect(() => {
    if (knowledgeFiles.length === 0) {
      setPreparedKnowledgeFiles([]);
      setKnowledgeFilesLoading(false);
      return;
    }
    let alive = true;
    setKnowledgeFilesLoading(true);
    Promise.all(knowledgeFiles.map((file) => prepareKnowledgeFile(file)))
      .then((files) => {
        if (alive) setPreparedKnowledgeFiles(files);
      })
      .finally(() => {
        if (alive) setKnowledgeFilesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [knowledgeFiles]);
  useEffect(() => {
    if (!phoneOpen) return;
    let alive = true;
    setPhonesLoading(true);
    setPhonesError("");
    api("/api/platform/phone-configs")
      .then((result: { phoneConfigs?: unknown }) => {
        if (!alive) return;
        const rows = Array.isArray(result.phoneConfigs) ? result.phoneConfigs : [];
        setPhoneOptions(rows.map((row) => {
          const record = row && typeof row === "object" ? row as Record<string, unknown> : {};
          return {
            id: String(record.id ?? record._id ?? ""),
            phoneNumber: String(record.phone_number ?? record.phoneNumber ?? ""),
            friendlyName: typeof record.friendly_name === "string" ? record.friendly_name : undefined,
            provider: typeof record.provider === "string" ? record.provider : undefined,
          };
        }).filter((phone) => phone.id && phone.phoneNumber));
      })
      .catch((caught) => alive && setPhonesError(caught instanceof Error ? caught.message : String(caught)))
      .finally(() => alive && setPhonesLoading(false));
    return () => {
      alive = false;
    };
  }, [phoneOpen]);
  useEffect(() => {
    if (!forwardingOpen) return;
    let alive = true;
    setForwardingLoading(true);
    setForwardingError("");
    const load = async () => {
      try {
        if (!remoteAgentId) {
          if (alive) setForwardingRows(localForwardingRows(current.callForwarding));
          return;
        }
        const result = await api(`/api/platform/agents/${encodeURIComponent(remoteAgentId)}/call-forwarding`) as { forwardingNumbers?: unknown };
        if (alive) setForwardingRows(normalizeForwardingRows(result.forwardingNumbers));
      } catch (caught) {
        if (alive) setForwardingError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (alive) setForwardingLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [forwardingOpen, remoteAgentId, current.callForwarding]);
  useEffect(() => {
    if (!appointmentsOpen) return;
    let alive = true;
    setAppointmentsLoading(true);
    setAppointmentsError("");
    const load = async () => {
      try {
        if (!remoteAgentId) {
          if (alive) {
            setAppointmentTools(localAppointmentTools(current.appointmentTools));
            setCalendarIntegrations([]);
          }
          return;
        }
        const [toolsResult, integrationsResult] = await Promise.all([
          api(`/api/platform/agents/${encodeURIComponent(remoteAgentId)}/appointment-tools`) as Promise<{ appointmentTools?: unknown }>,
          api("/api/platform/calendar/integrations") as Promise<{ integrations?: unknown }>,
        ]);
        if (!alive) return;
        const integrations = normalizeCalendarIntegrations(integrationsResult.integrations);
        setAppointmentTools(normalizeAppointmentTools(toolsResult.appointmentTools));
        setCalendarIntegrations(integrations);
        setAppointmentIntegrationId((currentId) => currentId || integrations.find((item) => item.is_active !== false && item.is_active !== 0)?.id || "");
      } catch (caught) {
        if (alive) setAppointmentsError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (alive) setAppointmentsLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [appointmentsOpen, remoteAgentId, current.appointmentTools]);
  const selectPhone = async (phone: PhoneConfigOption | null) => {
    const id = phone?.id ?? "";
    setPhoneSavingId(id || "none");
    setPhonesError("");
    try {
      if (remoteAgentId) {
        await api(`/api/platform/agents/${encodeURIComponent(remoteAgentId)}/phone-number`, {
          method: "PATCH",
          body: JSON.stringify({ phone_number_id: id || null }),
        });
      }
      onChange({
        ...current,
        phoneNumberId: id,
        phoneNumber: phone?.phoneNumber ?? "",
      });
      setPhoneOpen(false);
    } catch (caught) {
      setPhonesError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPhoneSavingId("");
    }
  };
  const refreshForwardingRows = async () => {
    if (!remoteAgentId) {
      setForwardingRows(localForwardingRows(current.callForwarding));
      return;
    }
    const result = await api(`/api/platform/agents/${encodeURIComponent(remoteAgentId)}/call-forwarding`) as { forwardingNumbers?: unknown };
    setForwardingRows(normalizeForwardingRows(result.forwardingNumbers));
  };
  const addForwardingNumber = async () => {
    const phoneNumber = forwardingPhoneInput.trim();
    if (!phoneNumber || forwardingSaving) return;
    setForwardingSaving(true);
    setForwardingError("");
    try {
      const label = forwardingLabelInput.trim();
      if (!remoteAgentId) {
        const existing = (current.callForwarding ?? "").trim();
        const entry = label ? `${phoneNumber} - ${label}` : phoneNumber;
        const next = existing ? `${existing}\n${entry}` : entry;
        update("callForwarding", next);
        setForwardingRows(localForwardingRows(next));
      } else {
        const result = await api(`/api/platform/agents/${encodeURIComponent(remoteAgentId)}/call-forwarding`, {
          method: "POST",
          body: JSON.stringify({
            phone_number: phoneNumber,
            label: label || null,
            priority: forwardingRows.length + 1,
          }),
        });
        await refreshForwardingRows();
        update("callForwarding", "");
        if (result.syncError) setForwardingError(`Number saved, but call agent sync failed: ${result.syncError}`);
      }
      setForwardingPhoneInput("");
      setForwardingLabelInput("");
    } catch (caught) {
      setForwardingError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setForwardingSaving(false);
    }
  };
  const deleteForwardingNumber = async (row: CallForwardingRow) => {
    const rowId = forwardingRowId(row);
    if (!rowId) return;
    setForwardingDeletingId(rowId);
    setForwardingError("");
    try {
      if (remoteAgentId && !rowId.startsWith("local-forwarding-")) {
        const result = await api(`/api/platform/agents/${encodeURIComponent(remoteAgentId)}/call-forwarding/${encodeURIComponent(rowId)}`, {
          method: "DELETE",
        });
        await refreshForwardingRows();
        if (result.syncError) setForwardingError(`Number deleted, but call agent sync failed: ${result.syncError}`);
      } else {
        const index = row.localIndex ?? Number.parseInt(rowId.replace("local-forwarding-", ""), 10);
        const entries = (current.callForwarding ?? "").split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
        entries.splice(index, 1);
        const next = entries.join("\n");
        update("callForwarding", next);
        setForwardingRows(localForwardingRows(next));
      }
    } catch (caught) {
      setForwardingError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setForwardingDeletingId("");
    }
  };
  const refreshAppointmentTools = async () => {
    if (!remoteAgentId) {
      setAppointmentTools(localAppointmentTools(current.appointmentTools));
      return;
    }
    const result = await api(`/api/platform/agents/${encodeURIComponent(remoteAgentId)}/appointment-tools`) as { appointmentTools?: unknown };
    setAppointmentTools(normalizeAppointmentTools(result.appointmentTools));
  };
  const openAddAppointmentTool = () => {
    setAppointmentsError("");
    setEditingAppointmentTool(null);
    setAppointmentName("");
    setAppointmentDurations("30, 60");
    setAddingAppointment(true);
  };
  const openEditAppointmentTool = (row: AppointmentToolRow) => {
    setAppointmentsError("");
    setAppointmentMenuId("");
    setEditingAppointmentTool(row);
    setAppointmentName(row.name ?? "");
    setAppointmentIntegrationId(row.calendar_integration_id ?? appointmentIntegrationId);
    setAppointmentDurations(appointmentDurationsText(row.appointment_types));
    setAddingAppointment(true);
  };
  const removeAppointmentToolFromUi = (row: AppointmentToolRow) => {
    const rowId = appointmentToolId(row);
    setAppointmentTools((rows) => rows.filter((item) => {
      const itemId = appointmentToolId(item);
      if (rowId && itemId) return itemId !== rowId;
      return item.name !== row.name;
    }));
    if (!remoteAgentId) {
      const index = row.localIndex ?? Number.parseInt(rowId.replace("local-appointment-", ""), 10);
      const entries = (current.appointmentTools ?? "").split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
      if (Number.isFinite(index)) entries.splice(index, 1);
      else if (row.name) {
        const fallbackIndex = entries.indexOf(row.name);
        if (fallbackIndex >= 0) entries.splice(fallbackIndex, 1);
      }
      update("appointmentTools", entries.join("\n"));
    } else {
      update("appointmentTools", "");
    }
  };
  const addAppointmentTool = async () => {
    const name = appointmentName.trim();
    if (!name || appointmentSaving) return;
    setAppointmentSaving(true);
    setAppointmentsError("");
    try {
      const integration = calendarIntegrations.find((item) => (item.id ?? item._id) === appointmentIntegrationId);
      const editingRowId = editingAppointmentTool ? appointmentToolId(editingAppointmentTool) : "";
      if (!remoteAgentId) {
        const existing = (current.appointmentTools ?? "").trim();
        let entries = existing.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
        if (editingAppointmentTool) {
          const index = editingAppointmentTool.localIndex ?? Number.parseInt(editingRowId.replace("local-appointment-", ""), 10);
          if (Number.isFinite(index) && entries[index] !== undefined) entries[index] = name;
          else entries = entries.map((entry) => entry === editingAppointmentTool.name ? name : entry);
        } else {
          entries = existing ? [...entries, name] : [name];
        }
        const next = entries.join("\n");
        update("appointmentTools", next);
        setAppointmentTools(localAppointmentTools(next));
      } else {
        if (!integration) throw new Error("Connect an active calendar before creating an appointment tool.");
        const durations = appointmentDurations
          .split(",")
          .map((item) => Number.parseInt(item.trim(), 10))
          .filter((value) => Number.isFinite(value) && value > 0);
        const body = {
          calendar_integration_id: integration.id ?? integration._id,
          name,
          provider: integration.provider,
          appointment_types: (durations.length ? durations : [30]).map((duration) => ({
            name: `${duration} minute meeting`,
            duration,
            duration_minutes: duration,
          })),
          business_hours: editingAppointmentTool?.business_hours ?? {},
        };
        const result = await api(
          editingRowId
            ? `/api/platform/agents/${encodeURIComponent(remoteAgentId)}/appointment-tools/${encodeURIComponent(editingRowId)}`
            : `/api/platform/agents/${encodeURIComponent(remoteAgentId)}/appointment-tools`,
          {
          method: editingRowId ? "PATCH" : "POST",
          body: JSON.stringify({
            ...body,
            ...(editingRowId ? { is_active: editingAppointmentTool?.is_active ?? true } : {}),
          }),
        });
        await refreshAppointmentTools();
        update("appointmentTools", "");
        if (result.syncError) setAppointmentsError(`Appointment tool saved, but call agent sync failed: ${result.syncError}`);
      }
      setAppointmentName("");
      setAppointmentDurations("30, 60");
      setEditingAppointmentTool(null);
      setAddingAppointment(false);
    } catch (caught) {
      setAppointmentsError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAppointmentSaving(false);
    }
  };
  const deleteAppointmentTool = async (row: AppointmentToolRow) => {
    const rowId = appointmentToolId(row);
    if (!rowId) return;
    setAppointmentDeletingId(rowId);
    setAppointmentsError("");
    try {
      if (remoteAgentId && !rowId.startsWith("local-appointment-")) {
        const result = await api(`/api/platform/agents/${encodeURIComponent(remoteAgentId)}/appointment-tools/${encodeURIComponent(rowId)}`, {
          method: "DELETE",
        });
        update("appointmentTools", "");
        await refreshAppointmentTools();
        if (result.syncError) setAppointmentsError(`Appointment tool deleted, but call agent sync failed: ${result.syncError}`);
      } else {
        removeAppointmentToolFromUi(row);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (/appointment_tools row not found/i.test(message)) {
        removeAppointmentToolFromUi(row);
      } else {
        setAppointmentsError(message);
      }
    } finally {
      setAppointmentDeletingId("");
    }
  };

  return (
    <>
    <div className="rounded-xl border border-hairline/40 bg-card p-4">
      <div className="mb-4 text-[15px] font-semibold text-ink">Agent configuration</div>

      <div className="grid grid-cols-1 gap-3">
        <Field label="Voices">
          <input
            readOnly
            className={inputCls}
            placeholder="Choose a voice"
            value={selectedVoiceDisplay}
            onClick={() => setVoicesOpen(true)}
            onFocus={() => setVoicesOpen(true)}
            onChange={() => {}}
          />
        </Field>
        <Field label="AI provider">
          <input
            readOnly
            className={inputCls}
            value="MagicTeams"
            onFocus={() => update("aiProvider", "ultravox")}
            onChange={() => {}}
          />
        </Field>
        <Field label="Model">
          <select
            className={selectCls}
            value={current.model ?? ""}
            onChange={(event) => update("model", event.target.value)}
          >
            <option value="" disabled>Choose a model</option>
            {MAGICTEAMS_MODELS.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </Field>
        <Field label="First speaker">
          <select
            className={selectCls}
            value={current.firstSpeaker ?? "agent"}
            onChange={(event) => update("firstSpeaker", event.target.value as AgentProfileConfig["firstSpeaker"])}
          >
            <option value="agent">Agent speaks first (inbound)</option>
            <option value="caller">User speaks first (outbound)</option>
          </select>
        </Field>
        <Field label="Temperature">
          <input
            className={inputCls}
            inputMode="decimal"
            min={0}
            max={2}
            step={0.1}
            type="number"
            value={current.temperature ?? ""}
            onChange={(event) => updateNumber("temperature", event.target.value)}
          />
        </Field>
        <Field label="Language">
          <input
            className={inputCls}
            autoComplete="off"
            placeholder="en"
            value={normalizeLanguageCode(current.language)}
            onChange={(event) => update("language", normalizeLanguageCode(event.target.value))}
          />
        </Field>
        <Field label="Max duration">
          <input
            className={inputCls}
            inputMode="numeric"
            min={1}
            step={1}
            type="number"
            value={current.maxDuration ?? ""}
            onChange={(event) => updateNumber("maxDuration", event.target.value)}
          />
        </Field>
        <Field label="Phone number">
          <input
            readOnly
            className={inputCls}
            placeholder="Choose connected phone number"
            value={selectedPhone ? `${selectedPhone.phoneNumber}${selectedPhone.friendlyName ? ` (${selectedPhone.friendlyName})` : ""}` : current.phoneNumber ?? ""}
            onClick={() => setPhoneOpen(true)}
            onFocus={() => setPhoneOpen(true)}
            onChange={() => {}}
          />
        </Field>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3">
        <Field label="Knowledge base">
          <button
            type="button"
            className="flex min-h-[86px] w-full items-center justify-between gap-3 rounded-lg border border-hairline/40 bg-inset px-3 py-3 text-left transition-colors hover:border-accent/60 hover:bg-control/35 focus:outline-none focus:border-hairline"
            onClick={() => setKnowledgeOpen(true)}
            onFocus={() => setKnowledgeOpen(true)}
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-[15px] font-medium text-ink">
                <FileText size={16} className="shrink-0 text-ink-secondary" />
                <span>{knowledgeLoading ? "Loading knowledge..." : knowledgeDisplay.title}</span>
              </span>
              <span className="mt-1 block truncate text-[12.5px] text-ink-secondary">
                {knowledgeLoading ? "Checking saved backend rows" : knowledgeDisplay.detail}
              </span>
            </span>
            <span className="shrink-0 rounded-md bg-control px-2.5 py-1.5 text-[12px] text-ink-secondary">
              Manage
            </span>
          </button>
        </Field>
        <Field label="Call forwarding">
          <button
            type="button"
            className="flex min-h-[86px] w-full items-center justify-between gap-3 rounded-lg border border-hairline/40 bg-inset px-3 py-3 text-left transition-colors hover:border-accent/60 hover:bg-control/35 focus:outline-none focus:border-hairline"
            onClick={() => setForwardingOpen(true)}
            onFocus={() => setForwardingOpen(true)}
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-[15px] font-medium text-ink">
                <PhoneForwarded size={16} className="shrink-0 text-ink-secondary" />
                <span>{forwardingLoading ? "Loading forwarding..." : forwardingDisplay.title}</span>
              </span>
              <span className="mt-1 block truncate text-[12.5px] text-ink-secondary">
                {forwardingLoading ? "Checking saved transfer destinations" : forwardingDisplay.detail}
              </span>
            </span>
            <span className="shrink-0 rounded-md bg-control px-2.5 py-1.5 text-[12px] text-ink-secondary">
              Manage
            </span>
          </button>
        </Field>
        <Field label="Appointment tools">
          <button
            type="button"
            className="flex min-h-[86px] w-full items-center justify-between gap-3 rounded-lg border border-hairline/40 bg-inset px-3 py-3 text-left transition-colors hover:border-accent/60 hover:bg-control/35 focus:outline-none focus:border-hairline"
            onClick={() => setAppointmentsOpen(true)}
            onFocus={() => setAppointmentsOpen(true)}
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-[15px] font-medium text-ink">
                <CalendarDays size={16} className="shrink-0 text-ink-secondary" />
                <span>{appointmentsLoading ? "Loading appointment tools..." : appointmentDisplay.title}</span>
              </span>
              <span className="mt-1 block truncate text-[12.5px] text-ink-secondary">
                {appointmentsLoading ? "Checking calendar-backed tools" : appointmentDisplay.detail}
              </span>
            </span>
            <span className="shrink-0 rounded-md bg-control px-2.5 py-1.5 text-[12px] text-ink-secondary">
              Manage
            </span>
          </button>
        </Field>
        <Field label="Custom tools">
          <button
            type="button"
            className="flex min-h-[86px] w-full items-center justify-between gap-3 rounded-lg border border-hairline/40 bg-inset px-3 py-3 text-left transition-colors hover:border-accent/60 hover:bg-control/35 focus:outline-none focus:border-hairline"
            onClick={() => setCustomToolsOpen(true)}
            onFocus={() => setCustomToolsOpen(true)}
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-[15px] font-medium text-ink">
                <Wrench size={16} className="shrink-0 text-ink-secondary" />
                <span>{customToolsDisplay.title}</span>
              </span>
              <span className="mt-1 block truncate text-[12.5px] text-ink-secondary">
                {customToolsDisplay.detail}
              </span>
            </span>
            <span className="shrink-0 rounded-md bg-control px-2.5 py-1.5 text-[12px] text-ink-secondary">
              Manage
            </span>
          </button>
        </Field>
        <Field label="Custom CRM">
          <button
            type="button"
            className="flex min-h-[86px] w-full items-center justify-between gap-3 rounded-lg border border-hairline/40 bg-inset px-3 py-3 text-left transition-colors hover:border-accent/60 hover:bg-control/35 focus:outline-none focus:border-hairline"
            onClick={() => setCustomCrmOpen(true)}
            onFocus={() => setCustomCrmOpen(true)}
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-[15px] font-medium text-ink">
                <Edit3 size={16} className="shrink-0 text-ink-secondary" />
                <span>{customCrmDisplay.title}</span>
              </span>
              <span className="mt-1 block truncate text-[12.5px] text-ink-secondary">
                {customCrmDisplay.detail}
              </span>
            </span>
            <span className="shrink-0 rounded-md bg-control px-2.5 py-1.5 text-[12px] text-ink-secondary">
              Manage
            </span>
          </button>
        </Field>
        <Field label="Webhooks">
          <button
            type="button"
            className="flex min-h-[86px] w-full items-center justify-between gap-3 rounded-lg border border-hairline/40 bg-inset px-3 py-3 text-left transition-colors hover:border-accent/60 hover:bg-control/35 focus:outline-none focus:border-hairline"
            onClick={() => setWebhooksOpen(true)}
            onFocus={() => setWebhooksOpen(true)}
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-[15px] font-medium text-ink">
                <Link size={16} className="shrink-0 text-ink-secondary" />
                <span>{webhooksDisplay.title}</span>
              </span>
              <span className="mt-1 block truncate text-[12.5px] text-ink-secondary">
                {webhooksDisplay.detail}
              </span>
            </span>
            <span className="shrink-0 rounded-md bg-control px-2.5 py-1.5 text-[12px] text-ink-secondary">
              Manage
            </span>
          </button>
        </Field>
      </div>
    </div>
    {webhooksOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeWebhooks();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={addingWebhook ? "Add webhook" : "Webhooks"}
          className="animate-pop-in flex h-[min(620px,calc(100dvh-2rem))] w-full max-w-[680px] flex-col overflow-hidden rounded-[24px] border border-hairline/50 bg-panel shadow-2xl shadow-black/50"
        >
          <div className="flex items-center justify-between border-b border-hairline/40 px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              {addingWebhook && (
                <button
                  type="button"
                  onClick={() => {
                    setAddingWebhook(false);
                    resetWebhookForm();
                  }}
                  aria-label="Back to webhooks"
                  title="Back"
                  className="mt-[-2px] flex size-9 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
                >
                  <ChevronLeft size={20} />
                </button>
              )}
              <div className="min-w-0">
                <div className="text-[16px] font-semibold text-ink">{addingWebhook ? "Add Webhook" : "Webhooks"}</div>
                <div className="mt-0.5 text-[12.5px] text-ink-secondary">
                  {addingWebhook ? "Configure where events should be sent." : "Webhook URLs and event rules"}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={closeWebhooks}
              aria-label="Close webhooks"
              title="Close"
              className="flex size-9 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {addingWebhook ? (
              <div className="grid gap-5">
                <Field label="Destination URL">
                  <input
                    autoFocus
                    className={inputCls}
                    placeholder="https://example.com"
                    value={webhookUrl}
                    onChange={(event) => setWebhookUrl(event.target.value)}
                  />
                </Field>
                <div>
                  <div className="mb-2 text-[13px] font-medium text-ink">Select Webhook Types</div>
                  <div className="grid gap-2">
                    {WEBHOOK_EVENTS.map((eventType) => {
                      const checked = webhookEvents.includes(eventType.value);
                      return (
                        <button
                          key={eventType.value}
                          type="button"
                          onClick={() => toggleWebhookEvent(eventType.value)}
                          className="flex items-center gap-3 rounded-lg px-1 py-1.5 text-left text-[14px] text-ink-secondary hover:text-ink"
                        >
                          <span className={cn(
                            "flex size-5 items-center justify-center rounded-md border transition-colors",
                            checked ? "border-accent bg-accent text-white" : "border-accent/70 text-transparent",
                          )}>
                            <Check size={13} />
                          </span>
                          <span>{eventType.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Field label="Scope">
                  <div className="relative">
                    <select
                      className={cn(selectCls, "pr-10")}
                      value={webhookScope}
                      onChange={(event) => setWebhookScope(event.target.value)}
                    >
                      <option value="agent">{displayAgentName}</option>
                      <option value="global">Global</option>
                    </select>
                    <ChevronDown size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-secondary" />
                  </div>
                </Field>
                <Field label="Secrets">
                  <input
                    className={inputCls}
                    placeholder="Signing secret (optional)"
                    value={webhookSecret}
                    onChange={(event) => setWebhookSecret(event.target.value)}
                  />
                </Field>
                {webhookError && (
                  <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-danger">
                    {webhookError}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex min-h-full flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[12.5px] text-ink-secondary">
                    Send selected call events to external systems.
                  </div>
                  <button
                    type="button"
                    onClick={openAddWebhook}
                    className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:brightness-110"
                  >
                    <Plus size={15} /> Add Webhook
                  </button>
                </div>
                {webhooksLoading ? (
                  <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-hairline/40 bg-card text-[13px] text-ink-secondary">
                    <Loader2 size={16} className="mr-2 animate-spin" /> Loading webhooks
                  </div>
                ) : webhookEntries.length > 0 ? (
                  <div className="grid gap-3">
                    {webhookEntries.map((entry, index) => (
                      <div key={`${webhookTitle(entry)}-${index}`} className="relative rounded-xl border border-hairline/40 bg-card p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-control text-ink-secondary">
                              <Link size={16} />
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-[15px] font-semibold text-ink">{webhookTitle(entry)}</div>
                              <div className="mt-1 truncate text-[12.5px] text-ink-secondary">{webhookDetail(entry)}</div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setWebhookMenuIndex((currentIndex) => currentIndex === index ? null : index)}
                            disabled={webhookDeletingIndex === index}
                            aria-label="Webhook actions"
                            title="Actions"
                            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-60"
                          >
                            {webhookDeletingIndex === index ? <Loader2 size={15} className="animate-spin" /> : <MoreHorizontal size={18} />}
                          </button>
                          {webhookMenuIndex === index && (
                            <div className="absolute right-4 top-12 z-10 w-32 overflow-hidden rounded-xl border border-hairline/50 bg-panel py-1 shadow-xl shadow-black/35">
                              <button
                                type="button"
                                onClick={() => openEditWebhook(entry, index)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink hover:bg-control"
                              >
                                <Edit3 size={14} /> Edit
                              </button>
                              <button
                                type="button"
                                disabled={webhookDeletingIndex === index}
                                onClick={() => void deleteWebhook(entry, index)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-danger hover:bg-danger/10"
                              >
                                <Trash2 size={14} /> Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-hairline/50 bg-card px-4 text-center">
                    <div className="text-[13px] text-ink-secondary">No webhooks added yet.</div>
                    <button
                      type="button"
                      onClick={openAddWebhook}
                      className="inline-flex items-center gap-2 rounded-lg border border-hairline/50 bg-inset px-4 py-2.5 text-[14px] font-medium text-ink hover:bg-control"
                    >
                      <Plus size={17} /> Add Webhook
                    </button>
                  </div>
                )}
                {webhookError && (
                  <div role="alert" className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-[13px] text-warning">
                    {webhookError}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-between border-t border-hairline/40 px-5 py-4">
            {addingWebhook ? (
              <button
                type="button"
                onClick={() => {
                  setAddingWebhook(false);
                  resetWebhookForm();
                }}
                className="rounded-lg border border-hairline/50 bg-inset px-4 py-2 text-[13px] font-medium text-ink hover:bg-control"
              >
                Back
              </button>
            ) : <span />}
            <button
              type="button"
              onClick={addingWebhook ? () => void saveWebhook() : closeWebhooks}
              disabled={addingWebhook && (webhookSaving || !webhookUrl.trim() || webhookEvents.length === 0)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium text-white hover:brightness-110",
                addingWebhook && (webhookSaving || !webhookUrl.trim() || webhookEvents.length === 0)
                  ? "cursor-not-allowed bg-control text-ink-secondary hover:brightness-100"
                  : "bg-accent",
              )}
            >
              {addingWebhook && webhookSaving && <Loader2 size={14} className="animate-spin" />}
              {addingWebhook ? "Save" : "Done"}
            </button>
          </div>
        </div>
      </div>
    )}
    {customCrmOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeCustomCrm();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Custom CRM"
          className="animate-pop-in flex h-[min(620px,calc(100dvh-2rem))] w-full max-w-[680px] flex-col overflow-hidden rounded-[24px] border border-hairline/50 bg-panel shadow-2xl shadow-black/50"
        >
          <div className="flex items-center justify-between border-b border-hairline/40 px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              {addingCustomCrmProvider && (
                <button
                  type="button"
                  onClick={() => setAddingCustomCrmProvider(false)}
                  aria-label="Back to custom CRM"
                  title="Back"
                  className="mt-[-2px] flex size-9 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
                >
                  <ChevronLeft size={20} />
                </button>
              )}
              <div className="min-w-0">
                <div className="text-[16px] font-semibold text-ink">Custom CRM</div>
                <div className="mt-0.5 text-[12.5px] text-ink-secondary">
                  {addingCustomCrmProvider ? "Choose a connected CRM for this agent" : "CRM provider settings and integration notes"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {!addingCustomCrmProvider && (
                <button
                  type="button"
                  onClick={() => setAddingCustomCrmProvider(true)}
                  aria-label="Add custom CRM"
                  title="Add CRM"
                  className="flex size-9 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
                >
                  <Plus size={18} />
                </button>
              )}
              <button
                type="button"
                onClick={closeCustomCrm}
                aria-label="Close custom CRM"
                title="Close"
                className="flex size-9 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="mb-4 text-sm text-ink-secondary">
              <button type="button" disabled={crmConnectionsLoading} onClick={() => setCrmConnectionRevision((v) => v + 1)} className="text-accent">{crmConnectionsLoading ? "Checking connections…" : "Refresh CRM connections"}</button>
              {crmConnectionsError && <p role="alert">{crmConnectionsError}</p>}
              {!crmConnectionsLoading && !CUSTOM_CRM_PROVIDERS.some((provider) => crmConnected(provider.id)) && <p>Connect Gmail, Google Docs, or Google Sheets in Settings → Integrations first.</p>}
            </div>
            {addingCustomCrmProvider ? (
              <div className="grid gap-3">
                <div className="text-[12.5px] text-ink-secondary">
                  Connected CRM providers can be added specifically to this agent.
                </div>
                {CUSTOM_CRM_PROVIDERS.filter((provider) => crmConnected(provider.id)).map((provider) => {
                  const selected = selectedCustomCrmProviders.includes(provider.label);
                  const ProviderIcon = provider.icon;
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => addCustomCrmProvider(provider)}
                      className={cn(
                        "flex items-center justify-between gap-4 rounded-xl border bg-card p-4 text-left transition-colors",
                        selected ? "border-accent/70 bg-accent/10" : "border-hairline/40 hover:border-accent/60 hover:bg-control/35",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-control text-ink-secondary">
                          <ProviderIcon size={17} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[15px] font-semibold text-ink">{provider.label}</span>
                          <span className="mt-1 block truncate text-[12.5px] text-ink-secondary">{provider.detail}</span>
                        </span>
                      </span>
                      <span className={cn(
                        "shrink-0 rounded-md px-2.5 py-1.5 text-[12px]",
                        selected ? "bg-accent text-white" : "bg-control text-ink-secondary",
                      )}>
                        {selected ? "Added" : "Add"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-4">
                {selectedCustomCrmProviders.length > 0 && (
                  <div className="grid gap-2">
                    <div className="text-[12.5px] text-ink-secondary">Added CRM providers</div>
                    <div className="flex flex-wrap gap-2">
                      {selectedCustomCrmProviders.map((provider) => (
                        <span
                          key={provider}
                          className="inline-flex items-center gap-2 rounded-lg border border-hairline/40 bg-card px-3 py-2 text-[13px] font-medium text-ink"
                        >
                          <Check size={14} className="text-accent" />
                          {provider}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {emailCrmEnabled ? (
                  <div className="grid gap-4 rounded-xl border border-hairline/40 bg-card p-4">
                    <div>
                      <div className="text-[15px] font-semibold text-ink">Email template</div>
                      <div className="mt-1 text-[12.5px] text-ink-secondary">
                        Use placeholders like &lt;&lt;name&gt;&gt;, &lt;&lt;email&gt;&gt;, and &lt;&lt;company&gt;&gt;.
                      </div>
                    </div>
                    <Field label="To">
                      <input
                        autoFocus
                        className={inputCls}
                        placeholder="<<email>>"
                        value={emailTemplateTo}
                        onChange={(event) => setEmailTemplateTo(event.target.value)}
                      />
                    </Field>
                    <Field label="Subject">
                      <input
                        className={inputCls}
                        placeholder="Follow up for <<name>>"
                        value={emailTemplateSubject}
                        onChange={(event) => setEmailTemplateSubject(event.target.value)}
                      />
                    </Field>
                    <Field label="Body">
                      <textarea
                        className={cn(textareaCls, "min-h-[180px]")}
                        placeholder={"Hi <<name>>,\n\nFollowing up on your campaign.\n\nEmail: <<email>>\nCompany: <<company>>"}
                        value={emailTemplateBody}
                        onChange={(event) => setEmailTemplateBody(event.target.value)}
                      />
                    </Field>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={saveEmailTemplate}
                        className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110"
                      >
                        Save Template
                      </button>
                    </div>
                  </div>
                ) : (
                  <Field label="CRM configuration">
                    <textarea
                      autoFocus
                      className={cn(textareaCls, "min-h-[300px]")}
                      placeholder="CRM provider settings or integration notes"
                      value={current.customCrm ?? ""}
                      onChange={(event) => update("customCrm", event.target.value)}
                    />
                  </Field>
                )}
                {emailCrmEnabled && <CrmCampaignResults agentId={remoteAgentId} template={parseEmailTemplateConfig(current.customCrm)} connected={crmConnected("gmail")} />}
              </div>
            )}
          </div>

          <div className="flex justify-between border-t border-hairline/40 px-5 py-4">
            {addingCustomCrmProvider ? (
              <button
                type="button"
                onClick={() => setAddingCustomCrmProvider(false)}
                className="rounded-lg border border-hairline/50 bg-inset px-4 py-2 text-[13px] font-medium text-ink hover:bg-control"
              >
                Back
              </button>
            ) : <span />}
            <button
              type="button"
              onClick={closeCustomCrm}
              className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )}
    {customToolsOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeCustomTools();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={addingCustomTool ? "Create tool" : "Custom tools"}
          className={cn(
            "animate-pop-in flex h-[min(700px,calc(100dvh-3rem))] w-full flex-col overflow-hidden rounded-[24px] border border-hairline/50 bg-panel shadow-2xl shadow-black/50",
            addingCustomTool ? "max-w-[900px]" : "max-w-[680px]",
          )}
        >
          {!addingCustomTool ? (
            <>
              <div className="flex items-center justify-between border-b border-hairline/40 px-5 py-4">
                <div>
                  <div className="text-[16px] font-semibold text-ink">Custom tools</div>
                  <div className="mt-0.5 text-[12.5px] text-ink-secondary">HTTP/API tools this agent can call</div>
                </div>
                <button
                  type="button"
                  onClick={closeCustomTools}
                  aria-label="Close custom tools"
                  title="Close"
                  className="flex size-9 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[12.5px] text-ink-secondary">
                    Configure HTTP endpoints this agent can call during conversations.
                  </div>
                  <button
                    type="button"
                    onClick={openAddCustomTool}
                    className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:brightness-110"
                  >
                    <Plus size={15} /> Add Tool
                  </button>
                </div>
                {customToolSyncMessage && <p role="status" className="text-sm text-ink-secondary">{customToolSyncMessage}</p>}
                {customToolEntries.length > 0 ? (
                  <div className="grid gap-3">
                    {customToolEntries.map((entry, index) => (
                      <div key={`${customToolTitle(entry)}-${index}`} className="rounded-xl border border-hairline/40 bg-card p-4">
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-control text-ink-secondary">
                            <Wrench size={16} />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-[15px] font-semibold text-ink">{customToolTitle(entry)}</div>
                            <div className="mt-1 truncate text-[12.5px] text-ink-secondary">{customToolDetail(entry)}</div>
                            <button type="button" disabled={customToolSaving} onClick={() => void retryCustomToolSync(entry)} className="mt-2 text-sm text-accent disabled:opacity-50">{customToolSaving ? "Syncing…" : "Sync to Ultravox"}</button>
                          </div>
                          <div className="relative ml-auto shrink-0">
                            <button type="button" aria-label={`Options for ${customToolTitle(entry)}`} aria-expanded={customToolMenuIndex === index} disabled={customToolSaving} onClick={() => setCustomToolMenuIndex(customToolMenuIndex === index ? null : index)} className="rounded-md p-2 text-ink-secondary hover:bg-control"><MoreHorizontal size={18} /></button>
                            {customToolMenuIndex === index && <div className="absolute right-0 top-full z-10 min-w-32 rounded-lg border border-hairline bg-panel p-1 shadow-lg">
                              <button type="button" onClick={() => editCustomTool(entry, index)} className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-ink hover:bg-control"><Edit3 size={14} />Edit</button>
                              <button type="button" onClick={() => void deleteCustomTool(entry, index)} className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-red-400 hover:bg-control"><Trash2 size={14} />Delete</button>
                            </div>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[240px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-hairline/50 bg-card px-4 text-center">
                    <div className="text-[13px] text-ink-secondary">No custom tools added yet.</div>
                    <button
                      type="button"
                      onClick={openAddCustomTool}
                      className="inline-flex items-center gap-2 rounded-lg border border-hairline/50 bg-inset px-4 py-2.5 text-[14px] font-medium text-ink hover:bg-control"
                    >
                      <Plus size={17} /> Add Tool
                    </button>
                  </div>
                )}
              </div>

              <div className="flex justify-end border-t border-hairline/40 px-5 py-4">
                <button
                  type="button"
                  onClick={closeCustomTools}
                  className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-[230px_1fr] max-md:grid-cols-1">
              <div className="border-r border-hairline/40 bg-inset/40 p-6 max-md:hidden">
                <div className="text-[22px] font-semibold text-ink">{editingCustomToolIndex !== null ? "Edit Tool" : "Create Tool"}</div>
                <div className="mt-2 text-[15px] text-ink-secondary">Configure your custom tool</div>
                <div className="mt-8 grid gap-3">
                  {CUSTOM_TOOL_STEPS.map((step, index) => {
                    const active = customToolStep === step.id;
                    const complete = index < customToolCurrentStepIndex;
                    return (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => {
                          setAddingCustomParameter(false);
                          setCustomToolStep(step.id);
                        }}
                        className={cn(
                          "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-[15px] transition-colors",
                          active ? "bg-accent/12 text-accent" : "text-ink-secondary hover:bg-control/50 hover:text-ink",
                        )}
                      >
                        <span className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-full border text-[13px]",
                          complete ? "border-accent bg-accent text-white" : active ? "border-accent text-accent" : "border-hairline text-ink-secondary",
                        )}>
                          {complete ? <Check size={15} /> : index + 1}
                        </span>
                        {step.label}
                      </button>
                    );
                  })}
                </div>
	              </div>

	              <div className="flex min-h-0 flex-col">
	                <div className="flex items-start justify-between gap-3 p-6 pb-4">
	                  <div className="flex min-w-0 items-start gap-3">
	                    <button
	                      type="button"
	                      disabled={customToolSaving}
                    onClick={goBackCustomToolStep}
	                      aria-label="Back"
	                      title="Back"
	                      className="mt-[-2px] flex size-9 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
	                    >
	                      <ChevronLeft size={22} />
	                    </button>
	                    <div className="min-w-0">
	                    <div className="text-[22px] font-semibold text-ink">
	                      {addingCustomParameter
	                        ? editingParameterIndex !== null ? "Edit parameter" : "Add parameter"
                        : customToolStep === "info"
                          ? "Tool Information"
                          : customToolStep === "integration"
                            ? "Integration Settings"
                            : customToolStep === "parameters"
                              ? "Parameters"
                              : "Advanced"}
                    </div>
                    {!addingCustomParameter && (
                      <div className="mt-2 text-[15px] text-ink-secondary">
                        {customToolStep === "info"
                          ? "Basic details about your custom tool."
                          : customToolStep === "integration"
                            ? "Configure the endpoint and assign to an agent."
                            : customToolStep === "parameters"
                              ? "Define parameters for this tool."
	                              : ""}
	                      </div>
	                    )}
	                    </div>
	                  </div>
	                  <button
                    type="button"
                    onClick={closeCustomTools}
                    aria-label="Close create tool"
                    title="Close"
                    className="flex size-9 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                  {customToolStep === "info" && (
                    <div className="grid gap-6">
                      <Field label="Tool Name *">
                        <input
                          autoFocus
                          className={inputCls}
                          placeholder="e.g. Send Summary"
                          value={customToolName}
                          onChange={(event) => setCustomToolName(event.target.value)}
                        />
                      </Field>
                      <Field label="Model Tool Name">
                        <input
                          className={inputCls}
                          placeholder="e.g. sendSummary"
                          value={customToolModelName}
                          onChange={(event) => setCustomToolModelName(event.target.value)}
                        />
                      </Field>
                      <Field label="Description">
                        <textarea
                          className={cn(textareaCls, "min-h-[130px]")}
                          placeholder="What this tool does and how it should be used"
                          value={customToolDescription}
                          onChange={(event) => setCustomToolDescription(event.target.value)}
                        />
                      </Field>
                    </div>
                  )}

                  {customToolStep === "integration" && (
                    <div className="grid gap-6">
                      <Field label="Agent *">
                        <div className="relative">
                          <select className={cn(selectCls, "pr-10")} value={remoteAgentId || "current"} onChange={() => {}}>
                            <option value={remoteAgentId || "current"}>{displayAgentName}</option>
                          </select>
                          <ChevronDown size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-secondary" />
                        </div>
                      </Field>
                      <Field label="Base URL Pattern *">
                        <input
                          className={inputCls}
                          placeholder="https://api.example.com/resource"
                          value={customToolBaseUrl}
                          onChange={(event) => setCustomToolBaseUrl(event.target.value)}
                        />
                      </Field>
                      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                        <Field label="HTTP Method">
                          <div className="relative">
                            <select
                              className={cn(selectCls, "pr-10")}
                              value={customToolMethod}
                              onChange={(event) => setCustomToolMethod(event.target.value)}
                            >
                              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                                <option key={method} value={method}>{method}</option>
                              ))}
                            </select>
                            <ChevronDown size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-secondary" />
                          </div>
                        </Field>
                        <Field label="Timeout">
                          <input
                            className={inputCls}
                            placeholder="20s"
                            value={customToolTimeout}
                            onChange={(event) => setCustomToolTimeout(event.target.value)}
                          />
                        </Field>
                      </div>
                    </div>
                  )}

                  {customToolStep === "parameters" && !addingCustomParameter && (
                    <div className="grid gap-4">
                      {customToolParameters.length === 0 ? (
                        <div className="flex min-h-[180px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-hairline/60 bg-card px-4 text-center">
                          <div className="text-[15px] text-ink-secondary">No parameters defined yet.</div>
                          <button
                            type="button"
                            onClick={() => { resetCustomParameterForm(); setAddingCustomParameter(true); }}
                            className="inline-flex items-center gap-3 rounded-lg border border-hairline/50 bg-inset px-4 py-3 text-[15px] font-medium text-ink hover:bg-control"
                          >
                            <Plus size={18} /> Add parameter
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => { resetCustomParameterForm(); setAddingCustomParameter(true); }}
                              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:brightness-110"
                            >
                              <Plus size={15} /> Add parameter
                            </button>
                          </div>
                          <div className="grid gap-3">
                            {customToolParameters.map((parameter, index) => (
                              <div key={`${parameter.name}-${index}`} className="rounded-xl border border-hairline/40 bg-card p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-[15px] font-semibold text-ink">{parameter.name}</div>
                                    <div className="mt-1 truncate text-[12.5px] text-ink-secondary">
                                      {parameter.kind} · {parameter.location} · {parameter.valueType} · {parameter.required ? "Required" : "Optional"}
                                    </div>
                                  </div>
                                  <div className="relative shrink-0" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setParameterMenuIndex(null); } }}>
                                    <button type="button" aria-label={`Options for parameter ${parameter.name}`} aria-expanded={parameterMenuIndex === index} onClick={() => setParameterMenuIndex(parameterMenuIndex === index ? null : index)} className="rounded-md p-1.5 text-ink-secondary hover:bg-control hover:text-ink">
                                      <MoreHorizontal size={18} />
                                    </button>
                                    {parameterMenuIndex === index && <div className="absolute right-0 top-full z-10 min-w-32 rounded-lg border border-hairline bg-panel p-1 shadow-lg">
                                      <button type="button" onClick={() => editCustomParameter(parameter, index)} className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-ink hover:bg-control"><Edit3 size={14} />Edit</button>
                                      <button type="button" onClick={() => { setCustomToolParameters((parameters) => parameters.filter((_, itemIndex) => itemIndex !== index)); setParameterMenuIndex(null); }} className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-red-400 hover:bg-control"><Trash2 size={14} />Delete</button>
                                    </div>}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {customToolStep === "parameters" && addingCustomParameter && (
                    <div className="grid gap-6">
                      <Field label="Parameter type">
                        <div className="relative">
                          <select
                            className={cn(selectCls, "pr-10")}
                            value={customParameterKind}
                            onChange={(event) => setCustomParameterKind(parseCustomParameterKind(event.target.value))}
                          >
                            <option value="Dynamic">Dynamic</option>
                            <option value="Static">Static</option>
                          </select>
                          <ChevronDown size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-secondary" />
                        </div>
                      </Field>
                      <Field label="Parameter name*">
                        <input
                          autoFocus
                          className={inputCls}
                          placeholder="e.g. Company"
                          ref={customParameterNameRef}
                          value={customParameterName}
                          aria-invalid={Boolean(customParameterError)}
                          aria-describedby="custom-parameter-name-help"
                          onChange={(event) => {
                            setCustomParameterName(event.target.value);
                            setCustomParameterError("");
                          }}
                        />
                      </Field>
                      <Field label="Location:*">
                        <div className="relative">
                          <select
                            className={cn(selectCls, "pr-10")}
                            value={customParameterLocation}
                            onChange={(event) => setCustomParameterLocation(parseCustomParameterLocation(event.target.value))}
                          >
                            {CUSTOM_PARAMETER_LOCATIONS.map((location) => (
                              <option key={location} value={location}>{location}</option>
                            ))}
                          </select>
                          <ChevronDown size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-secondary" />
                        </div>
                      </Field>
                      <Field label="Description">
                        <input
                          className={inputCls}
                          placeholder="e.g. Name of the company"
                          value={customParameterDescription}
                          onChange={(event) => setCustomParameterDescription(event.target.value)}
                        />
                      </Field>
                      <Field label="Type:*">
                        <div className="relative">
                          <select
                            className={cn(selectCls, "pr-10")}
                            value={customParameterValueType}
                            onChange={(event) => setCustomParameterValueType(parseCustomParameterValueType(event.target.value))}
                          >
                            {CUSTOM_PARAMETER_VALUE_TYPES.map((type) => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                          <ChevronDown size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-secondary" />
                        </div>
                      </Field>
                      <div>
                        <div className="mb-2 text-[13px] font-medium text-ink-secondary">Required</div>
                        <div className="grid overflow-hidden rounded-lg border border-hairline/40 sm:grid-cols-2">
                          <button
                            type="button"
                            aria-pressed={customParameterRequired}
                            onClick={() => setCustomParameterRequired(true)}
                            className={cn("px-4 py-3 text-[14px] font-medium", customParameterRequired ? "bg-accent text-white" : "bg-inset text-ink hover:bg-control")}
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            aria-pressed={!customParameterRequired}
                            onClick={() => setCustomParameterRequired(false)}
                            className={cn("px-4 py-3 text-[14px] font-medium", !customParameterRequired ? "bg-accent text-white" : "bg-inset text-ink hover:bg-control")}
                          >
                            No
                          </button>
                        </div>
                        <p id="custom-parameter-name-help" className={cn("mt-4 text-[12px]", customParameterError ? "text-danger" : "text-ink-secondary")} role={customParameterError ? "alert" : undefined}>
                          {customParameterError || "Save updates the parameter in this form. Then choose Next and save the tool to sync your changes."}
                        </p>
                        <div className="mt-5 flex justify-end">
                          <button
                            type="button"
                            onClick={saveCustomParameter}
                            className="rounded-lg bg-accent px-4 py-2.5 text-[14px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {customToolStep === "advanced" && (
                    <div className="grid gap-8 border-t border-hairline/40 pt-7">
                      <div>
                        <div className="text-[16px] font-semibold text-ink">Agent End Behavior</div>
                        <div className="mt-2 text-[14px] text-ink-secondary">Default for how the agent should proceed after the tool is invoked.</div>
                        <div className="relative mt-4">
                          <select
                            className={cn(selectCls, "pr-10")}
                            value={customToolEndBehavior}
                            onChange={(event) => setCustomToolEndBehavior(event.target.value)}
                          >
                            <option value="Default">Default</option>
                            <option value="Speak after tool">Speak after tool</option>
                            <option value="End call">End call</option>
                          </select>
                          <ChevronDown size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-secondary" />
                        </div>
                      </div>
                      <div>
                        <div className="text-[16px] font-semibold text-ink">Static Response</div>
                        <div className="mt-2 text-[14px] leading-relaxed text-ink-secondary">When enabled, a hardcoded message is returned without waiting for the tool&apos;s response.</div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={customToolStaticResponse}
                          onClick={() => setCustomToolStaticResponse((enabled) => !enabled)}
                          className="mt-4 flex w-full items-center justify-between rounded-lg border border-hairline/40 bg-inset px-4 py-3 text-left text-[14px] text-ink"
                        >
                          {customToolStaticResponse ? "Enabled" : "Disabled"}
                          <span className={cn(
                            "relative h-[26px] w-[48px] rounded-full transition-colors",
                            customToolStaticResponse ? "bg-accent" : "bg-control",
                          )}>
                            <span className={cn(
                              "absolute top-[3px] size-5 rounded-full bg-white transition-all",
                              customToolStaticResponse ? "left-[25px]" : "left-[3px]",
                            )} />
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {customToolSyncMessage && <p role="status" className="px-6 text-sm text-ink-secondary">{customToolSyncMessage}</p>}
                <div className="flex items-center justify-between gap-3 border-t border-hairline/40 px-6 py-4">
                  <button
                    type="button"
                    disabled={customToolSaving}
                    onClick={goBackCustomToolStep}
                    className="rounded-lg border border-hairline/40 bg-inset px-4 py-2.5 text-[14px] font-medium text-ink hover:bg-control"
                  >
                    {customToolStep === "info" && !addingCustomParameter ? "Cancel" : "Back"}
                  </button>
                  <button
                    type="button"
                    disabled={customToolNextDisabled || customToolSaving}
                    onClick={goNextCustomToolStep}
                    className="rounded-lg bg-accent px-5 py-2.5 text-[14px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {customToolSaving ? "Creating…" : addingCustomParameter ? "Next" : customToolStep === "advanced" ? editingCustomToolIndex !== null ? "Save Changes" : "Create Tool" : "Next"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )}
    {voicesOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setVoicesOpen(false);
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Choose voice"
          className="animate-pop-in flex h-[min(760px,calc(100dvh-2rem))] w-full max-w-[980px] flex-col overflow-hidden rounded-[24px] border border-hairline/50 bg-panel shadow-2xl shadow-black/50"
        >
          <div className="flex items-center justify-between border-b border-hairline/40 px-5 py-4">
            <div>
              <div className="text-[16px] font-semibold text-ink">Voices</div>
              <div className="mt-0.5 text-[12.5px] text-ink-secondary">Browse all available voices for this agent</div>
            </div>
            <button
              type="button"
              onClick={() => setVoicesOpen(false)}
              aria-label="Close voices"
              title="Close"
              className="flex size-9 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>

          <div className="border-b border-hairline/40 p-5">
            <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
              <label className="relative block">
                <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-secondary" />
                <input
                  autoFocus
                  className={`${inputCls} pl-10`}
                  placeholder="Search voices..."
                  value={voiceSearch}
                  onChange={(event) => setVoiceSearch(event.target.value)}
                />
              </label>
              <select
                className={selectCls}
                value={voiceLanguage}
                onChange={(event) => setVoiceLanguage(event.target.value)}
              >
              {voiceLanguages.map((language) => (
                  <option key={language} value={language}>{language}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-ink">
              <span className="text-accent">|||</span> MagicTeams
            </div>
            {voicesLoading && filteredVoices.length === 0 && (
              <div className="rounded-xl border border-hairline/40 bg-card px-4 py-8 text-center text-[13px] text-ink-secondary">
                Loading MagicTeams voices...
              </div>
            )}
            {voicesError && (
              <div role="alert" className="mb-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-danger">
                {voicesError}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredVoices.map((voice) => {
                const selected = current.voices === voice.voiceId || current.voices === voice.name;
                const activePreview = playingVoiceId === voice.voiceId;
                const language = voice.languageLabel || voice.primaryLanguage || "Unknown";
                return (
                  <div
                    key={voice.voiceId}
                    className={cn(
                      "min-h-[132px] rounded-xl border border-hairline/45 bg-card p-4 text-left transition-colors hover:border-accent/60 hover:bg-control/25",
                      selected && "border-accent ring-2 ring-accent-border",
                    )}
                  >
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        update("voices", voice.voiceId);
                        setVoicesOpen(false);
                      }}
                      className="block w-full text-left"
                    >
                      <div className="text-[15px] font-semibold text-ink">{voice.name}</div>
                      <div className="mt-1 truncate text-[12px] text-ink-secondary">
                        {[language, voice.provider].filter(Boolean).join(" · ")}
                      </div>
                    </button>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => void playVoicePreview(voice.voiceId)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-hairline/40 bg-inset px-3 py-1.5 text-[12px] text-ink hover:bg-control"
                      >
                        {activePreview && !voicePreviewPaused ? <Pause size={13} /> : <Play size={13} />}
                        {activePreview && !voicePreviewPaused ? "Pause" : "Play"}
                      </button>
                      {selected && <span className="text-[12px] font-medium text-accent">Selected</span>}
                    </div>
                    <div className="mt-4 truncate text-[12px] text-ink-secondary">
                      {language}{voice.provider ? ` · ${voice.provider}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
            {!voicesLoading && filteredVoices.length === 0 && (
              <div className="rounded-xl border border-hairline/40 bg-card px-4 py-8 text-center text-[13px] text-ink-secondary">
                No voices found
              </div>
            )}
          </div>
        </div>
      </div>
    )}
    {knowledgeOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeKnowledge();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={addingKnowledge ? "Add knowledge base" : "Knowledge base"}
          className="animate-pop-in flex h-[min(720px,calc(100dvh-2rem))] w-full max-w-[680px] flex-col overflow-hidden rounded-[24px] border border-hairline/50 bg-panel shadow-2xl shadow-black/50"
        >
          <div className="flex items-center justify-between border-b border-hairline/40 px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              {(addingKnowledge || viewingKnowledge) && (
                <button
                  type="button"
                  onClick={() => {
                    if (viewingKnowledge) {
                      setViewingKnowledge(null);
                      return;
                    }
                    setAddingKnowledge(false);
                    resetKnowledgeForm();
                  }}
                  aria-label="Back to knowledge base"
                  title="Back"
                  className="mt-[-2px] flex size-9 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
                >
                  <ChevronLeft size={20} />
                </button>
              )}
              <div className="min-w-0">
                <div className="text-[16px] font-semibold text-ink">
                  {addingKnowledge ? "Add Knowledge Base" : "Knowledge base"}
                </div>
                <div className="mt-0.5 text-[12.5px] text-ink-secondary">
                  {addingKnowledge ? "Create a knowledge source for this agent" : "Knowledge this agent can use"}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={closeKnowledge}
              aria-label="Close knowledge base"
              title="Close"
              className="flex size-9 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>

          {!addingKnowledge ? (
            <>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[12.5px] text-ink-secondary">
                    {remoteAgentId ? "Saved in MagicTeams. New items are also sent to Ultravox." : "Hosted sync unavailable for this bot"}
                  </div>
                  <button
                    type="button"
                    onClick={() => setAddingKnowledge(true)}
                    className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:brightness-110"
                  >
                    <Plus size={15} /> Add knowledge base
                  </button>
                </div>
                {knowledgeError && (
                  <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-danger">
                    {knowledgeError}
                  </div>
                )}
                {viewingKnowledge ? (
                  <div className="min-h-0 rounded-xl border border-hairline/40 bg-card">
                    <div className="flex items-start justify-between gap-3 border-b border-hairline/40 p-4">
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-semibold text-ink">{knowledgeRowTitle(viewingKnowledge)}</div>
                        <div className="mt-1 text-[12px] text-ink-secondary">
                          {[viewingKnowledge.type || "text", viewingKnowledge.processing_status].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setViewingKnowledge(null)}
                        className="rounded-md px-2.5 py-1.5 text-[12px] text-ink-secondary hover:bg-control hover:text-ink"
                      >
                        Back
                      </button>
                    </div>
                    <div className="max-h-[430px] overflow-y-auto p-4 text-[13px] leading-relaxed text-ink-secondary">
                      {viewingKnowledge.file_path && (
                        <div className="mb-3 rounded-lg bg-inset p-3 text-ink">
                          File: {viewingKnowledge.file_path}
                        </div>
                      )}
                      {viewingKnowledge.website_url && (
                        <div className="mb-3 rounded-lg bg-inset p-3 text-ink">
                          URL: {viewingKnowledge.website_url}
                        </div>
                      )}
                      {viewingKnowledge.description && (
                        <div className="mb-3 whitespace-pre-wrap rounded-lg bg-inset p-3">{viewingKnowledge.description}</div>
                      )}
                      {viewingKnowledge.content ? (
                        <pre className="whitespace-pre-wrap rounded-lg bg-inset p-3 font-sans text-[13px] leading-relaxed text-ink">{viewingKnowledge.content}</pre>
                      ) : (
                        <div className="rounded-lg bg-inset p-3">No extracted text stored for this file yet.</div>
                      )}
                    </div>
                  </div>
                ) : knowledgeLoading ? (
                  <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-hairline/40 bg-card text-[13px] text-ink-secondary">
                    <Loader2 size={16} className="mr-2 animate-spin" /> Loading knowledge base
                  </div>
                ) : knowledgeRows.length > 0 ? (
                  <div className="grid gap-3">
                    {knowledgeRows.map((row) => {
                      const rowId = knowledgeRowId(row);
                      const title = knowledgeRowTitle(row);
                      return (
                        <div key={rowId || title} className="rounded-xl border border-hairline/40 bg-card p-4">
                          <button
                            type="button"
                            onClick={() => setViewingKnowledge(row)}
                            className="block w-full min-w-0 text-left"
                          >
                            <div className="truncate text-[15px] font-semibold text-ink">{title}</div>
                            <div className="mt-1 truncate text-[12.5px] text-ink-secondary">
                              {row.file_path ? `File: ${row.file_path}` : row.website_url ? `URL: ${row.website_url}` : row.type || "Text"}
                            </div>
                          </button>
                          <div className="mt-4 flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setViewingKnowledge(row)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline/40 bg-inset px-3 py-1.5 text-[12px] text-ink hover:bg-control"
                            >
                              <Eye size={13} /> View
                            </button>
                            <button
                              type="button"
                              disabled={knowledgeDeletingId === rowId}
                              onClick={() => void deleteKnowledge(row)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-[12px] text-danger hover:bg-danger/15 disabled:opacity-50"
                            >
                              {knowledgeDeletingId === rowId ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-hairline/40 bg-card px-4 text-center text-[13px] text-ink-secondary">
                    No knowledge base added yet
                  </div>
                )}
              </div>
              <div className="flex justify-end border-t border-hairline/40 px-5 py-4">
                <button
                  type="button"
                  onClick={closeKnowledge}
                  className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {knowledgeError && (
                  <div role="alert" className="mb-4 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-danger">
                    {knowledgeError}
                  </div>
                )}
                <div className="grid gap-4">
                  <Field label="Name">
                    <input
                      autoFocus
                      className={inputCls}
                      placeholder="Enter knowledge base name"
                      value={knowledgeName}
                      onChange={(event) => setKnowledgeName(event.target.value)}
                    />
                  </Field>
                  <Field label="Description (Optional)">
                    <textarea
                      className={cn(textareaCls, "min-h-[96px]")}
                      placeholder="Enter description"
                      value={knowledgeDescription}
                      onChange={(event) => setKnowledgeDescription(event.target.value)}
                    />
                  </Field>
                  <div className="border-t border-hairline/40 pt-4">
                    <div className="mb-3 text-[13px] font-medium text-ink">Content</div>
                    <div className="grid grid-cols-2 gap-1 rounded-xl border border-hairline/40 bg-inset p-1">
                      <button
                        type="button"
                        aria-pressed={knowledgeContentMode === "files"}
                        onClick={() => setKnowledgeContentMode("files")}
                        className={cn(
                          "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px]",
                          knowledgeContentMode === "files" ? "bg-card text-ink shadow-sm" : "text-ink-secondary hover:text-ink",
                        )}
                      >
                        <FileText size={15} /> Files
                      </button>
                      <button
                        type="button"
                        aria-pressed={knowledgeContentMode === "urls"}
                        onClick={() => setKnowledgeContentMode("urls")}
                        className={cn(
                          "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px]",
                          knowledgeContentMode === "urls" ? "bg-card text-ink shadow-sm" : "text-ink-secondary hover:text-ink",
                        )}
                      >
                        <Link size={15} /> URLs
                      </button>
                    </div>
                    {knowledgeContentMode === "files" ? (
                      <>
                        <label className="mt-4 flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-hairline/70 bg-inset px-4 py-6 text-center hover:border-accent/70 hover:bg-control/30">
                          <UploadCloud size={34} className="text-ink-secondary" />
                          <div className="mt-3 text-[14px] font-medium text-ink">Upload files or drag and drop</div>
                          <div className="mt-1 text-[12px] text-ink-secondary">PDF, TXT, DOC, DOCX, MD up to 10MB</div>
                          <input
                            type="file"
                            multiple
                            accept=".pdf,.txt,.doc,.docx,.md,text/plain,application/pdf"
                            className="sr-only"
                            onChange={(event) => setKnowledgeFiles(Array.from(event.target.files ?? []))}
                          />
                          {knowledgeFiles.length > 0 && (
                            <div className="mt-4 max-w-full text-[12px] text-ink-secondary">
                              {knowledgeFiles.map((file) => file.name).join(", ")}
                            </div>
                          )}
                        </label>
                      {knowledgeFiles.length > 0 && (
                        <div className="mt-3 rounded-xl border border-hairline/40 bg-card p-3">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="text-[13px] font-medium text-ink">Selected content</div>
                            {knowledgeFilesLoading && (
                              <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary">
                                <Loader2 size={13} className="animate-spin" /> Reading files
                              </span>
                            )}
                          </div>
                          <div className="grid gap-2">
                            {preparedKnowledgeFiles.map((file) => (
                              <div key={file.name} className="rounded-lg bg-inset p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-[13px] font-medium text-ink">{file.name}</div>
                                    {file.error && <div className="mt-1 text-[12px] text-danger">{file.error}</div>}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setKnowledgeFiles((files) => files.filter((item) => item.name !== file.name))}
                                    className="shrink-0 rounded-md p-1.5 text-ink-secondary hover:bg-control hover:text-ink"
                                    aria-label={`Remove ${file.name}`}
                                    title="Remove"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                                {file.content ? (
                                  <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-ink-secondary">
                                    {file.content}
                                  </pre>
                                ) : (
                                  <div className="mt-2 text-[12px] text-ink-secondary">No readable text preview for this file.</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      </>
                    ) : (
                      <textarea
                        className={cn(textareaCls, "mt-4 min-h-[180px]")}
                        placeholder="Paste one URL per line"
                        value={knowledgeUrls}
                        onChange={(event) => setKnowledgeUrls(event.target.value)}
                      />
                    )}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-hairline/40 px-5 py-4">
                <button
                  type="button"
                  onClick={() => {
                    setAddingKnowledge(false);
                    resetKnowledgeForm();
                  }}
                  className="rounded-lg px-3 py-2 text-[13px] text-ink-secondary hover:bg-control hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!knowledgeCanSubmit}
                  onClick={() => void addKnowledge()}
                  className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50"
                >
                  {knowledgeSaving ? "Adding..." : knowledgeFilesLoading ? "Reading..." : "Add Knowledge"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )}
    {appointmentsOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setAppointmentsOpen(false);
            setAddingAppointment(false);
            setEditingAppointmentTool(null);
            setAppointmentMenuId("");
          }
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingAppointmentTool ? "Edit appointment tool" : addingAppointment ? "Add appointment tool" : "Appointment tools"}
          className="animate-pop-in flex h-[min(700px,calc(100dvh-2rem))] w-full max-w-[680px] flex-col overflow-hidden rounded-[24px] border border-hairline/50 bg-panel shadow-2xl shadow-black/50"
        >
          <div className="flex items-center justify-between border-b border-hairline/40 px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              {addingAppointment && (
                <button
                  type="button"
                  onClick={() => {
                    setAddingAppointment(false);
                    setEditingAppointmentTool(null);
                    setAppointmentName("");
                    setAppointmentDurations("30, 60");
                  }}
                  aria-label="Back to appointment tools"
                  title="Back"
                  className="mt-[-2px] flex size-9 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
                >
                  <ChevronLeft size={20} />
                </button>
              )}
              <div className="min-w-0">
                <div className="text-[16px] font-semibold text-ink">
                  {editingAppointmentTool ? "Edit Appointment Tool" : addingAppointment ? "Add Appointment Tool" : "Appointment tools"}
                </div>
                <div className="mt-0.5 text-[12.5px] text-ink-secondary">
                  {editingAppointmentTool ? "Update this calendar-backed booking tool" : addingAppointment ? "Create a calendar-backed booking tool" : "Calendar-backed tools this agent can use"}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setAppointmentsOpen(false);
                setAddingAppointment(false);
                setEditingAppointmentTool(null);
                setAppointmentMenuId("");
              }}
              aria-label="Close appointment tools"
              title="Close"
              className="flex size-9 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>

          {!addingAppointment ? (
            <>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[12.5px] text-ink-secondary">
                    {remoteAgentId ? "Saved in MagicTeams. Active tools are sent to Ultravox for calls." : "Hosted sync unavailable for this bot"}
                  </div>
                  <button
                    type="button"
                    onClick={openAddAppointmentTool}
                    className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:brightness-110"
                  >
                    <Plus size={15} /> Add appointment tool
                  </button>
                </div>
                {appointmentsError && (
                  <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-danger">
                    {appointmentsError}
                  </div>
                )}
                {appointmentsLoading ? (
                  <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-hairline/40 bg-card text-[13px] text-ink-secondary">
                    <Loader2 size={16} className="mr-2 animate-spin" /> Loading appointment tools
                  </div>
                ) : appointmentTools.length > 0 ? (
                  <div className="grid gap-3">
                    {appointmentTools.map((tool) => {
                      const rowId = appointmentToolId(tool);
                      const active = tool.is_active !== false && tool.is_active !== 0;
                      return (
                        <div key={rowId || tool.name} className="relative rounded-xl border border-hairline/40 bg-card p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-[15px] font-semibold text-ink">{tool.name ?? "Appointment tool"}</div>
                              <div className="mt-1 truncate text-[12.5px] text-ink-secondary">
                                {providerLabel(tool.provider)} · {active ? "Active" : "Inactive"}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setAppointmentMenuId((currentId) => currentId === rowId ? "" : rowId)}
                              aria-label="Appointment tool actions"
                              title="Actions"
                              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink"
                            >
                              {appointmentDeletingId === rowId ? <Loader2 size={15} className="animate-spin" /> : <MoreHorizontal size={18} />}
                            </button>
                            {appointmentMenuId === rowId && (
                              <div className="absolute right-4 top-12 z-10 w-36 overflow-hidden rounded-xl border border-hairline/50 bg-panel py-1 shadow-xl shadow-black/35">
                                <button
                                  type="button"
                                  onClick={() => openEditAppointmentTool(tool)}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink hover:bg-control"
                                >
                                  <Edit3 size={14} /> Edit
                                </button>
                                <button
                                  type="button"
                                  disabled={appointmentDeletingId === rowId}
                                  onClick={() => {
                                    setAppointmentMenuId("");
                                    void deleteAppointmentTool(tool);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-danger hover:bg-danger/10 disabled:opacity-50"
                                >
                                  <Trash2 size={14} /> Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-hairline/40 bg-card px-4 text-center text-[13px] text-ink-secondary">
                    No appointment tools added yet
                  </div>
                )}
              </div>
              <div className="flex justify-end border-t border-hairline/40 px-5 py-4">
                <button
                  type="button"
                  onClick={() => {
                    setAppointmentsOpen(false);
                    setAppointmentMenuId("");
                  }}
                  className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {appointmentsError && (
                  <div role="alert" className="mb-4 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-danger">
                    {appointmentsError}
                  </div>
                )}
                <div className="grid gap-4">
                  <Field label="Name">
                    <input
                      autoFocus
                      className={inputCls}
                      placeholder="Sales demo booking"
                      value={appointmentName}
                      onChange={(event) => setAppointmentName(event.target.value)}
                    />
                  </Field>
                  <Field label="Calendar">
                    <select
                      className={selectCls}
                      value={appointmentIntegrationId}
                      onChange={(event) => setAppointmentIntegrationId(event.target.value)}
                      disabled={calendarIntegrations.length === 0}
                    >
                      <option value="" disabled>
                        {calendarIntegrations.length === 0 ? "No active calendars connected" : "Choose calendar"}
                      </option>
                      {calendarIntegrations
                        .filter((integration) => integration.is_active !== false && integration.is_active !== 0)
                        .map((integration) => {
                          const id = integration.id ?? integration._id ?? "";
                          const name = integration.display_name ?? integration.displayName ?? providerLabel(integration.provider);
                          return (
                            <option key={id} value={id}>
                              {name} · {providerLabel(integration.provider)}
                            </option>
                          );
                        })}
                    </select>
                  </Field>
                  <Field label="Appointment durations">
                    <input
                      className={inputCls}
                      placeholder="30, 60"
                      value={appointmentDurations}
                      onChange={(event) => setAppointmentDurations(event.target.value)}
                    />
                  </Field>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-hairline/40 px-5 py-4">
                <button
                  type="button"
                  onClick={() => {
                    setAddingAppointment(false);
                    setEditingAppointmentTool(null);
                    setAppointmentName("");
                    setAppointmentDurations("30, 60");
                  }}
                  className="rounded-lg px-3 py-2 text-[13px] text-ink-secondary hover:bg-control hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!appointmentName.trim() || appointmentSaving || (remoteAgentId ? !appointmentIntegrationId : false)}
                  onClick={() => void addAppointmentTool()}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {appointmentSaving && <Loader2 size={15} className="animate-spin" />}
                  {editingAppointmentTool ? "Update appointment tool" : "Add appointment tool"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )}
    {forwardingOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setForwardingOpen(false);
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Call forwarding"
          className="animate-pop-in flex max-h-[min(680px,calc(100dvh-2rem))] w-full max-w-[620px] flex-col overflow-hidden rounded-[24px] border border-hairline/50 bg-panel shadow-2xl shadow-black/50"
        >
          <div className="flex items-center justify-between border-b border-hairline/40 px-5 py-4">
            <div>
              <div className="text-[16px] font-semibold text-ink">Call forwarding</div>
              <div className="mt-0.5 text-[12.5px] text-ink-secondary">Transfer destinations this agent can use</div>
            </div>
            <button
              type="button"
              onClick={() => setForwardingOpen(false)}
              aria-label="Close call forwarding"
              title="Close"
              className="flex size-9 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="mb-4 rounded-xl border border-hairline/40 bg-card p-4">
              <div className="mb-3 text-[13px] font-medium text-ink">Add forwarding number</div>
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  className={inputCls}
                  placeholder="+15551234567"
                  value={forwardingPhoneInput}
                  onChange={(event) => setForwardingPhoneInput(event.target.value)}
                />
                <input
                  className={inputCls}
                  placeholder="Label, e.g. Sales"
                  value={forwardingLabelInput}
                  onChange={(event) => setForwardingLabelInput(event.target.value)}
                />
                <button
                  type="button"
                  disabled={!forwardingPhoneInput.trim() || forwardingSaving}
                  onClick={() => void addForwardingNumber()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {forwardingSaving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  Add
                </button>
              </div>
            </div>

            {forwardingError && (
              <div role="alert" className="mb-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-danger">
                {forwardingError}
              </div>
            )}

            {forwardingLoading ? (
              <div className="rounded-xl border border-hairline/40 bg-card px-4 py-8 text-center text-[13px] text-ink-secondary">
                Loading forwarding numbers...
              </div>
            ) : (
              <div className="grid gap-3">
                {forwardingRows.map((row) => {
                  const rowId = forwardingRowId(row);
                  const phoneNumber = forwardingPhone(row);
                  return (
                    <div key={rowId || phoneNumber} className="rounded-xl border border-hairline/45 bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[15px] font-semibold text-ink">{phoneNumber}</div>
                          <div className="mt-1 truncate text-[12px] text-ink-secondary">
                            {[row.label, row.priority ? `Priority ${row.priority}` : ""].filter(Boolean).join(" · ") || "Forwarding destination"}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={forwardingDeletingId === rowId}
                          onClick={() => void deleteForwardingNumber(row)}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-[12px] text-danger hover:bg-danger/15 disabled:opacity-50"
                        >
                          {forwardingDeletingId === rowId ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
                {forwardingRows.length === 0 && (
                  <div className="rounded-xl border border-hairline/40 bg-card px-4 py-8 text-center text-[13px] text-ink-secondary">
                    No forwarding numbers added yet
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end border-t border-hairline/40 px-5 py-4">
            <button
              type="button"
              onClick={() => setForwardingOpen(false)}
              className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )}
    {phoneOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPhoneOpen(false);
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Choose phone number"
          className="animate-pop-in flex max-h-[min(620px,calc(100dvh-2rem))] w-full max-w-[560px] flex-col overflow-hidden rounded-[24px] border border-hairline/50 bg-panel shadow-2xl shadow-black/50"
        >
          <div className="flex items-center justify-between border-b border-hairline/40 px-5 py-4">
            <div>
              <div className="text-[16px] font-semibold text-ink">Phone numbers</div>
              <div className="mt-0.5 text-[12.5px] text-ink-secondary">Choose the connected number this agent should call from</div>
            </div>
            <button
              type="button"
              onClick={() => setPhoneOpen(false)}
              aria-label="Close phone numbers"
              title="Close"
              className="flex size-9 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {phonesError && (
              <div role="alert" className="mb-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-danger">
                {phonesError}
              </div>
            )}
            {phonesLoading ? (
              <div className="rounded-xl border border-hairline/40 bg-card px-4 py-8 text-center text-[13px] text-ink-secondary">
                Loading connected phone numbers...
              </div>
            ) : (
              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={() => void selectPhone(null)}
                  disabled={Boolean(phoneSavingId)}
                  className={cn(
                    "rounded-xl border border-hairline/45 bg-card p-4 text-left transition-colors hover:border-accent/60 hover:bg-control/25 disabled:opacity-60",
                    !current.phoneNumberId && !current.phoneNumber && "border-accent ring-2 ring-accent-border",
                  )}
                >
                  <div className="text-[15px] font-semibold text-ink">None</div>
                  <div className="mt-1 text-[12px] text-ink-secondary">Do not attach a calling number</div>
                </button>
                {phoneOptions.map((phone) => {
                  const selected = current.phoneNumberId === phone.id || current.phoneNumber === phone.phoneNumber;
                  return (
                    <button
                      key={phone.id}
                      type="button"
                      onClick={() => void selectPhone(phone)}
                      disabled={Boolean(phoneSavingId)}
                      className={cn(
                        "rounded-xl border border-hairline/45 bg-card p-4 text-left transition-colors hover:border-accent/60 hover:bg-control/25 disabled:opacity-60",
                        selected && "border-accent ring-2 ring-accent-border",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[15px] font-semibold text-ink">{phone.phoneNumber}</div>
                          <div className="mt-1 truncate text-[12px] text-ink-secondary">
                            {[phone.friendlyName, phone.provider].filter(Boolean).join(" · ") || "Connected voice number"}
                          </div>
                        </div>
                        {selected && <span className="shrink-0 text-[12px] font-medium text-accent">Selected</span>}
                      </div>
                    </button>
                  );
                })}
                {phoneOptions.length === 0 && (
                  <div className="rounded-xl border border-hairline/40 bg-card px-4 py-8 text-center text-[13px] text-ink-secondary">
                    No connected phone numbers found
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}

export function SettingsPanel({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const patch = (
    p: Partial<
      Pick<
        Bot,
        | "name"
        | "title"
        | "description"
        | "notifications"
        | "computer"
        | "cloudBackend"
        | "color"
        | "mascotExpression"
        | "personality"
        | "avatarUrl"
        | "avatarCrop"
        | "autoApprove"
        | "speakReplies"
        | "voice"
        | "chiefOfStaff"
        | "approvePeerComms"
        | "composio"
        | "modelSelection"
        | "agentConfig"
      >
    > & { acknowledgeLocalAuto?: boolean },
  ) => dispatch({ type: "updateBot", botId: bot.id, patch: p });
  const activeState = stateForBot(bot);
  const mascotMotion = state.mascotMotion?.botId === bot.id ? state.mascotMotion : null;
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState(bot.description);
  useEffect(() => {
    if (!promptEditorOpen) setPromptDraft(bot.description);
  }, [bot.description, promptEditorOpen]);
  return (
    <>
    <aside className="animate-panel-in relative z-20 flex h-full w-[400px] shrink-0 flex-col border-l border-hairline/40 bg-panel max-md:absolute max-md:inset-0 max-md:z-40 max-md:w-full max-md:border-l-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => dispatch({ type: "toggleSettings", open: false })}
          aria-label="Collapse bot profile"
          title="Collapse bot profile"
          className="flex size-10 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-[15px] font-semibold text-ink">Bot profile</span>
        <button
          onClick={() => dispatch({ type: "toggleSettings", open: false })}
          aria-label="Close bot profile"
          title="Close bot profile"
          className="flex size-10 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <div className="flex flex-col gap-4 pt-4">
          <BotProfileAvatarCard
            bot={bot}
            activeState={activeState}
            mascotMotion={mascotMotion}
            onPatch={patch}
          />

          <Field label="Name">
            <input
              className={inputCls}
              maxLength={BOT_PROFILE_LIMITS.name}
              value={bot.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
          <Field label="Prompt">
            <textarea
              readOnly
              className={cn(
                inputCls,
                "min-h-[96px] cursor-pointer resize-none transition-colors hover:border-accent/60 hover:bg-control/35",
              )}
              maxLength={BOT_PROFILE_LIMITS.description}
              placeholder="Tell this bot how to behave"
              value={bot.description}
              onClick={() => {
                setPromptDraft(bot.description);
                setPromptEditorOpen(true);
              }}
              onFocus={() => {
                setPromptDraft(bot.description);
                setPromptEditorOpen(true);
              }}
              onChange={() => {}}
            />
          </Field>

          <AgentConfigurationFields
            config={bot.agentConfig}
            agentName={bot.name}
            remoteAgentId={bot.remoteAgentId}
            onChange={(agentConfig) => patch({ agentConfig })}
          />
        </div>
      </div>
    </aside>
    {promptEditorOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPromptEditorOpen(false);
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit bot prompt"
          className="animate-pop-in flex h-[min(620px,calc(100dvh-2rem))] w-full max-w-[760px] flex-col overflow-hidden rounded-[24px] border border-hairline/50 bg-panel shadow-2xl shadow-black/50"
        >
          <div className="flex items-center justify-between border-b border-hairline/40 px-5 py-4">
            <div>
              <div className="text-[16px] font-semibold text-ink">Prompt</div>
              <div className="mt-0.5 text-[12.5px] text-ink-secondary">{bot.name}</div>
            </div>
            <button
              type="button"
              onClick={() => setPromptEditorOpen(false)}
              aria-label="Close prompt editor"
              title="Close"
              className="flex size-9 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
            <textarea
              autoFocus
              className={cn(inputCls, "min-h-0 flex-1 resize-none p-4 text-[15px] leading-relaxed")}
              maxLength={BOT_PROFILE_LIMITS.description}
              placeholder="Tell this bot how to behave"
              value={promptDraft}
              onChange={(event) => setPromptDraft(event.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-hairline/40 px-5 py-4">
            <button
              type="button"
              onClick={() => {
                setPromptDraft(bot.description);
                setPromptEditorOpen(false);
              }}
              className="rounded-lg px-3 py-2 text-[13px] text-ink-secondary hover:bg-control hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                patch({ description: promptDraft });
                setPromptEditorOpen(false);
              }}
              className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110"
            >
              Update prompt
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
