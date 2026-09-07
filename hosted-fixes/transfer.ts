import { Hono } from "hono";
import { requireUltravoxToolKey } from "../auth";
import { transferTwiml, verifyTwilioSignature } from "../transfer-helpers";
type Env = { Bindings: { DB: D1Database; ULTRAVOX_API_KEY?: string }; Variables: { userId: string; toolAuth?: boolean } };
const app = new Hono<Env>();
app.use("*", async (c, next) => {
  if (c.req.header("content-type")?.includes("application/x-www-form-urlencoded")) return next();
  return requireUltravoxToolKey(c, next);
});
app.post("/", async (c) => {
  const callback = c.req.header("content-type")?.includes("application/x-www-form-urlencoded");
  const form = callback ? new URLSearchParams(await c.req.text()) : null;
  const body = callback ? {} : await c.req.json();
  const callId = callback ? form?.get("CallSid") : body.call_sid;
  const agentId = callback ? c.req.query("agent_id") : body.agent_id;
  if (typeof callId !== "string" || !callId || typeof agentId !== "string" || !agentId) return c.json({ error: "Exact call ID and agent ID required" }, 400);
  const log = await c.env.DB.prepare("SELECT * FROM call_logs WHERE agent_id = ? AND (ultravox_call_id = ? OR twilio_call_sid = ?) LIMIT 1").bind(agentId, callId, callId).first<any>();
  if (!log) return c.json({ error: "Call not found for this agent" }, 404);
  const sourceNumber = log.direction === "inbound" ? log.recipient_number : log.caller_number;
  const config = sourceNumber ? await c.env.DB.prepare("SELECT * FROM phone_configs WHERE phone_number = ? AND user_id = ?").bind(sourceNumber, log.user_id).first<any>() : null;
  if (!config) return c.json({ error: "Call phone configuration not found" }, 409);
  if (callback) {
    if (config.provider && config.provider !== "twilio") return c.json({ error: "Invalid callback provider" }, 403);
    if (!await verifyTwilioSignature(c.req.url, form!, config.twilio_auth_token, c.req.header("x-twilio-signature") ?? "")) return c.json({ error: "Invalid callback signature" }, 401);
    if (form!.get("AccountSid") !== config.twilio_account_sid) return c.json({ error: "Invalid callback account" }, 403);
    if (["completed", "answered"].includes(form!.get("DialCallStatus") ?? "")) return c.body("<Response><Hangup/></Response>", 200, { "Content-Type": "text/xml" });
    if (!["busy", "no-answer", "failed", "canceled"].includes(form!.get("DialCallStatus") ?? "")) return c.json({ error: "Unexpected dial status" }, 400);
  } else if (!["initiated", "in-progress", "ringing", "answered"].includes(log.status)) return c.json({ error: "Call is not active" }, 409);
  const { results } = await c.env.DB.prepare("SELECT phone_number FROM call_forwarding_numbers WHERE agent_id = ? ORDER BY priority ASC, id ASC").bind(agentId).all<{ phone_number: string }>();
  const numbers = results.map((row) => row.phone_number);
  if (!numbers.length || numbers.some((n) => !/^\+[1-9]\d{6,14}$/.test(n))) return c.json({ error: "Valid forwarding numbers required" }, 409);
  const callbackUrl = new URL(c.req.url); callbackUrl.search = ""; callbackUrl.searchParams.set("agent_id", agentId);
  if (callback) return c.body(transferTwiml(numbers, Number(c.req.query("attempt")), callbackUrl.href), 200, { "Content-Type": "text/xml" });
  const providerId = log.twilio_call_sid;
  if (!providerId) return c.json({ error: "Phone provider call ID is missing; browser demos cannot be transferred" }, 409);
  if (config.provider === "telnyx") {
    if (!config.telnyx_api_key) return c.json({ error: "Telnyx credentials missing" }, 409);
    const state = await c.env.DB.prepare("SELECT join_url FROM telnyx_call_state WHERE call_control_id = ?").bind(providerId).first<{ join_url: string }>();
    if (!state) return c.json({ error: "Telnyx call state missing" }, 409);
    const transferState = "transfer-state:" + btoa(JSON.stringify({ currentIndex: 0, forwardingNumbers: numbers.map((phone_number) => ({ phone_number })), fromNumber: config.phone_number, currentLegAnswered: false }));
    await c.env.DB.prepare("UPDATE telnyx_call_state SET join_url = ? WHERE call_control_id = ?").bind(transferState, providerId).run();
    let response: Response;
    try {
      response = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(providerId)}/actions/transfer`, {
        method: "POST", signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${config.telnyx_api_key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to: numbers[0], from: config.phone_number, timeout_secs: 15, park_after_unbridge: "self", client_state: btoa(JSON.stringify({ type: "transfer-leg", originalCallControlId: providerId, currentIndex: 0 })), command_id: `transfer-${log.id}` }),
      });
    } catch {
      return c.json({ success: false, error: "Transfer response timed out; verify call state before retrying." }, 502);
    }
    if (!response.ok) {
      await c.env.DB.prepare("UPDATE telnyx_call_state SET join_url = ? WHERE call_control_id = ?").bind(state.join_url, providerId).run();
      return c.json({ error: `Telnyx rejected transfer (${response.status})` }, 502);
    }
    return c.json({ success: true, message: "Transfer initiated; phone provider callbacks determine the result." });
  }
  if (config.provider && config.provider !== "twilio") return c.json({ error: "This route supports Twilio and Telnyx transfers only" }, 501);
  if (!config.twilio_account_sid || !config.twilio_auth_token || !/^CA[a-fA-F0-9]{32}$/.test(providerId)) return c.json({ error: "Twilio credentials or call ID invalid" }, 409);
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.twilio_account_sid)}/Calls/${encodeURIComponent(providerId)}.json`, {
    method: "POST", signal: AbortSignal.timeout(15000), headers: { Authorization: `Basic ${btoa(`${config.twilio_account_sid}:${config.twilio_auth_token}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Twiml: transferTwiml(numbers, 0, callbackUrl.href) }),
  });
  if (!response.ok) return c.json({ error: `Phone provider rejected the transfer (${response.status})` }, 502);
  return c.json({ success: true, message: "Transfer initiated. Await the phone provider result." });
});
export default app;
