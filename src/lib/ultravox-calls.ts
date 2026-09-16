export type Row = Record<string, unknown>;

export interface LiveCall {
  callId: string;
  created: string;
  joined: string;
  ended: string;
  endReason: string;
  /** completed | in-progress | initiated | voicemail | no-answer | busy | failed */
  status: string;
  durationSeconds: number | null;
  billedDuration: string;
  summary: string;
  shortSummary: string;
  to: string;
  from: string;
  model: string;
  voice: string;
  /** Raw transport markers, e.g. "webRtc" (browser demo) or "telnyx" (phone). */
  medium: string;
  clientVersion: string;
}

export interface LiveMessage {
  role: "user" | "agent";
  text: string;
  start: string;
  end: string;
}

const FINAL_RESULTS = new Set(["completed", "answered", "voicemail", "no-answer", "busy", "failed"]);

const normalizeResult = (value: unknown): string =>
  String(value ?? "").trim().toLowerCase().replace(/[ _-]+/g, "");

/** Statuses that will never change again — everything else is worth a live refresh. */
export function needsLiveRefresh(result: unknown): boolean {
  const status = normalizeResult(result);
  if (!status || status === "—" || status === "null" || status === "undefined") return true;
  return !FINAL_RESULTS.has(status);
}

function parseBilledSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const match = value.trim().match(/^([\d.]+)\s*s$/i);
    if (match) return Math.round(Number(match[1]));
  }
  return null;
}

function dotted(record: Record<string, unknown>, ...fields: string[]): string {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const meta = record.metadata;
  if (meta && typeof meta === "object") {
    const nested = meta as Record<string, unknown>;
    for (const field of fields) {
      const value = nested[`ultravox.telnyx.${field}`] ?? nested[field];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "";
}

export function normalizeLiveCall(call: Row): LiveCall {
  const endReason = typeof call.endReason === "string" ? call.endReason : "";
  const ended = typeof call.ended === "string" ? call.ended : "";
  const joined = typeof call.joined === "string" ? call.joined : "";
  let durationSeconds = parseBilledSeconds(call.billedDuration ?? call.billed_seconds);
  if (durationSeconds == null && joined && ended) {
    const ms = Date.parse(ended) - Date.parse(joined);
    if (Number.isFinite(ms) && ms >= 0) durationSeconds = Math.round(ms / 1000);
  }
  const reason = endReason.toLowerCase().replace(/[-\s]+/g, "_");
  let status: string;
  if (/voice_?mail|answering_machine|machine_detected|^amd$/.test(reason)) status = "voicemail";
  else if (/no_?answer|unanswered|no_response|timeout|expired|not_answered|no_pickup/.test(reason)) status = "no-answer";
  else if (/busy|line_busy|user_busy|congestion/.test(reason)) status = "busy";
  else if (/fail|error|declin|reject|cancel|abandon|unavailable|invalid|forbidden/.test(reason)) status = "failed";
  else if (ended) status = "completed";
  else if (joined) status = "in-progress";
  else status = "initiated";
  const medium = call.medium;
  return {
    callId: typeof call.callId === "string" ? call.callId : String(call.call_id ?? call.id ?? ""),
    created: typeof call.created === "string" ? call.created : String(call.created_at ?? ""),
    joined,
    ended,
    endReason,
    status,
    durationSeconds,
    billedDuration: typeof call.billedDuration === "string" ? call.billedDuration : "",
    summary: typeof call.summary === "string" ? call.summary : "",
    shortSummary: typeof call.shortSummary === "string" ? call.shortSummary : "",
    to: dotted(call, "to", "to_number", "recipient_number", "recipient"),
    from: dotted(call, "from", "from_number"),
    model: typeof call.model === "string" ? call.model : "",
    voice: typeof call.voice === "string" ? call.voice : "",
    medium: medium && typeof medium === "object" ? Object.keys(medium).join(",") : typeof medium === "string" ? medium : "",
    clientVersion: typeof call.clientVersion === "string" ? call.clientVersion : "",
  };
}

const CALL_ID_FIELDS = ["ultravox_call_id", "ultravoxCallId", "call_id", "callId", "external_call_id", "provider_call_id", "sid"];

/** A direct Ultravox call id carried on the platform row, if any. */
export function extractCallId(raw: Row): string {
  if (!raw || typeof raw !== "object") return "";
  for (const field of CALL_ID_FIELDS) {
    const value = (raw as Row)[field];
    if (typeof value === "string" && /^[\w-]+$/.test(value.trim())) return value.trim();
  }
  return "";
}

const AGENT_ID_FIELDS = ["agent_id", "agentId", "ultravox_agent_id", "ultravoxAgentId"];

export function extractPlatformAgentId(raw: Row): string {
  if (!raw || typeof raw !== "object") return "";
  const record = raw as Row;
  const agents = record.agents;
  if (agents && typeof agents === "object") {
    const nested = agents as Row;
    for (const field of ["id", ...AGENT_ID_FIELDS]) {
      const value = nested[field];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  for (const field of AGENT_ID_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

const TIME_FIELDS = ["started_at", "created_at", "createdAt", "created", "call_created_at"];

/** ISO timestamp of the history row, for time-proximity matching. */
export function extractRowTime(raw: Row): string {
  if (!raw || typeof raw !== "object") return "";
  for (const field of TIME_FIELDS) {
    const value = (raw as Row)[field];
    if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
    if (typeof value === "string" && value.trim() && !Number.isNaN(Date.parse(value))) {
      return new Date(value).toISOString();
    }
  }
  return "";
}

export function formatTime(value: unknown): string {
  if (value == null || value === "") return "—";
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return "—";
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Compact clock format for billed time: 92 s → "01:32", 348 s → "05:48". */
export function formatClock(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return "—";
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

/** Live (phone) vs Demo (browser) classification for a history entry.
 *  Provider transport markers win; platform source markers cover rows that
 *  never resolve to provider data. Unknown defaults to live (phone is the
 *  norm; browser demos always carry a webrtc marker). */
export function classifyCall(raw: Row, live?: Pick<LiveCall, "medium" | "clientVersion"> | null): "live" | "demo" | "unknown" {
  const metaKeys = raw.metadata && typeof raw.metadata === "object" ? Object.keys(raw.metadata as Row).join(",") : "";
  const transport = [
    live?.medium ?? "",
    live?.clientVersion ?? "",
    metaKeys,
    (() => {
      const medium = raw.medium;
      return medium && typeof medium === "object" ? Object.keys(medium).join(",") : typeof medium === "string" ? medium : "";
    })(),
    String(raw.client_version ?? raw.clientVersion ?? ""),
    String(raw.provider ?? ""),
  ].join(" ").toLowerCase();
  if (/webrtc|browser/.test(transport)) return "demo";
  // Telephony transports (Twilio / Telnyx / SIP) are live phone calls.
  if (/telnyx|twilio|sip|phone|pstn/.test(transport)) return "live";
  const source = [raw.source, raw.origin, raw.call_type, raw.callType, raw.type, raw.kind]
    .map((value) => (typeof value === "string" ? value : ""))
    .join(" ").toLowerCase();
  if (/demo|browser|webrtc/.test(source)) return "demo";
  return "unknown";
}

/** Card/list date: "14 Sept 2026". */
export function formatDayMonth(value: unknown): string {
  if (value == null || value === "") return "";
  const date = new Date(typeof value === "number" ? value : String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Billed time arrives as "348s" or a raw second count — always show m:ss.
 *  A zero bill means nothing was charged, so show a dash instead of 00:00. */
export function formatBilled(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? formatClock(value) : "—";
  }
  if (typeof value === "string") {
    const match = value.trim().match(/^([\d.]+)\s*s$/i);
    if (match) return Number(match[1]) > 0 ? formatClock(Number(match[1])) : "—";
    if (value.trim()) return value.trim();
  }
  return "—";
}

/** Recording / media URLs carry the auth token as a query param because media
 *  elements cannot set request headers. */
export function withAuthToken(path: string): string {
  try {
    const token = localStorage.getItem("magicteams-auth-token");
    if (!token) return path;
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}token=${encodeURIComponent(token)}`;
  } catch {
    return path;
  }
}
