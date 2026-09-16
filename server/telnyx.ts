// Telnyx provisioning for the local setup panel. One API key plus the number
// resolves or creates everything a number needs to make and receive calls:
// an outbound voice profile, a Voice API (Call Control) application with its
// webhook, and a messaging profile with its webhook — then attaches them.
//
// The API key is used server-side only: it is never logged and never returned
// in a response. Calls that create billable account resources happen only on
// an explicit operator action (provision), never during discovery.

const API = "https://api.telnyx.com/v2";

/** Where provider callbacks land. The app itself is local-first, so the
 * webhook has to point at the public platform host; both URLs stay
 * overridable for a tunnel or a self-hosted callback. */
const DEFAULT_WEBHOOK_BASE = "https://magicteams-voice-api.everyai-com.workers.dev";

/** One reusable profile per account rather than one per number. */
const OUTBOUND_PROFILE_NAME = "MagicTeams outbound";

const REQUEST_TIMEOUT_MS = 20_000;

type Json = Record<string, unknown>;

const fail = (message: string, status: number): never => {
  throw Object.assign(new Error(message), { status });
};

/** E.164, no separators: Telnyx filters loosely, so we bind the exact value. */
export function normalizeTelnyxNumber(value: unknown): string {
  const number = String(value ?? "").replace(/[^\d+]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(number)) {
    fail("Enter an international phone number beginning with +, for example +18334905225.", 400);
  }
  return number;
}

export function telnyxWebhookUrls(env: NodeJS.ProcessEnv = process.env): { voice: string; messaging: string } {
  const base = (env.TELNYX_WEBHOOK_BASE_URL || DEFAULT_WEBHOOK_BASE).trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^\s]+$/.test(base)) {
    fail("Telnyx webhooks need a public HTTPS address. Set TELNYX_WEBHOOK_BASE_URL to one.", 409);
  }
  const voice = (env.TELNYX_VOICE_WEBHOOK_URL || `${base}/api/webhooks/telnyx/status`).trim();
  const messaging = (env.TELNYX_MESSAGING_WEBHOOK_URL || `${base}/api/webhooks/telnyx/message`).trim();
  for (const url of [voice, messaging]) {
    if (!/^https:\/\/[^\s]+$/.test(url)) fail(`Telnyx webhooks need a public HTTPS address: ${url}`, 409);
  }
  return { voice, messaging };
}

async function errorDetail(response: Response): Promise<string> {
  try {
    // SAFETY: Telnyx documents its failures as an `errors` array.
    const body = (await response.json()) as { errors?: Array<{ detail?: unknown }> };
    const detail = body?.errors?.[0]?.detail;
    return typeof detail === "string" ? detail.slice(0, 300) : "";
  } catch {
    return "";
  }
}

async function request<T = Json>(
  apiKey: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    const headers: Record<string, string> = { authorization: `Bearer ${apiKey}`, accept: "application/json" };
    const init: RequestInit = {
      method: options.method ?? "GET",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    response = await fetch(`${API}${path}`, init);
  } catch (caught) {
    return fail(`Couldn't reach Telnyx: ${caught instanceof Error ? caught.message : String(caught)}`, 502);
  }
  if (response.status === 401 || response.status === 403) {
    fail("Telnyx rejected the API key. Check the key and its permissions.", 502);
  }
  if (response.status === 429) fail("Telnyx is rate limiting this account. Try again shortly.", 502);
  if (!response.ok) {
    const detail = await errorDetail(response);
    fail(
      detail
        ? `Telnyx could not complete this request: ${detail}`
        : `Telnyx could not complete this request (HTTP ${response.status}).`,
      502,
    );
  }
  // SAFETY: Telnyx's documented envelope for a successful request; callers
  // read only the fields the call asked for.
  return (await response.json().catch(() => ({}))) as T;
}

/** Every Telnyx response wraps its resource in a `data` envelope. */
const envelope = (body: unknown): Json => {
  // SAFETY: the documented envelope for a single resource.
  const data = (body as { data?: unknown } | null)?.data;
  // SAFETY: an absent `data` means no resource; callers treat it as empty.
  return (data ?? {}) as Json;
};

const rows = (body: unknown): Json[] => {
  // SAFETY: list endpoints answer with `data` as an array of resource records.
  const data = (body as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data : [];
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

export interface TelnyxNumberState {
  number_id: string;
  phone_number: string;
  status: string;
  connection_id: string;
  connection_name: string;
  outbound_voice_profile_id: string;
  messaging_profile_id: string;
  messaging_profile_name: string;
  webhook: { voice: string; messaging: string };
  /** what is still missing before this number can place and receive calls */
  missing: string[];
}

export interface TelnyxProvisionResult extends TelnyxNumberState {
  created: { outbound_voice_profile: boolean; connection: boolean; messaging_profile: boolean };
  attached: { connection: boolean; messaging_profile: boolean };
}

async function findNumber(apiKey: string, phoneNumber: string): Promise<Json> {
  const body = await request(
    apiKey,
    `/phone_numbers?filter[phone_number]=${encodeURIComponent(phoneNumber)}&page[size]=50`,
  );
  const match = rows(body).find((row) => text(row.phone_number) === phoneNumber);
  if (!match) {
    return fail("That number is not on this Telnyx account. Check the number and the API key.", 404);
  }
  return match;
}

/** Read-only: everything the connect form used to make the operator copy by
 * hand, plus what a provision run would still need to create. */
export async function discoverTelnyxNumber(
  apiKey: string,
  phoneNumber: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TelnyxNumberState> {
  const number = await findNumber(apiKey, phoneNumber);
  const numberId = text(number.id);
  const connectionId = text(number.connection_id);

  let outboundVoiceProfileId = "";
  if (connectionId) {
    const application = await request(apiKey, `/call_control_applications/${encodeURIComponent(connectionId)}`)
      .then((body) => envelope(body))
      // an unreadable application only costs us the reported profile id
      .catch((): Json => ({}));
    // SAFETY: `outbound` is absent on an application created without one.
    const outbound = (application.outbound ?? {}) as Json;
    outboundVoiceProfileId = text(outbound.outbound_voice_profile_id);
  }

  const state: TelnyxNumberState = {
    number_id: numberId,
    phone_number: text(number.phone_number) || phoneNumber,
    status: text(number.status),
    connection_id: connectionId,
    connection_name: text(number.connection_name),
    outbound_voice_profile_id: outboundVoiceProfileId,
    messaging_profile_id: text(number.messaging_profile_id),
    messaging_profile_name: text(number.messaging_profile_name),
    webhook: telnyxWebhookUrls(env),
    missing: [],
  };
  if (!connectionId) state.missing.push("voice connection");
  if (!state.messaging_profile_id) state.missing.push("messaging profile");
  return state;
}

/** Find-or-create the account's shared outbound voice profile. */
async function ensureOutboundProfile(apiKey: string, destinations: string[]): Promise<{ id: string; created: boolean }> {
  const listed = await request(apiKey, "/outbound_voice_profiles?page[size]=250");
  const existing = rows(listed).find((row) => text(row.name) === OUTBOUND_PROFILE_NAME && row.enabled !== false);
  if (existing) return { id: text(existing.id), created: false };
  const body: Json = {
    name: OUTBOUND_PROFILE_NAME,
    traffic_type: "conversational",
    service_plan: "global",
    enabled: true,
  };
  // Destination permissions stay off the profile unless the operator sets
  // them, so a fresh profile never silently widens who this account can call.
  if (destinations.length) body.whitelisted_destinations = destinations;
  const created = await request(apiKey, "/outbound_voice_profiles", { method: "POST", body });
  const id = text(envelope(created).id);
  if (!id) return fail("Telnyx did not return an outbound voice profile ID.", 502);
  return { id, created: true };
}

/** Find-or-create the Call Control application for this number. The outbound
 * voice profile is what actually permits outbound calls, so it is set here —
 * without it the application exists but every outbound call is refused. */
async function ensureVoiceApplication(
  apiKey: string,
  name: string,
  voiceWebhookUrl: string,
  outboundVoiceProfileId: string,
): Promise<{ id: string; created: boolean }> {
  const listed = await request(apiKey, "/call_control_applications?page[size]=250");
  const existing = rows(listed).find((row) => text(row.application_name) === name);
  if (existing) return { id: text(existing.id), created: false };
  const created = await request(apiKey, "/call_control_applications", {
    method: "POST",
    body: {
      application_name: name,
      webhook_event_url: voiceWebhookUrl,
      webhook_api_version: "2",
      outbound: { outbound_voice_profile_id: outboundVoiceProfileId },
    },
  });
  const id = text(envelope(created).id);
  if (!id) return fail("Telnyx did not return a Voice API application ID.", 502);
  return { id, created: true };
}

/** Find-or-create the messaging profile, with the inbound webhook set — a
 * profile created without one silently never delivers an inbound message. */
async function ensureMessagingProfile(
  apiKey: string,
  name: string,
  messagingWebhookUrl: string,
): Promise<{ id: string; created: boolean }> {
  const listed = await request(apiKey, "/messaging_profiles?page[size]=250");
  const existing = rows(listed).find((row) => text(row.name) === name);
  if (existing) return { id: text(existing.id), created: false };
  const created = await request(apiKey, "/messaging_profiles", {
    method: "POST",
    body: {
      name,
      webhook_url: messagingWebhookUrl,
      webhook_api_version: "2",
      whitelisted_destinations: ["*"],
    },
  });
  const id = text(envelope(created).id);
  if (!id) return fail("Telnyx did not return a messaging profile ID.", 502);
  return { id, created: true };
}

export interface ProvisionOptions {
  channel: "voice" | "sms";
  enableSms?: boolean;
  label?: string;
  destinations?: string[];
  env?: NodeJS.ProcessEnv;
}

/** Create and attach whatever the number is missing. Idempotent: an existing
 * connection, messaging profile or outbound voice profile is reused, so
 * repeating the action never duplicates account resources. */
export async function provisionTelnyxNumber(
  apiKey: string,
  phoneNumber: string,
  options: ProvisionOptions,
): Promise<TelnyxProvisionResult> {
  const env = options.env ?? process.env;
  const webhook = telnyxWebhookUrls(env);
  const label = (options.label ?? "MagicTeams").trim() || "MagicTeams";
  const name = `${label} ${phoneNumber}`;
  const wantsVoice = options.channel === "voice";
  const wantsMessaging = options.channel === "sms" || options.enableSms === true;

  const number = await findNumber(apiKey, phoneNumber);
  const numberId = text(number.id);
  const created = { outbound_voice_profile: false, connection: false, messaging_profile: false };
  const attached = { connection: false, messaging_profile: false };

  let connectionId = text(number.connection_id);
  if (wantsVoice && !connectionId) {
    // Reuse the number's existing connection when it already has one; only a
    // connection we create needs a fresh outbound profile behind it.
    const profile = await ensureOutboundProfile(apiKey, options.destinations ?? []);
    created.outbound_voice_profile = profile.created;
    const application = await ensureVoiceApplication(apiKey, name, webhook.voice, profile.id);
    connectionId = application.id;
    created.connection = application.created;
  }

  let messagingProfileId = text(number.messaging_profile_id);
  if (wantsMessaging && !messagingProfileId) {
    const profile = await ensureMessagingProfile(apiKey, name, webhook.messaging);
    messagingProfileId = profile.id;
    created.messaging_profile = profile.created;
  }

  if (connectionId && connectionId !== text(number.connection_id)) {
    await request(apiKey, `/phone_numbers/${encodeURIComponent(numberId)}`, {
      method: "PATCH",
      body: { connection_id: connectionId },
    });
    attached.connection = true;
  }
  if (messagingProfileId && messagingProfileId !== text(number.messaging_profile_id)) {
    // Assigning messaging is its own endpoint; the phone-number PATCH above
    // accepts connection_id but ignores messaging_profile_id.
    await request(apiKey, `/phone_numbers/${encodeURIComponent(numberId)}/messaging`, {
      method: "PATCH",
      body: { messaging_profile_id: messagingProfileId },
    });
    attached.messaging_profile = true;
  }

  const state = await discoverTelnyxNumber(apiKey, phoneNumber, env);
  return {
    ...state,
    connection_id: connectionId || state.connection_id,
    messaging_profile_id: messagingProfileId || state.messaging_profile_id,
    created,
    attached,
  };
}
