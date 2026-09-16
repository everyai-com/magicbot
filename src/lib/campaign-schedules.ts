import { api } from "@/state/store";

export type ScheduleChannel = "voice" | "sms" | "gmail" | "whatsapp";
export type Row = Record<string, unknown>;

export interface StartPlan {
  channel: ScheduleChannel;
  campaignId: string;
  campaignName: string;
  agent: string;
  phone: string;
  template: string;
  templateMessage: string;
  audience: string;
  delay: number;
  locking: boolean;
  /** Stable contact ids (voice start takes ids, not indexes). */
  contactIds: string[];
  /** Positions into the contacts list at schedule time (gmail). */
  selectedIndexes: number[];
  /** Snapshot rows for sms/gmail PATCH + index mapping at fire time. */
  snapshotRows: Row[];
  /** Prepared gmail rows (rendered against the template at schedule time). */
  preparedRows: Row[] | null;
}

export interface ScheduledCampaign {
  id: string;
  channel: ScheduleChannel;
  campaignId: string;
  campaignName: string;
  atMs: number;
  timezone: string;
  plan: StartPlan;
  status: "pending" | "firing" | "fired" | "failed" | "cancelled" | "missed";
  createdAt: number;
  firedAt?: number;
  error?: string;
}

const STORAGE_KEY = "magicteams-campaign-schedules";
const HEARTBEAT_KEY = "magicteams-scheduler-heartbeat";
const LATE_GRACE_MS = 24 * 3600 * 1000;

const memoryStore: Record<string, string> = {};

function storage(): Pick<Storage, "getItem" | "setItem"> {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // Non-browser runtimes (tests, SSR) fall through to memory.
  }
  return {
    getItem: (key: string) => (key in memoryStore ? memoryStore[key] : null),
    setItem: (key: string, value: string) => {
      memoryStore[key] = value;
    },
  };
}

function notifyChanged() {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("campaign-schedules-changed"));
  } catch {
    // Headless runtimes have no event bus; storage itself is the contract.
  }
}

function readAll(): ScheduledCampaign[] {
  try {
    const raw = storage().getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch {
    return [];
  }
}

function writeAll(items: ScheduledCampaign[]) {
  try {
    storage().setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage full or unavailable — schedules stay in memory only.
  }
  notifyChanged();
}

export function listSchedules(): ScheduledCampaign[] {
  return readAll().sort((a, b) => a.atMs - b.atMs);
}

export function pendingSchedules(): ScheduledCampaign[] {
  const now = Date.now();
  return listSchedules().filter((item) => item.status === "pending" && item.atMs > now - LATE_GRACE_MS);
}

export function saveSchedule(item: Omit<ScheduledCampaign, "id" | "status" | "createdAt">): ScheduledCampaign {
  const record: ScheduledCampaign = {
    ...item,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    status: "pending",
    createdAt: Date.now(),
  };
  writeAll([...readAll(), record]);
  return record;
}

export function cancelSchedule(id: string) {
  writeAll(readAll().filter((item) => item.id !== id));
}

export function markSchedule(id: string, patch: Partial<ScheduledCampaign>) {
  writeAll(readAll().map((item) => (item.id === id ? { ...item, ...patch } : item)));
}

/** Recipient count carried by a plan (null when the channel resolves them
 *  server-side, e.g. WhatsApp audiences). */
export function planContactCount(plan: StartPlan): number | null {
  if (plan.channel === "voice") return plan.contactIds.length;
  if (plan.channel === "gmail") return plan.preparedRows?.length ?? 0;
  if (plan.channel === "sms") return plan.snapshotRows.length;
  return null;
}

/** Items whose time has come (plus overdue ones inside the late grace). */
export function dueSchedules(now = Date.now()): ScheduledCampaign[] {
  return readAll().filter((item) => item.status === "pending" && item.atMs <= now && now - item.atMs <= LATE_GRACE_MS);
}

/** Last engine sweep timestamp (proves the scheduler loop is running). */
export function readHeartbeat(): number | null {
  try {
    const raw = storage().getItem(HEARTBEAT_KEY);
    const at = raw == null ? NaN : Number(raw);
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

export function writeHeartbeat(now = Date.now()) {
  try {
    storage().setItem(HEARTBEAT_KEY, String(now));
  } catch {
    // Non-fatal; the sweep itself matters, not its receipt.
  }
}

export interface ScheduleLogEntry {
  at: number;
  kind: "scheduled" | "firing" | "fired" | "failed" | "missed" | "cancelled";
  text: string;
}

const LOG_KEY = "magicteams-scheduler-log";
const LOG_LIMIT = 30;

/** Persistent transition trail — the only way to see afterwards whether a
 *  schedule fired, failed, or went missing. */
export function logSchedEvent(kind: ScheduleLogEntry["kind"], text: string, at = Date.now()) {
  try {
    const raw = storage().getItem(LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const entries: ScheduleLogEntry[] = (Array.isArray(parsed) ? parsed : [])
      .filter((entry) => entry && typeof entry === "object")
      .slice(-(LOG_LIMIT - 1));
    entries.push({ at, kind, text });
    storage().setItem(LOG_KEY, JSON.stringify(entries));
  } catch {
    // Diagnostics must never break scheduling.
  }
  notifyChanged();
}

export function readSchedLog(): ScheduleLogEntry[] {
  try {
    const raw = storage().getItem(LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry === "object" && typeof entry.at === "number")
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

/** Pending items too far past their time to fire — marked missed on sight. */
export function expiredSchedules(now = Date.now()): ScheduledCampaign[] {
  return readAll().filter((item) => item.status === "pending" && now - item.atMs > LATE_GRACE_MS);
}

/** Items stuck mid-fire (tab crashed after claiming) — release them so a
 *  later sweep retries instead of losing them silently. */
export function reclaimStaleFiring(now = Date.now()): ScheduledCampaign[] {
  return readAll().filter((item) => item.status === "firing" && (item.firedAt ?? 0) < now - 10 * 60 * 1000);
}

// ── timezones ─────────────────────────────────────────────────────────────

const FALLBACK_ZONES = [
  "UTC", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
  "Europe/London", "Europe/Berlin", "Europe/Moscow", "Africa/Cairo", "America/New_York",
  "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto", "America/Sao_Paulo",
  "Pacific/Auckland",
];

export function timeZones(): string[] {
  const zones = new Set<string>(FALLBACK_ZONES);
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (typeof supported === "function") {
      const listed = supported("timeZone");
      if (Array.isArray(listed)) for (const zone of listed) zones.add(zone);
    }
  } catch {
    // Keep the curated list.
  }
  // Some ICU builds list legacy aliases (Asia/Calcutta) but omit the modern
  // canonical name (Asia/Kolkata) even though formatting accepts it — the
  // curated fallback list above guarantees those names are always offered.
  return [...zones].sort();
}

export function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** UTC offset of an IANA zone at an instant, in minutes east of UTC. */
export function tzOffsetMinutes(timezone: string, atMs: number): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(atMs)).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return Math.round((asUtc - atMs) / 60000);
}

export function formatUtcOffset(timezone: string, atMs: number): string {
  const minutes = tzOffsetMinutes(timezone, atMs);
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

/** Date + time inputs interpreted as wall time in the given zone → epoch ms. */
export function zonedTimeToMs(date: string, time: string, timezone: string): number | null {
  const dateMatch = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.trim().match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  try {
    // Fixed-point iteration: wall time interpreted as UTC, shifted by the
    // zone offset at the guess. One pass suffices off DST edges; the second
    // pass absorbs the edge by applying only the offset *delta*.
    const wallUtc = Date.UTC(year, month - 1, day, hour, minute);
    let utc = wallUtc - tzOffsetMinutes(timezone, wallUtc) * 60000;
    const refined = wallUtc - tzOffsetMinutes(timezone, utc) * 60000;
    if (Number.isFinite(refined)) utc = refined;
    return utc;
  } catch {
    return null;
  }
}

export interface SchedulePreview {
  atMs: number;
  /** e.g. "Tue, 16 Sept 2026, 10:30 AM". */
  local: string;
  timezone: string;
  offset: string;
  /** e.g. "16 Sept 2026, 05:00 UTC". */
  utc: string;
  relative: string;
}

export function previewSchedule(atMs: number, timezone: string, now = Date.now()): SchedulePreview {
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(atMs));
  const utc = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(atMs));
  const diff = Math.max(0, atMs - now);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const relative = days > 0 ? `in ${days} day${days === 1 ? "" : "s"}${hours ? `, ${hours}h` : ""}`
    : hours > 0 ? `in ${hours}h ${minutes}m`
    : minutes > 0 ? `in ${minutes} min`
    : "very soon";
  return { atMs, local, timezone, offset: formatUtcOffset(timezone, atMs), utc: `${utc} UTC`, relative };
}

export function formatCountdown(atMs: number, now = Date.now()): string {
  const diff = atMs - now;
  if (diff <= 0) return "due now";
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  if (minutes > 0) return `in ${minutes}m`;
  return `in ${Math.floor(diff / 1000)}s`;
}

// ── firing (mirrors the immediate start flow per channel) ──────────────────

function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    return typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms) : undefined;
  } catch {
    return undefined;
  }
}

async function campaignRequest(path: string, method = "GET", body?: Row) {
  return api("/api/campaign-workspace/" + path, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: timeoutSignal(60000),
  });
}

async function gmailAccounts(): Promise<Row[]> {
  const accounts = await campaignRequest("messaging/gmail-campaigns/accounts");
  return Array.isArray(accounts) ? (accounts as Row[]) : [];
}

/** Replay a saved start plan. Resolves with a short summary of the platform's
 *  acceptance response; throws with a human message on failure. */
export async function executeStartPlan(plan: StartPlan): Promise<string> {
  const root =
    plan.channel === "voice" ? "campaigns"
    : plan.channel === "sms" ? "messaging/sms-campaigns"
    : plan.channel === "gmail" ? "messaging/gmail-campaigns"
    : "whatsapp/campaigns";
  if (!plan.campaignId) throw new Error("Choose a campaign.");
  let last: unknown = null;
  if (plan.channel === "voice") {
    if (!plan.agent || !plan.phone || !plan.contactIds.length) {
      throw new Error("The scheduled voice campaign is missing its agent, caller number or contacts.");
    }
    await campaignRequest(`${root}/${plan.campaignId}`, "PATCH", {
      agent_id: plan.agent, phone_config_id: plan.phone, delay_seconds: plan.delay, enable_number_locking: plan.locking,
    });
    last = await campaignRequest(`${root}/${plan.campaignId}/start`, "POST", { contact_ids: plan.contactIds });
  } else if (plan.channel === "whatsapp") {
    if (!plan.audience || !plan.template) throw new Error("The scheduled WhatsApp campaign is missing its audience or template.");
    await campaignRequest(`${root}/${plan.campaignId}`, "PATCH", { audience_id: plan.audience, template_id: plan.template });
    last = await campaignRequest(`${root}/${plan.campaignId}/start`, "POST", {});
  } else if (plan.channel === "gmail") {
    if (!plan.template) throw new Error("The scheduled email campaign is missing its template.");
    if (!(await gmailAccounts()).length) throw new Error("Connect your Gmail account in Integrations before starting an email campaign.");
    if (!plan.preparedRows?.length) throw new Error("The scheduled email campaign has no prepared contacts.");
    await campaignRequest(`${root}/${encodeURIComponent(plan.campaignId)}`, "PATCH", {
      extracted_contacts: plan.preparedRows, template_id: plan.template,
    });
    last = await campaignRequest(`${root}/start`, "POST", {
      campaign_id: plan.campaignId,
      template_id: plan.template,
      selected_contact_indexes: [...plan.selectedIndexes].sort((a, b) => a - b),
      delay_seconds: plan.delay,
    });
  } else {
    if (!plan.template || !plan.snapshotRows.length || (plan.channel === "sms" && !plan.phone)) {
      throw new Error("The scheduled SMS campaign is missing its template, contacts or sender number.");
    }
    await campaignRequest(`${root}/${encodeURIComponent(plan.campaignId)}`, "PATCH", {
      extracted_contacts: plan.snapshotRows, template_id: plan.template,
    });
    last = await campaignRequest(`${root}/${plan.campaignId}/start`, "POST", {
      campaign_id: plan.campaignId,
      template_id: plan.template,
      phone_config_id: plan.phone,
      selected_contact_indexes: plan.snapshotRows.map((_, index) => index),
      delay_seconds: plan.delay,
    });
  }
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("campaign-workspace-changed"));
  } catch {
    // Headless runtimes have no event bus; the request already completed.
  }
  notifyChanged();
  if (last == null) return "accepted (empty response)";
  if (typeof last !== "object") return `accepted (${String(last).slice(0, 120)})`;
  const record = last as Record<string, unknown>;
  // Scalar values prove what the platform actually queued (counts, ids,
  // status words) — keys alone can't distinguish "scheduled 1" from "0".
  const pairs = Object.entries(record)
    .filter(([, value]) => value == null || ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 10)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return `accepted (${pairs || "no scalar fields"})`.slice(0, 300);
}
