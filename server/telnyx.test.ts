// Telnyx provisioning is exercised entirely against a stubbed fetch: these
// tests must never create a real account resource. Each test asserts the exact
// API call the four known gaps depend on.
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverTelnyxNumber, normalizeTelnyxNumber, provisionTelnyxNumber, telnyxWebhookUrls } from "./telnyx.ts";

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

const ENV = { TELNYX_WEBHOOK_BASE_URL: "https://platform.example.com" } as NodeJS.ProcessEnv;

function stubTelnyx(routes: (call: Call) => unknown | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace("https://api.telnyx.com/v2", "");
    const call: Call = {
      method: init.method ?? "GET",
      path,
      body: init.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    const result = routes(call);
    if (result === undefined) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch);
  return calls;
}

const number = (over: Record<string, unknown> = {}) => ({
  id: "num-1",
  phone_number: "+18334905225",
  status: "active",
  connection_id: "",
  connection_name: "",
  messaging_profile_id: "",
  messaging_profile_name: "",
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe("normalizeTelnyxNumber", () => {
  it("accepts E.164 and strips formatting", () => {
    expect(normalizeTelnyxNumber("+1 (833) 490-5225")).toBe("+18334905225");
  });
  it("rejects anything that is not E.164", () => {
    expect(() => normalizeTelnyxNumber("8334905225")).toThrow(/international phone number/);
    expect(() => normalizeTelnyxNumber("nope")).toThrow(/international phone number/);
  });
});

describe("telnyxWebhookUrls", () => {
  it("defaults to the platform host and honours an override", () => {
    expect(telnyxWebhookUrls({} as NodeJS.ProcessEnv)).toEqual({
      voice: "https://magicteams-voice-api.everyai-com.workers.dev/api/webhooks/telnyx/status",
      messaging: "https://magicteams-voice-api.everyai-com.workers.dev/api/webhooks/telnyx/message",
    });
    expect(telnyxWebhookUrls(ENV)).toEqual({
      voice: "https://platform.example.com/api/webhooks/telnyx/status",
      messaging: "https://platform.example.com/api/webhooks/telnyx/message",
    });
  });
  it("refuses a non-HTTPS base", () => {
    expect(() => telnyxWebhookUrls({ TELNYX_WEBHOOK_BASE_URL: "http://localhost:8799" } as NodeJS.ProcessEnv))
      .toThrow(/public HTTPS/);
  });
});

describe("discoverTelnyxNumber", () => {
  it("only reads, and reports what is missing", async () => {
    const calls = stubTelnyx((call) => {
      if (call.path.startsWith("/phone_numbers?")) return { data: [number()] };
      throw new Error(`unexpected call ${call.method} ${call.path}`);
    });
    const state = await discoverTelnyxNumber("key", "+18334905225", ENV);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(state).toMatchObject({ number_id: "num-1", connection_id: "", messaging_profile_id: "" });
    expect(state.missing).toEqual(["voice connection", "messaging profile"]);
  });

  it("reports the outbound voice profile behind an existing connection", async () => {
    stubTelnyx((call) => {
      if (call.path.startsWith("/phone_numbers?")) return { data: [number({ connection_id: "app-1", connection_name: "app one", messaging_profile_id: "mp-1" })] };
      if (call.path.startsWith("/call_control_applications/")) return { data: { id: "app-1", outbound: { outbound_voice_profile_id: "ovp-1" } } };
      return undefined;
    });
    const state = await discoverTelnyxNumber("key", "+18334905225", ENV);
    expect(state).toMatchObject({ connection_id: "app-1", messaging_profile_id: "mp-1", outbound_voice_profile_id: "ovp-1" });
    expect(state.missing).toEqual([]);
  });

  it("binds the exact number rather than trusting the filter", async () => {
    stubTelnyx((call) => {
      if (call.path.startsWith("/phone_numbers?")) return { data: [number({ phone_number: "+18334905226" })] };
      return undefined;
    });
    await expect(discoverTelnyxNumber("key", "+18334905225", ENV)).rejects.toThrow(/not on this Telnyx account/);
  });
});

describe("provisionTelnyxNumber", () => {
  it("creates an outbound voice profile and puts it on the new application", async () => {
    const calls = stubTelnyx((call) => {
      if (call.path.startsWith("/phone_numbers?")) return { data: [number()] };
      if (call.path === "/outbound_voice_profiles?page[size]=250") return { data: [] };
      if (call.path === "/outbound_voice_profiles") return { data: { id: "ovp-9" } };
      if (call.path === "/call_control_applications?page[size]=250") return { data: [] };
      if (call.path === "/call_control_applications") return { data: { id: "app-9" } };
      if (call.method === "PATCH") return { data: {} };
      return undefined;
    });

    const result = await provisionTelnyxNumber("key", "+18334905225", { channel: "voice", env: ENV });

    const ovp = calls.find((call) => call.path === "/outbound_voice_profiles");
    expect(ovp?.body).toMatchObject({ name: "MagicTeams outbound", traffic_type: "conversational", enabled: true });

    const application = calls.find((call) => call.path === "/call_control_applications");
    expect(application?.body).toMatchObject({
      application_name: "MagicTeams +18334905225",
      webhook_event_url: "https://platform.example.com/api/webhooks/telnyx/status",
      webhook_api_version: "2",
      // the gap that caused outbound 403s: the profile has to be on the app
      outbound: { outbound_voice_profile_id: "ovp-9" },
    });

    const attach = calls.find((call) => call.method === "PATCH");
    expect(attach?.path).toBe("/phone_numbers/num-1");
    expect(attach?.body).toEqual({ connection_id: "app-9" });
    expect(result.created).toEqual({ outbound_voice_profile: true, connection: true, messaging_profile: false });
    expect(result.attached).toEqual({ connection: true, messaging_profile: false });
  });

  it("gives the messaging profile its webhook and attaches it on the messaging endpoint", async () => {
    const reuseCalls = stubTelnyx((call) => {
      if (call.path.startsWith("/phone_numbers?")) return { data: [number({ connection_id: "app-1", messaging_profile_id: "mp-1" })] };
      if (call.path.startsWith("/call_control_applications/")) return { data: { outbound: { outbound_voice_profile_id: "ovp-1" } } };
      if (call.path === "/messaging_profiles?page[size]=250") return { data: [{ id: "mp-1", name: "MagicTeams +18334905225" }] };
      return undefined;
    });

    // an existing profile is reused, so nothing is created
    const reused = await provisionTelnyxNumber("key", "+18334905225", { channel: "voice", enableSms: true, env: ENV });
    expect(reused.created.messaging_profile).toBe(false);
    expect(reuseCalls.some((call) => call.path === "/messaging_profiles")).toBe(false);

    const freshCalls = stubTelnyx((call) => {
      if (call.path.startsWith("/phone_numbers?")) return { data: [number()] };
      if (call.path === "/phone_numbers/num-1/messaging") return { data: {} };
      if (call.path === "/messaging_profiles?page[size]=250") return { data: [] };
      if (call.path === "/messaging_profiles") return { data: { id: "mp-9" } };
      return undefined;
    });
    // ...and a fresh number creates one WITH the inbound webhook
    const created = await provisionTelnyxNumber("key", "+18334905225", { channel: "sms", env: ENV });
    const profile = freshCalls.find((call) => call.path === "/messaging_profiles");
    expect(profile?.body).toMatchObject({
      name: "MagicTeams +18334905225",
      webhook_url: "https://platform.example.com/api/webhooks/telnyx/message",
      whitelisted_destinations: ["*"],
    });
    // the pasted code patched the number itself, which Telnyx ignores for messaging
    const attach = freshCalls.find((call) => call.path === "/phone_numbers/num-1/messaging");
    expect(attach?.method).toBe("PATCH");
    expect(attach?.body).toEqual({ messaging_profile_id: "mp-9" });
    expect(freshCalls.some((call) => call.path === "/phone_numbers/num-1" && call.method === "PATCH")).toBe(false);
    expect(created.created.messaging_profile).toBe(true);
  });

  it("never touches messaging for a voice-only connect, and is idempotent", async () => {
    const calls = stubTelnyx((call) => {
      if (call.path.startsWith("/phone_numbers?")) return { data: [number({ connection_id: "app-1", messaging_profile_id: "mp-1" })] };
      if (call.path.startsWith("/call_control_applications/")) return { data: { outbound: { outbound_voice_profile_id: "ovp-1" } } };
      return undefined;
    });
    const result = await provisionTelnyxNumber("key", "+18334905225", { channel: "voice", env: ENV });
    expect(calls.some((call) => call.method !== "GET")).toBe(false);
    expect(calls.some((call) => call.path.includes("messaging_profiles"))).toBe(false);
    expect(result.created).toEqual({ outbound_voice_profile: false, connection: false, messaging_profile: false });
    expect(result.attached).toEqual({ connection: false, messaging_profile: false });
  });

  it("reuses an existing outbound voice profile instead of creating a second", async () => {
    const calls = stubTelnyx((call) => {
      if (call.path.startsWith("/phone_numbers?")) return { data: [number()] };
      if (call.path === "/outbound_voice_profiles?page[size]=250") return { data: [{ id: "ovp-existing", name: "MagicTeams outbound", enabled: true }] };
      if (call.path === "/call_control_applications?page[size]=250") return { data: [{ id: "app-existing", application_name: "MagicTeams +18334905225" }] };
      if (call.method === "PATCH") return { data: {} };
      return undefined;
    });
    const result = await provisionTelnyxNumber("key", "+18334905225", { channel: "voice", env: ENV });
    const application = calls.find((call) => call.path === "/call_control_applications");
    expect(application).toBeUndefined();
    expect(result.created.outbound_voice_profile).toBe(false);
    expect(result.created.connection).toBe(false);
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ connection_id: "app-existing" });
  });

  it("surfaces a rejected key without leaking it", async () => {
    vi.stubGlobal("fetch", (async () => new Response(JSON.stringify({ errors: [{ detail: "nope" }] }), { status: 401 })) as typeof fetch);
    await expect(provisionTelnyxNumber("secret-key", "+18334905225", { channel: "voice", env: ENV }))
      .rejects.toThrow(/rejected the API key/);
  });
});
