interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  FILES: R2Bucket;
  CONNECTORS?: Fetcher;
  COMPUTER: {
    exec(botId: string, command: string): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }>;
    run(botId: string, code: string, language?: "python" | "javascript" | "typescript"): Promise<unknown>;
    writeFile(botId: string, path: string, content: string): Promise<unknown>;
    readFile(botId: string, path: string): Promise<unknown>;
    destroy(botId: string): Promise<unknown>;
  };
}

interface User {
  id: string;
  email: string;
  name: string;
}

interface Message {
  id: string;
  role: "bot" | "user";
  kind: "text";
  text: string;
  at: number;
  parentId: string | null;
  from?: { botId: string; name: string; color: string };
  reactions?: Array<{ emoji: string; by: string }>;
  [key: string]: unknown;
}

interface Group {
  id: string;
  threadId: string;
  name: string;
  memberIds: string[];
  defaultResponder: { kind: "member"; botId: string } | { kind: "everyone" } | { kind: "mentions" };
  bulletin: string;
  unread: boolean;
  createdAt: number;
  messages: Message[];
  [key: string]: unknown;
}

interface Routine {
  id: string;
  name: string;
  prompt: string;
  botId: string;
  runOn: "maus" | "cloud";
  enabled: boolean;
  schedule: { type: "once"; at: number } | { type: "daily"; time: string; weekdays: number[] };
  durationMinutes: number;
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
}

interface RoutineRun {
  id: string;
  routineId: string;
  routineName: string;
  prompt: string;
  botId: string;
  runOn: "maus" | "cloud";
  scheduledFor: number;
  status: "completed" | "failed" | "cancelled";
  manual: boolean;
  triggerSource: "schedule" | "manual" | "webhook";
  createdAt: number;
  startedAt: number;
  finishedAt: number;
  output?: string;
  error?: string;
  seenAt?: number;
  [key: string]: unknown;
}

interface WebhookRecord {
  id: string;
  endpointId: string;
  name: string;
  prompt: string;
  botId: string;
  runOn: "maus" | "cloud";
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  deliveryCount: number;
  verificationPending?: boolean;
  verifiedAt?: number;
  lastReceivedAt?: number;
  lastRunId?: string;
  eventTypes?: string[];
  [key: string]: unknown;
}

interface Bot {
  id: string;
  threadId: string;
  name: string;
  title: string;
  description: string;
  notifications: boolean;
  color: string;
  unread: boolean;
  busy: boolean;
  activity: "idle";
  modelSelection: { instanceId: string; model: string };
  computer: "cloud";
  cloudBackend: "cloudflare";
  createdAt: number;
  tasks: Array<{ threadId: string; title: string; createdAt: number }>;
  messages: Message[];
  activeLeafId: string | null;
  [key: string]: unknown;
}

const SESSION_COOKIE = "magicbot_session";
const SESSION_AGE = 60 * 60 * 24 * 30;
const MODEL = "@cf/zai-org/glm-5.2";
const encoder = new TextEncoder();

function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function redirect(location: string, headers: HeadersInit = {}): Response {
  return new Response(null, { status: 303, headers: { location, ...headers } });
}

function cookieValue(request: Request, name: string): string | null {
  const source = request.headers.get("cookie") ?? "";
  for (const part of source.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_AGE}`;
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function randomToken(bytes = 32): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function passwordHash(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    // Workers Web Crypto currently caps PBKDF2 at 100k iterations.
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100_000 },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

async function currentUser(request: Request, env: Env): Promise<User | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT users.id, users.email, users.name
       FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
  ).bind(tokenHash, Date.now()).first<User>();
  return row ?? null;
}

async function createSession(env: Env, userId: string): Promise<string> {
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), userId, Date.now() + SESSION_AGE * 1000, Date.now()).run();
  return token;
}

async function withinRateLimit(env: Env, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  await env.DB.prepare(
    `INSERT INTO rate_limits (key, window, count) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window = excluded.window THEN rate_limits.count + 1 ELSE 1 END,
       window = excluded.window`,
  ).bind(key, window).run();
  const row = await env.DB.prepare("SELECT count FROM rate_limits WHERE key = ?").bind(key).first<{ count: number }>();
  return (row?.count ?? limit + 1) <= limit;
}

async function requestBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return (await request.json()) as Record<string, string>;
  const form = await request.formData();
  const result: Record<string, string> = {};
  form.forEach((value, key) => { result[key] = String(value); });
  return result;
}

function safeNext(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function loginPage(message = "", mode: "login" | "signup" = "login"): Response {
  const signup = mode === "signup";
  const title = signup ? "Create your MagicBot account" : "Welcome back";
  const switchText = signup ? "Already have an account?" : "New to MagicBot?";
  const switchLink = signup ? "/login" : "/signup";
  const switchLabel = signup ? "Sign in" : "Create account";
  const escaped = message.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090b10;color:#eef1f7;font:15px/1.45 Inter,ui-sans-serif,system-ui,sans-serif}.glow{position:fixed;inset:0;background:radial-gradient(circle at 50% 15%,#7038ff33,transparent 38%),radial-gradient(circle at 10% 90%,#15a6ff18,transparent 34%);pointer-events:none}.card{position:relative;width:min(92vw,420px);padding:34px;border:1px solid #ffffff17;border-radius:24px;background:#141721e8;box-shadow:0 30px 90px #0009;backdrop-filter:blur(18px)}.brand{display:flex;align-items:center;gap:11px;margin-bottom:28px;font-weight:750;letter-spacing:-.02em}.mark{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,#8b5cff,#4ba9ff);box-shadow:0 8px 26px #744cff66}h1{margin:0 0 7px;font-size:27px;letter-spacing:-.04em}p{margin:0 0 24px;color:#99a2b5}.field{display:grid;gap:7px;margin:14px 0}label{font-size:12px;font-weight:650;color:#bdc4d2}input{width:100%;border:1px solid #ffffff18;border-radius:12px;background:#0c0e14;color:#fff;padding:12px 13px;outline:none}input:focus{border-color:#7a61ff;box-shadow:0 0 0 3px #7555ff22}button{width:100%;margin-top:9px;border:0;border-radius:12px;padding:12px;background:linear-gradient(135deg,#8058ff,#4a9dff);color:white;font-weight:750;cursor:pointer}.error{margin:0 0 16px;border:1px solid #ff657544;border-radius:10px;background:#ff405b14;color:#ff9ca7;padding:10px 12px;font-size:13px}.switch{margin:20px 0 0;text-align:center;font-size:13px}.switch a{color:#9d8bff;text-decoration:none;font-weight:700}.fine{margin-top:18px;text-align:center;color:#697185;font-size:11px}</style></head><body><div class="glow"></div><main class="card"><div class="brand"><span class="mark">✦</span> MagicBot</div><h1>${title}</h1><p>Your AI team, available securely from anywhere.</p>${escaped ? `<div class="error">${escaped}</div>` : ""}<form method="post" action="${signup ? "/signup" : "/login"}">${signup ? '<div class="field"><label for="name">Name</label><input id="name" name="name" autocomplete="name" required maxlength="80"></div>' : ""}<div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254"></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="8" required></div><button type="submit">${signup ? "Create account" : "Sign in"}</button></form><p class="switch">${switchText} <a href="${switchLink}">${switchLabel}</a></p><div class="fine">Protected by secure, HTTP-only sessions on Cloudflare.</div></main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } });
}

function newBot(name = "SupaMaus"): Bot {
  const id = crypto.randomUUID();
  const threadId = crypto.randomUUID();
  const createdAt = Date.now();
  const greeting: Message = {
    id: crypto.randomUUID(), role: "bot", kind: "text",
    text: `Hey — I'm ${name}. What should we work on?`, at: createdAt, parentId: null,
  };
  return {
    id, threadId, name, title: "Cloud AI assistant", description: "", notifications: true,
    color: "violet", unread: false, busy: false, activity: "idle",
    modelSelection: { instanceId: "cloudflare-ai", model: MODEL }, computer: "cloud",
    cloudBackend: "cloudflare", createdAt,
    tasks: [{ threadId, title: "Main", createdAt }], messages: [greeting], activeLeafId: greeting.id,
    _taskMessages: { [threadId]: { messages: [greeting], activeLeafId: greeting.id } },
  };
}

type HostedTable = "groups" | "routines" | "routine_runs";

async function listRecords<T>(env: Env, table: HostedTable, userId: string): Promise<T[]> {
  const rows = await env.DB.prepare(`SELECT data FROM ${table} WHERE user_id = ? ORDER BY updated_at DESC`)
    .bind(userId).all<{ data: string }>();
  return rows.results.map((row) => JSON.parse(row.data) as T);
}

async function loadRecord<T>(env: Env, table: HostedTable, userId: string, id: string): Promise<T | null> {
  const row = await env.DB.prepare(`SELECT data FROM ${table} WHERE id = ? AND user_id = ?`)
    .bind(id, userId).first<{ data: string }>();
  return row ? JSON.parse(row.data) as T : null;
}

async function saveRecord(env: Env, table: HostedTable, userId: string, id: string, data: unknown, createdAt: number): Promise<void> {
  const now = Date.now();
  if (table === "routine_runs") {
    const routineId = String((data as { routineId?: string }).routineId ?? "");
    await env.DB.prepare(
      `INSERT INTO routine_runs (id, user_id, routine_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE routine_runs.user_id = excluded.user_id`,
    ).bind(id, userId, routineId, JSON.stringify(data), createdAt, now).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO ${table} (id, user_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE ${table}.user_id = excluded.user_id`,
  ).bind(id, userId, JSON.stringify(data), createdAt, now).run();
}

async function deleteRecord(env: Env, table: HostedTable, userId: string, id: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`).bind(id, userId).run();
}

function publicBot(bot: Bot): Bot {
  const { _taskMessages: _hidden, ...visible } = bot;
  return visible as Bot;
}

function stashTask(bot: Bot): void {
  const taskMessages = (bot._taskMessages ?? {}) as Record<string, { messages: Message[]; activeLeafId: string | null }>;
  taskMessages[bot.threadId] = { messages: bot.messages, activeLeafId: bot.activeLeafId };
  bot._taskMessages = taskMessages;
}

function activateTask(bot: Bot, threadId: string): boolean {
  if (!bot.tasks.some((task) => task.threadId === threadId)) return false;
  stashTask(bot);
  const taskMessages = bot._taskMessages as Record<string, { messages: Message[]; activeLeafId: string | null }>;
  const transcript = taskMessages[threadId] ?? { messages: [], activeLeafId: null };
  bot.threadId = threadId;
  bot.messages = transcript.messages;
  bot.activeLeafId = transcript.activeLeafId;
  return true;
}

async function saveBot(env: Env, userId: string, bot: Bot): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO bots (id, user_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
     WHERE bots.user_id = excluded.user_id`,
  ).bind(bot.id, userId, JSON.stringify(bot), bot.createdAt, Date.now()).run();
}

async function loadBot(env: Env, userId: string, botId: string): Promise<Bot | null> {
  const row = await env.DB.prepare("SELECT data FROM bots WHERE id = ? AND user_id = ?")
    .bind(botId, userId).first<{ data: string }>();
  return row ? JSON.parse(row.data) as Bot : null;
}

async function listBots(env: Env, userId: string): Promise<Bot[]> {
  const rows = await env.DB.prepare("SELECT data FROM bots WHERE user_id = ? ORDER BY updated_at DESC")
    .bind(userId).all<{ data: string }>();
  return rows.results.map((row) => JSON.parse(row.data) as Bot);
}

async function aiReply(env: Env, bot: Bot, text: string): Promise<string> {
  const history = bot.messages.filter((message) => message.kind === "text").slice(-24).map((message) => ({
    role: message.role === "bot" ? "assistant" : "user",
    content: message.text,
  }));
  const messages: Array<Record<string, unknown>> = [
      { role: "system", content: `You are ${bot.name}, ${bot.title || "a capable AI assistant"}. ${bot.description || "Be practical, clear, and proactive."}` },
      ...history,
      { role: "user", content: text },
  ];
  const tools = [{
    name: "computer_exec",
    description: "Run a shell command in this bot's private persistent Cloudflare Linux computer. Use it for coding, calculations, files, and command-line tasks.",
    parameters: {
      type: "object", properties: { command: { type: "string", description: "The shell command to run" } }, required: ["command"],
    },
  }];
  for (let step = 0; step < 5; step += 1) {
    const result = await env.AI.run(MODEL as keyof AiModels, { messages, tools, max_tokens: 2048 } as never) as {
      response?: string;
      tool_calls?: Array<{ name?: string; arguments?: Record<string, unknown> | string }>;
      choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
    };
    const openAiMessage = result.choices?.[0]?.message;
    const calls = result.tool_calls ?? openAiMessage?.tool_calls?.map((call) => ({
      name: call.function?.name,
      arguments: call.function?.arguments,
    })) ?? [];
    if (calls.length === 0) {
      return result.response ?? openAiMessage?.content ?? "I couldn't generate a reply. Please try again.";
    }
    for (const call of calls.slice(0, 3)) {
      let args: Record<string, unknown> = {};
      try { args = typeof call.arguments === "string" ? JSON.parse(call.arguments) : (call.arguments ?? {}); } catch { args = {}; }
      const command = typeof args.command === "string" ? args.command.slice(0, 20_000) : "";
      const toolResult = call.name === "computer_exec" && command
        ? await env.COMPUTER.exec(bot.id, command).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
        : { ok: false, error: "Invalid tool call" };
      messages.push({ role: "assistant", content: JSON.stringify(call) });
      messages.push({ role: "tool", content: JSON.stringify(toolResult).slice(0, 24_000) });
    }
  }
  return "I reached the computer-action limit for this turn. Ask me to continue and I'll pick up from here.";
}

function appendTurn(bot: Bot, text: string, reply: string): [Message, Message] {
  const userMessage: Message = {
    id: crypto.randomUUID(), role: "user", kind: "text", text, at: Date.now(), parentId: bot.activeLeafId,
  };
  const assistantMessage: Message = {
    id: crypto.randomUUID(), role: "bot", kind: "text", text: reply, at: Date.now(), parentId: userMessage.id,
  };
  bot.messages.push(userMessage, assistantMessage);
  bot.activeLeafId = assistantMessage.id;
  stashTask(bot);
  return [userMessage, assistantMessage];
}

function nextRun(schedule: Routine["schedule"], after = Date.now()): number | null {
  if (schedule.type === "once") return schedule.at > after ? schedule.at : null;
  const [hour, minute] = schedule.time.split(":").map(Number);
  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = new Date(after);
    candidate.setSeconds(0, 0);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0, 0, 0);
    if (candidate.getTime() > after && schedule.weekdays.includes(candidate.getDay())) return candidate.getTime();
  }
  return null;
}

async function executeRoutine(
  env: Env,
  userId: string,
  routine: Routine,
  options: { manual: boolean; triggerSource?: RoutineRun["triggerSource"]; prompt?: string; webhookId?: string; deliveryId?: string } = { manual: true },
): Promise<RoutineRun> {
  const startedAt = Date.now();
  const prompt = options.prompt ?? routine.prompt;
  const run: RoutineRun = {
    id: crypto.randomUUID(), routineId: routine.id, routineName: routine.name, prompt,
    botId: routine.botId, runOn: routine.runOn, scheduledFor: startedAt,
    status: "completed", manual: options.manual, triggerSource: options.triggerSource ?? (options.manual ? "manual" : "schedule"),
    createdAt: startedAt, startedAt, finishedAt: startedAt,
    ...(options.webhookId ? { webhookId: options.webhookId } : {}),
    ...(options.deliveryId ? { deliveryId: options.deliveryId } : {}),
  };
  try {
    const bot = await loadBot(env, userId, routine.botId);
    if (!bot) throw new Error("Assigned bot no longer exists");
    const taskId = crypto.randomUUID();
    stashTask(bot);
    bot.tasks.unshift({ threadId: taskId, title: routine.name, createdAt: startedAt });
    bot.threadId = taskId;
    bot.messages = [];
    bot.activeLeafId = null;
    const output = await aiReply(env, bot, prompt);
    appendTurn(bot, prompt, output);
    await saveBot(env, userId, bot);
    run.threadId = taskId;
    run.output = output;
    run.finishedAt = Date.now();
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : String(error);
    run.finishedAt = Date.now();
  }
  await saveRecord(env, "routine_runs", userId, run.id, run, run.createdAt);
  return run;
}

async function listWebhooks(env: Env, userId: string): Promise<WebhookRecord[]> {
  const rows = await env.DB.prepare("SELECT data FROM webhooks WHERE user_id = ? ORDER BY updated_at DESC")
    .bind(userId).all<{ data: string }>();
  return rows.results.map((row) => JSON.parse(row.data) as WebhookRecord);
}

async function loadWebhook(env: Env, userId: string, id: string): Promise<WebhookRecord | null> {
  const row = await env.DB.prepare("SELECT data FROM webhooks WHERE id = ? AND user_id = ?")
    .bind(id, userId).first<{ data: string }>();
  return row ? JSON.parse(row.data) as WebhookRecord : null;
}

async function saveWebhook(env: Env, userId: string, webhook: WebhookRecord, secretHash?: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO webhooks (id, user_id, endpoint_id, secret_hash, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET endpoint_id = excluded.endpoint_id,
       secret_hash = COALESCE(excluded.secret_hash, webhooks.secret_hash), data = excluded.data, updated_at = excluded.updated_at
     WHERE webhooks.user_id = excluded.user_id`,
  ).bind(webhook.id, userId, webhook.endpointId, secretHash ?? null, JSON.stringify(webhook), webhook.createdAt, Date.now()).run();
}

function webhookCredential(request: Request, webhook: WebhookRecord, secret: string) {
  const origin = new URL(request.url).origin;
  const endpointUrl = `${origin}/hooks/${webhook.endpointId}`;
  return { endpointUrl, secret, url: `${endpointUrl}?token=${encodeURIComponent(secret)}` };
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function handleWebhook(request: Request, env: Env, endpointId: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT user_id, secret_hash, data FROM webhooks WHERE endpoint_id = ?")
    .bind(endpointId).first<{ user_id: string; secret_hash: string | null; data: string }>();
  if (!row) return json({ error: "Webhook not found" }, 404);
  const webhook = JSON.parse(row.data) as WebhookRecord;
  const url = new URL(request.url);
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const token = url.searchParams.get("token") ?? bearer;
  if (!row.secret_hash || !token || !constantTimeEqual(row.secret_hash, await sha256(token))) {
    return json({ error: "Invalid webhook credential" }, 401);
  }
  if (!webhook.enabled) return json({ error: "Webhook is paused" }, 409);
  const eventName = request.headers.get("x-github-event") ?? request.headers.get("x-event-type") ?? "webhook";
  if (webhook.eventTypes?.length && !webhook.eventTypes.includes(eventName)) return json({ ignored: true, reason: "event type not enabled" }, 202);
  const raw = (await request.text()).slice(0, 250_000);
  let eventData = raw;
  try { eventData = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* keep text payload */ }
  const deliveryId = request.headers.get("x-github-delivery") ?? request.headers.get("x-delivery-id") ?? crypto.randomUUID();
  const prompt = `${webhook.prompt}\n\nEvent: ${eventName}\n[UNTRUSTED WEBHOOK EVENT DATA]\n${eventData}\n[/UNTRUSTED WEBHOOK EVENT DATA]`;
  const routine: Routine = {
    id: webhook.id, name: webhook.name, prompt, botId: webhook.botId, runOn: webhook.runOn, enabled: true,
    schedule: { type: "once", at: Date.now() }, durationMinutes: 30, nextRunAt: null,
    createdAt: webhook.createdAt, updatedAt: webhook.updatedAt,
  };
  const run = await executeRoutine(env, row.user_id, routine, { manual: false, triggerSource: "webhook", prompt, webhookId: webhook.id, deliveryId });
  webhook.deliveryCount += 1;
  webhook.lastReceivedAt = Date.now();
  webhook.lastRunId = run.id;
  if (webhook.verificationPending) { webhook.verificationPending = false; webhook.verifiedAt = Date.now(); webhook.enabled = false; }
  await saveWebhook(env, row.user_id, webhook);
  const attempt = {
    id: crypto.randomUUID(), webhookId: webhook.id, receivedAt: Date.now(), outcome: webhook.verifiedAt && !webhook.enabled ? "captured" : "accepted",
    statusCode: 202, eventName, preview: eventData.slice(0, 500), deliveryId, runId: run.id,
  };
  await env.DB.prepare("INSERT INTO webhook_attempts (id, user_id, webhook_id, data, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(attempt.id, row.user_id, webhook.id, JSON.stringify(attempt), attempt.receivedAt).run();
  return json({ accepted: true, runId: run.id, status: run.status }, 202);
}

async function runDueRoutines(env: Env): Promise<void> {
  const now = Date.now();
  const rows = await env.DB.prepare("SELECT user_id, data FROM routines ORDER BY updated_at ASC LIMIT 500")
    .all<{ user_id: string; data: string }>();
  let started = 0;
  for (const row of rows.results) {
    if (started >= 20) break;
    const routine = JSON.parse(row.data) as Routine;
    if (!routine.enabled || routine.nextRunAt === null || routine.nextRunAt > now) continue;
    started += 1;
    await executeRoutine(env, row.user_id, routine, { manual: false, triggerSource: "schedule" });
    if (routine.schedule.type === "once") routine.enabled = false;
    routine.nextRunAt = routine.enabled ? nextRun(routine.schedule, now + 1000) : null;
    routine.updatedAt = Date.now();
    await saveRecord(env, "routines", row.user_id, routine.id, routine, routine.createdAt);
  }
}

const CURATED_CONNECTORS = [
  ["slack", "Slack", "Post updates and read channels", "slack.com"],
  ["github", "GitHub", "Issues, pull requests, and code", "github.com"],
  ["gmail", "Gmail", "Read and send email", "gmail.com"],
  ["googlecalendar", "Google Calendar", "Read and create events", "calendar.google.com"],
  ["googlesheets", "Google Sheets", "Read and update spreadsheets", "sheets.google.com"],
  ["googledocs", "Google Docs", "Read and write documents", "docs.google.com"],
  ["googledrive", "Google Drive", "Browse and manage files", "drive.google.com"],
  ["notion", "Notion", "Pages and databases", "notion.so"],
  ["linear", "Linear", "Issues and project tracking", "linear.app"],
  ["sentry", "Sentry", "Errors and alerts", "sentry.io"],
  ["discord", "Discord", "Messages and channels", "discord.com"],
  ["x", "X (Twitter)", "Post and read on X", "x.com"],
  ["reddit", "Reddit", "Browse and post", "reddit.com"],
  ["hubspot", "HubSpot", "CRM search and updates", "hubspot.com"],
  ["salesforce", "Salesforce", "CRM records and reports", "salesforce.com"],
  ["jira", "Jira", "Issues and sprints", "atlassian.com"],
  ["asana", "Asana", "Tasks and projects", "asana.com"],
  ["trello", "Trello", "Boards and cards", "trello.com"],
  ["dropbox", "Dropbox", "Files and folders", "dropbox.com"],
  ["airtable", "Airtable", "Bases and records", "airtable.com"],
  ["figma", "Figma", "Files and comments", "figma.com"],
  ["stripe", "Stripe", "Payments and customers", "stripe.com"],
] as const;

async function connectorToken(env: Env, userId: string): Promise<string> {
  if (!env.CONNECTORS) throw new Error("Connected apps need a Composio API key");
  const existing = await env.DB.prepare("SELECT token FROM connector_installations WHERE user_id = ?")
    .bind(userId).first<{ token: string }>();
  if (existing?.token) return existing.token;
  const response = await env.CONNECTORS.fetch("https://connectors.internal/v1/installations", {
    method: "POST", headers: { "user-agent": "magicbot-web-service" },
  });
  const body = await response.json<{ installationId?: string; token?: string; error?: string }>();
  if (!response.ok || !body.token || !body.installationId) throw new Error(body.error ?? "Connected-app setup failed");
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO connector_installations (user_id, installation_id, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING",
  ).bind(userId, body.installationId, body.token, now, now).run();
  const winner = await env.DB.prepare("SELECT token FROM connector_installations WHERE user_id = ?")
    .bind(userId).first<{ token: string }>();
  return winner?.token ?? body.token;
}

async function connectorRequest(env: Env, userId: string, path: string, init: RequestInit = {}): Promise<Response> {
  if (!env.CONNECTORS) throw new Error("Connected apps need a Composio API key");
  const token = await connectorToken(env, userId);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return env.CONNECTORS.fetch(`https://connectors.internal${path}`, { ...init, headers });
}

async function connectorJson(response: Response): Promise<Response> {
  const body = await response.json<unknown>().catch(() => ({ error: "Connected-app service returned an invalid response" }));
  return json(body, response.status);
}

async function api(request: Request, env: Env, user: User, path: string): Promise<Response> {
  if (request.method !== "GET" && !sameOrigin(request)) return json({ error: "Cross-origin request refused" }, 403);
  if (path === "/api/auth/me" && request.method === "GET") return json({ user });
  if (path === "/api/health") return json({ app: "magicbot-web", cloud: "cloudflare" });
  if (path === "/api/instances") return json({ instances: [{
    instanceId: "cloudflare-ai", driverKind: "cloudflareAi", displayName: "Cloudflare AI",
    snapshot: { state: "available", authenticated: true, billing: "metered" },
    models: { default: MODEL, options: [{ id: MODEL, label: "GLM 5.2" }] },
    capabilities: { computerMcp: true, agentsMcp: false, composioMcp: false, images: false, queueing: false },
    access: "custom",
  }] });
  if (path === "/api/config") {
    if (request.method === "PUT") {
      const body = await request.json<{ profile?: { name?: string; email?: string } }>();
      const name = body.profile?.name?.trim().slice(0, 80) || user.name;
      const email = body.profile?.email?.trim().toLowerCase() || user.email;
      if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Use a valid email address" }, 400);
      try {
        await env.DB.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").bind(name, email, user.id).run();
      } catch {
        return json({ error: "That email address is already in use" }, 409);
      }
      user = { ...user, name, email };
    }
    return json({
      xai: { configured: false }, composio: { configured: Boolean(env.CONNECTORS), mode: env.CONNECTORS ? "managed" : "unavailable" },
      cfComputer: { configured: true, url: "https://magicbot-cf-computer.everyai-com.workers.dev" },
      vps: { configured: false, sshAlias: "" }, rooms: { turnTimeoutMinutes: 5 },
      localVm: { mode: "shared", maxInstances: 0 }, tts: { configured: false, ready: false, voice: "" },
      imageGen: { configured: false }, profile: { name: user.name, email: user.email },
    });
  }
  if (path === "/api/connectors/catalog" && request.method === "GET") {
    try {
      const response = await connectorRequest(env, user.id, "/v1/catalog");
      if (response.ok) {
        const raw = await response.json<{ items?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> }>();
        const items = raw.items ?? raw.data ?? [];
        if (items.length) {
          const cards = items.map((item) => {
            const meta = (item.meta ?? {}) as Record<string, unknown>;
            const slug = String(item.slug ?? item.key ?? item.name ?? "").toLowerCase();
            return {
              slug, label: String(item.name ?? item.slug ?? slug),
              blurb: String(meta.description ?? item.description ?? "").slice(0, 90),
              logo: typeof meta.logo === "string" ? meta.logo : (typeof item.logo === "string" ? item.logo : null), domain: null,
            };
          }).filter((card) => card.slug);
          return json({ configured: true, mode: "managed", source: "api", cards });
        }
      }
    } catch { /* fall back to the curated catalog */ }
    const cards = CURATED_CONNECTORS.map(([slug, label, blurb, domain]) => ({ slug, label, blurb, logo: null, domain }));
    return json({ configured: Boolean(env.CONNECTORS), mode: env.CONNECTORS ? "managed" : "unavailable", source: "curated", cards });
  }
  if (path === "/api/connectors/connected" && request.method === "GET") {
    if (!env.CONNECTORS) return json({ configured: false, services: {} });
    return connectorJson(await connectorRequest(env, user.id, "/v1/connectors/connected"));
  }
  if (path === "/api/connectors" && request.method === "GET") {
    if (!env.CONNECTORS) return json({ configured: false, services: {} });
    const services = new URL(request.url).searchParams.get("services") ?? "";
    return connectorJson(await connectorRequest(env, user.id, `/v1/connectors?services=${encodeURIComponent(services)}`));
  }
  let connectorMatch = path.match(/^\/api\/connectors\/([a-z0-9][a-z0-9_-]{0,80})\/authorize$/);
  if (connectorMatch && request.method === "POST") {
    if (!env.CONNECTORS) return json({ error: "Connected apps need a Composio API key" }, 503);
    const body = await request.text();
    return connectorJson(await connectorRequest(env, user.id, `/v1/connectors/${connectorMatch[1]}/authorize`, { method: "POST", body: body || "{}" }));
  }
  connectorMatch = path.match(/^\/api\/connectors\/([a-z0-9][a-z0-9_-]{0,80})\/accounts\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/);
  if (connectorMatch && request.method === "DELETE") {
    if (!env.CONNECTORS) return json({ error: "Connected apps need a Composio API key" }, 503);
    return connectorJson(await connectorRequest(env, user.id, `/v1/connectors/${connectorMatch[1]}/accounts/${connectorMatch[2]}`, { method: "DELETE" }));
  }
  connectorMatch = path.match(/^\/api\/connectors\/([a-z0-9][a-z0-9_-]{0,80})$/);
  if (connectorMatch && request.method === "DELETE") {
    if (!env.CONNECTORS) return json({ error: "Connected apps need a Composio API key" }, 503);
    return connectorJson(await connectorRequest(env, user.id, `/v1/connectors/${connectorMatch[1]}`, { method: "DELETE" }));
  }
  if (path === "/api/routines" && request.method === "GET") {
    return json({
      routines: await listRecords<Routine>(env, "routines", user.id),
      runs: await listRecords<RoutineRun>(env, "routine_runs", user.id),
    });
  }
  if (path === "/api/routines" && request.method === "POST") {
    const body = await request.json<Partial<Routine>>();
    if (!body.name?.trim() || !body.prompt?.trim() || !body.botId || !body.schedule) {
      return json({ error: "Name, instructions, bot, and schedule are required" }, 400);
    }
    if (!await loadBot(env, user.id, body.botId)) return json({ error: "Assigned bot not found" }, 404);
    const createdAt = Date.now();
    const routine: Routine = {
      id: crypto.randomUUID(), name: body.name.trim().slice(0, 120), prompt: body.prompt.trim().slice(0, 20_000),
      botId: body.botId, runOn: body.runOn === "maus" ? "maus" : "cloud", enabled: body.enabled !== false,
      schedule: body.schedule, durationMinutes: Math.min(Math.max(Number(body.durationMinutes) || 30, 5), 240),
      nextRunAt: nextRun(body.schedule, createdAt), createdAt, updatedAt: createdAt,
    };
    await saveRecord(env, "routines", user.id, routine.id, routine, createdAt);
    return json({ routine }, 201);
  }
  let routineMatch = path.match(/^\/api\/routines\/([^/]+)\/run$/);
  if (routineMatch && request.method === "POST") {
    const routine = await loadRecord<Routine>(env, "routines", user.id, decodeURIComponent(routineMatch[1]));
    if (!routine) return json({ error: "Routine not found" }, 404);
    return json({ run: await executeRoutine(env, user.id, routine, { manual: true }) }, 201);
  }
  routineMatch = path.match(/^\/api\/routines\/([^/]+)$/);
  if (routineMatch) {
    const routineId = decodeURIComponent(routineMatch[1]);
    const routine = await loadRecord<Routine>(env, "routines", user.id, routineId);
    if (!routine) return json({ error: "Routine not found" }, 404);
    if (request.method === "DELETE") {
      await deleteRecord(env, "routines", user.id, routineId);
      return json({ ok: true });
    }
    if (request.method === "PATCH") {
      const body = await request.json<Partial<Routine>>();
      for (const key of ["name", "prompt", "botId", "runOn", "enabled", "schedule", "durationMinutes"] as const) {
        if (body[key] !== undefined) (routine as Record<string, unknown>)[key] = body[key];
      }
      routine.updatedAt = Date.now();
      routine.nextRunAt = routine.enabled ? nextRun(routine.schedule) : null;
      await saveRecord(env, "routines", user.id, routine.id, routine, routine.createdAt);
      return json({ routine });
    }
  }
  const runMatch = path.match(/^\/api\/routine-runs\/([^/]+)\/(cancel|seen)$/);
  if (runMatch && request.method === "POST") {
    const run = await loadRecord<RoutineRun>(env, "routine_runs", user.id, decodeURIComponent(runMatch[1]));
    if (!run) return json({ error: "Run not found" }, 404);
    if (runMatch[2] === "seen") run.seenAt = Date.now();
    else if (!run.finishedAt) { run.status = "cancelled"; run.finishedAt = Date.now(); }
    await saveRecord(env, "routine_runs", user.id, run.id, run, run.createdAt);
    return json({ run });
  }
  if (path === "/api/webhooks" && request.method === "GET") {
    const attempts = await env.DB.prepare("SELECT data FROM webhook_attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 2000")
      .bind(user.id).all<{ data: string }>();
    return json({
      webhooks: await listWebhooks(env, user.id),
      attempts: attempts.results.map((row) => JSON.parse(row.data)),
      ingress: { available: true, baseUrl: new URL(request.url).origin },
    });
  }
  if (path === "/api/webhooks" && request.method === "POST") {
    const body = await request.json<Partial<WebhookRecord>>();
    if (!body.botId || !await loadBot(env, user.id, body.botId)) return json({ error: "Assigned bot not found" }, 404);
    const createdAt = Date.now();
    const secret = randomToken();
    const webhook: WebhookRecord = {
      id: crypto.randomUUID(), endpointId: randomToken(12), name: body.name?.trim().slice(0, 120) || "MagicBot webhook",
      prompt: body.prompt?.trim().slice(0, 20_000) || "Handle this webhook event and report the result.",
      botId: body.botId, runOn: body.runOn === "maus" ? "maus" : "cloud", enabled: body.enabled !== false,
      createdAt, updatedAt: createdAt, deliveryCount: 0, verificationPending: body.verificationPending === true,
      eventTypes: Array.isArray(body.eventTypes) ? body.eventTypes.map(String).slice(0, 50) : [],
    };
    await saveWebhook(env, user.id, webhook, await sha256(secret));
    return json({ webhook, credential: webhookCredential(request, webhook, secret) }, 201);
  }
  let webhookMatch = path.match(/^\/api\/webhooks\/([^/]+)\/(rotate|test)$/);
  if (webhookMatch && request.method === "POST") {
    const webhook = await loadWebhook(env, user.id, decodeURIComponent(webhookMatch[1]));
    if (!webhook) return json({ error: "Webhook not found" }, 404);
    if (webhookMatch[2] === "test") {
      const routine: Routine = { id: webhook.id, name: webhook.name, prompt: webhook.prompt, botId: webhook.botId, runOn: webhook.runOn, enabled: true, schedule: { type: "once", at: Date.now() }, durationMinutes: 30, nextRunAt: null, createdAt: webhook.createdAt, updatedAt: webhook.updatedAt };
      const run = await executeRoutine(env, user.id, routine, { manual: true, triggerSource: "webhook", webhookId: webhook.id, prompt: webhook.prompt });
      return json({ webhook, run });
    }
    const secret = randomToken();
    webhook.updatedAt = Date.now();
    await saveWebhook(env, user.id, webhook, await sha256(secret));
    return json({ webhook, credential: webhookCredential(request, webhook, secret) });
  }
  webhookMatch = path.match(/^\/api\/webhooks\/([^/]+)$/);
  if (webhookMatch) {
    const webhookId = decodeURIComponent(webhookMatch[1]);
    const webhook = await loadWebhook(env, user.id, webhookId);
    if (!webhook) return json({ error: "Webhook not found" }, 404);
    if (request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM webhooks WHERE id = ? AND user_id = ?").bind(webhookId, user.id).run();
      return json({ ok: true });
    }
    if (request.method === "PATCH") {
      const body = await request.json<Partial<WebhookRecord>>();
      for (const key of ["name", "prompt", "botId", "runOn", "enabled", "verificationPending", "eventTypes"] as const) {
        if (body[key] !== undefined) (webhook as Record<string, unknown>)[key] = body[key];
      }
      webhook.updatedAt = Date.now();
      await saveWebhook(env, user.id, webhook);
      return json({ webhook });
    }
  }
  if (path === "/api/events") {
    return new Response(`data: ${JSON.stringify({ kind: "hello", resumed: false })}\n\n`, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" },
    });
  }
  if ((path === "/api/attachments" || path === "/api/file-attachments") && request.method === "POST") {
    const mime = (request.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
    const maxBytes = path === "/api/attachments" ? 10 * 1024 * 1024 : 25 * 1024 * 1024;
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > maxBytes) return json({ error: `Upload exceeds ${maxBytes / 1024 / 1024} MB` }, 413);
    if (path === "/api/attachments" && !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime)) {
      return json({ error: "Unsupported image type" }, 400);
    }
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > maxBytes) return json({ error: `Upload exceeds ${maxBytes / 1024 / 1024} MB` }, 413);
    const id = crypto.randomUUID();
    const name = (new URL(request.url).searchParams.get("name") ?? (path === "/api/attachments" ? "image" : "attachment"))
      .replace(/[\u0000-\u001f/\\]/g, "_").slice(0, 255);
    const objectKey = `${user.id}/${id}`;
    await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType: mime }, customMetadata: { name } });
    await env.DB.prepare("INSERT INTO attachments (id, user_id, object_key, name, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, user.id, objectKey, name, mime, bytes.byteLength, Date.now()).run();
    return json({ path: `/api/attachments/${id}`, mime, bytes: bytes.byteLength, name }, 201);
  }
  const attachmentMatch = path.match(/^\/api\/attachments\/([^/]+)$/);
  if (attachmentMatch && request.method === "GET") {
    const row = await env.DB.prepare("SELECT object_key, mime, name FROM attachments WHERE id = ? AND user_id = ?")
      .bind(decodeURIComponent(attachmentMatch[1]), user.id).first<{ object_key: string; mime: string; name: string }>();
    if (!row) return json({ error: "Attachment not found" }, 404);
    const object = await env.FILES.get(row.object_key);
    if (!object) return json({ error: "Attachment data not found" }, 404);
    return new Response(object.body, { headers: {
      "content-type": row.mime, "content-length": String(object.size), "cache-control": "private, max-age=31536000, immutable",
      "content-disposition": `inline; filename="${row.name.replaceAll('"', "")}"`, "x-content-type-options": "nosniff",
    } });
  }
  if (path === "/api/groups" && request.method === "POST") {
    const body = await request.json<{ memberIds?: string[]; name?: string; section?: string }>();
    const bots = await listBots(env, user.id);
    const known = new Set(bots.map((bot) => bot.id));
    const memberIds = [...new Set((body.memberIds ?? []).filter((id) => known.has(id)))];
    if (memberIds.length === 0) return json({ error: "A room needs at least one bot" }, 400);
    const createdAt = Date.now();
    const group: Group = {
      id: crypto.randomUUID(), threadId: crypto.randomUUID(), name: body.name?.trim().slice(0, 100) || "New room",
      memberIds, defaultResponder: { kind: "member", botId: memberIds[0] }, bulletin: "", unread: false,
      createdAt, messages: [], setupCompletedAt: createdAt, ...(body.section?.trim() ? { section: body.section.trim().slice(0, 60) } : {}),
    };
    await saveRecord(env, "groups", user.id, group.id, group, createdAt);
    return json({ group }, 201);
  }
  const groupSetupMatch = path.match(/^\/api\/groups\/([^/]+)\/setup$/);
  if (groupSetupMatch && request.method === "PATCH") {
    const group = await loadRecord<Group>(env, "groups", user.id, decodeURIComponent(groupSetupMatch[1]));
    if (!group) return json({ error: "Room not found" }, 404);
    const body = await request.json<Record<string, unknown>>();
    if (body.action === "skip") group.setupSkippedAt = Date.now();
    else {
      if (typeof body.bulletin === "string") group.bulletin = body.bulletin.slice(0, 12_000);
      if (body.defaultResponder && typeof body.defaultResponder === "object") group.defaultResponder = body.defaultResponder as Group["defaultResponder"];
      group.setupCompletedAt = Date.now();
    }
    await saveRecord(env, "groups", user.id, group.id, group, group.createdAt);
    return json({ group });
  }
  const groupMessagesMatch = path.match(/^\/api\/groups\/([^/]+)\/messages$/);
  if (groupMessagesMatch && request.method === "POST") {
    const group = await loadRecord<Group>(env, "groups", user.id, decodeURIComponent(groupMessagesMatch[1]));
    if (!group) return json({ error: "Room not found" }, 404);
    const body = await request.json<{ text?: string }>();
    const text = body.text?.trim() ?? "";
    if (!text || text.length > 20_000) return json({ error: "Message must be between 1 and 20,000 characters" }, 400);
    if (!await withinRateLimit(env, `chat:${user.id}`, 20, 60)) return json({ error: "Too many messages. Please wait a minute." }, 429);
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", kind: "text", text, at: Date.now(), parentId: group.messages.at(-1)?.id ?? null };
    const produced: Message[] = [userMessage];
    group.messages.push(userMessage);
    const members = await Promise.all(group.memberIds.map((id) => loadBot(env, user.id, id)));
    const available = members.filter((bot): bot is Bot => Boolean(bot));
    let speakers: Bot[];
    if (group.defaultResponder.kind === "everyone") speakers = available;
    else if (group.defaultResponder.kind === "member") {
      const responderId = group.defaultResponder.botId;
      speakers = available.filter((bot) => bot.id === responderId);
    } else speakers = available.filter((bot) => text.toLowerCase().includes(`@${bot.name.toLowerCase()}`));
    if (speakers.length === 0 && available[0]) speakers = [available[0]];
    for (const bot of speakers.slice(0, 8)) {
      const roomBot = { ...bot, messages: group.messages } as Bot;
      const reply = await aiReply(env, roomBot, `${group.bulletin ? `Room instructions: ${group.bulletin}\n\n` : ""}${text}`);
      const message: Message = {
        id: crypto.randomUUID(), role: "bot", kind: "text", text: reply, at: Date.now(), parentId: group.messages.at(-1)?.id ?? null,
        from: { botId: bot.id, name: bot.name, color: bot.color },
      };
      group.messages.push(message);
      produced.push(message);
    }
    await saveRecord(env, "groups", user.id, group.id, group, group.createdAt);
    return json({ threadId: group.threadId, messages: produced });
  }
  const groupReadMatch = path.match(/^\/api\/groups\/([^/]+)\/read$/);
  if (groupReadMatch && request.method === "POST") {
    const group = await loadRecord<Group>(env, "groups", user.id, decodeURIComponent(groupReadMatch[1]));
    if (!group) return json({ error: "Room not found" }, 404);
    group.unread = false;
    await saveRecord(env, "groups", user.id, group.id, group, group.createdAt);
    return json({ group });
  }
  const groupMatch = path.match(/^\/api\/groups\/([^/]+)$/);
  if (groupMatch) {
    const groupId = decodeURIComponent(groupMatch[1]);
    const group = await loadRecord<Group>(env, "groups", user.id, groupId);
    if (!group) return json({ error: "Room not found" }, 404);
    if (request.method === "DELETE") {
      await deleteRecord(env, "groups", user.id, groupId);
      return json({ ok: true });
    }
    if (request.method === "PATCH") {
      const body = await request.json<Record<string, unknown>>();
      for (const key of ["name", "memberIds", "defaultResponder", "bulletin", "unread", "section", "pinnedMessageId"] as const) {
        if (body[key] !== undefined) (group as Record<string, unknown>)[key] = body[key];
      }
      await saveRecord(env, "groups", user.id, group.id, group, group.createdAt);
      return json({ group });
    }
  }
  const threadMessagesMatch = path.match(/^\/api\/threads\/([^/]+)\/messages$/);
  if (threadMessagesMatch && request.method === "GET") {
    const threadId = decodeURIComponent(threadMessagesMatch[1]);
    const bots = await listBots(env, user.id);
    for (const bot of bots) {
      const taskMessages = (bot._taskMessages ?? {}) as Record<string, { messages: Message[]; activeLeafId: string | null }>;
      if (bot.threadId === threadId || taskMessages[threadId]) {
        const messages = bot.threadId === threadId ? bot.messages : taskMessages[threadId].messages;
        return json({ messages, hasMore: false });
      }
    }
    const group = (await listRecords<Group>(env, "groups", user.id)).find((item) => item.threadId === threadId);
    return group ? json({ messages: group.messages, hasMore: false }) : json({ error: "Conversation not found" }, 404);
  }
  const reactionMatch = path.match(/^\/api\/threads\/([^/]+)\/messages\/([^/]+)\/reactions$/);
  if (reactionMatch && request.method === "POST") {
    const threadId = decodeURIComponent(reactionMatch[1]);
    const messageId = decodeURIComponent(reactionMatch[2]);
    const body = await request.json<{ emoji?: string; by?: string }>();
    const emoji = body.emoji?.slice(0, 16) ?? "";
    const bots = await listBots(env, user.id);
    const bot = bots.find((item) => item.threadId === threadId);
    if (bot) {
      const message = bot.messages.find((item) => item.id === messageId);
      if (!message) return json({ error: "Message not found" }, 404);
      const existing = message.reactions ?? [];
      message.reactions = existing.some((item) => item.emoji === emoji && item.by === "user")
        ? existing.filter((item) => !(item.emoji === emoji && item.by === "user")) : [...existing, { emoji, by: "user" }];
      await saveBot(env, user.id, bot);
      return json({ message });
    }
    const group = (await listRecords<Group>(env, "groups", user.id)).find((item) => item.threadId === threadId);
    const message = group?.messages.find((item) => item.id === messageId);
    if (!group || !message) return json({ error: "Message not found" }, 404);
    const existing = message.reactions ?? [];
    message.reactions = existing.some((item) => item.emoji === emoji && item.by === "user")
      ? existing.filter((item) => !(item.emoji === emoji && item.by === "user")) : [...existing, { emoji, by: "user" }];
    await saveRecord(env, "groups", user.id, group.id, group, group.createdAt);
    return json({ message });
  }
  const threadExportMatch = path.match(/^\/api\/threads\/([^/]+)\/export$/);
  if (threadExportMatch && request.method === "GET") {
    const threadId = decodeURIComponent(threadExportMatch[1]);
    let title = "Conversation";
    let messages: Message[] | null = null;
    for (const bot of await listBots(env, user.id)) {
      const task = bot.tasks.find((item) => item.threadId === threadId);
      if (!task) continue;
      const taskMessages = (bot._taskMessages ?? {}) as Record<string, { messages: Message[] }>;
      messages = bot.threadId === threadId ? bot.messages : (taskMessages[threadId]?.messages ?? []);
      title = task.title || bot.name;
      break;
    }
    if (!messages) {
      const group = (await listRecords<Group>(env, "groups", user.id)).find((item) => item.threadId === threadId);
      if (group) { messages = group.messages; title = group.name; }
    }
    if (!messages) return json({ error: "Conversation not found" }, 404);
    const format = new URL(request.url).searchParams.get("format") ?? "markdown";
    const filename = (title.replace(/[^\w\- ]+/g, "").trim() || "conversation").slice(0, 60);
    if (format === "json") return new Response(JSON.stringify({ name: title, threadId, messages }, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${filename}.json"` },
    });
    const lines = [`# ${title}`, ""];
    for (const message of messages) {
      const speaker = message.role === "user" ? user.name : (message.from?.name ?? "MagicBot");
      if (message.text) lines.push(`**${speaker}:**`, "", message.text, "");
    }
    return new Response(lines.join("\n"), {
      headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${filename}.md"` },
    });
  }
  const threadEventsMatch = path.match(/^\/api\/threads\/([^/]+)\/events$/);
  if (threadEventsMatch && request.method === "GET") {
    const threadId = decodeURIComponent(threadEventsMatch[1]);
    let messages: Message[] | null = null;
    for (const bot of await listBots(env, user.id)) {
      const taskMessages = (bot._taskMessages ?? {}) as Record<string, { messages: Message[] }>;
      if (bot.threadId === threadId) messages = bot.messages;
      else if (taskMessages[threadId]) messages = taskMessages[threadId].messages;
      if (messages) break;
    }
    if (!messages) messages = (await listRecords<Group>(env, "groups", user.id)).find((item) => item.threadId === threadId)?.messages ?? null;
    if (!messages) return json({ error: "Thread not found" }, 404);
    const entries = messages.map((message) => ({
      kind: "runtime", at: message.at,
      data: { type: "item.completed", threadId, createdAt: message.at, itemType: message.role === "user" ? "user_text" : "assistant_text", text: message.text ?? "" },
    }));
    return json({ entries, total: { runtime: entries.length, native: 0 } });
  }
  if (path === "/api/decisions" && request.method === "GET") return json({ decisions: [] });
  if (path === "/api/teams/export" && request.method === "POST") {
    const body: { botIds?: string[]; groupId?: string } = await request.json<{ botIds?: string[]; groupId?: string }>().catch(() => ({}));
    const bots = (await listBots(env, user.id)).filter((bot) => !bot.hidden);
    let memberIds = body.botIds?.filter((id) => bots.some((bot) => bot.id === id)) ?? bots.map((bot) => bot.id);
    let teamName = `${user.name}'s MagicBot team`;
    if (body.groupId) {
      const group = await loadRecord<Group>(env, "groups", user.id, body.groupId);
      if (group) { memberIds = group.memberIds; teamName = group.name; }
    }
    const used = new Set<string>();
    const members = memberIds.flatMap((id, index) => {
      const bot = bots.find((item) => item.id === id);
      if (!bot) return [];
      let key = bot.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `member-${index + 1}`;
      const stem = key;
      for (let suffix = 2; used.has(key); suffix += 1) key = `${stem}-${suffix}`;
      used.add(key);
      return [{ key, name: bot.name, title: bot.title, description: bot.description, appearance: { color: bot.color, ...(bot.mascotExpression ? { mascotExpression: bot.mascotExpression } : {}) } }];
    });
    return json({ format: "openmaus.team", version: 2, team: { name: teamName, members } });
  }
  if (path === "/api/teams/import" && request.method === "POST") {
    const manifest = await request.json<{ team?: { name?: string; members?: Array<{ name?: string; title?: string; description?: string; appearance?: { color?: string; mascotExpression?: string } }> } }>();
    const members = manifest.team?.members ?? [];
    if (members.length === 0 || members.length > 200) return json({ error: "Team must contain 1-200 members" }, 400);
    const imported: Bot[] = [];
    for (const member of members) {
      if (!member.name?.trim()) return json({ error: "Every team member needs a name" }, 400);
      const bot = newBot(member.name.trim().slice(0, 100));
      bot.title = member.title?.trim().slice(0, 200) ?? "";
      bot.description = member.description?.trim().slice(0, 4000) ?? "";
      if (member.appearance?.color) bot.color = member.appearance.color;
      if (member.appearance?.mascotExpression) bot.mascotExpression = member.appearance.mascotExpression.slice(0, 80);
      bot.composio = false;
      await saveBot(env, user.id, bot);
      imported.push(publicBot(bot));
    }
    return json({ bots: imported }, 201);
  }
  if (path === "/api/team-library/catalog" && request.method === "GET") return json({ teams: [] });
  if (path === "/api/search" && request.method === "GET") {
    const query = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase();
    const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit")) || 40, 1), 100);
    if (!query) return json({ hits: [] });
    const hits: Array<Record<string, unknown>> = [];
    for (const bot of await listBots(env, user.id)) {
      const taskByThread = new Map(bot.tasks.map((task) => [task.threadId, task.title]));
      const taskMessages = (bot._taskMessages ?? { [bot.threadId]: { messages: bot.messages } }) as Record<string, { messages: Message[] }>;
      for (const [threadId, transcript] of Object.entries(taskMessages)) for (const message of transcript.messages) {
        if (message.text?.toLowerCase().includes(query)) hits.push({ threadId, messageId: message.id, text: message.text, role: message.role, at: message.at, botId: bot.id, name: bot.name, task: taskByThread.get(threadId), onActivePath: true });
      }
    }
    for (const group of await listRecords<Group>(env, "groups", user.id)) for (const message of group.messages) {
      if (message.text?.toLowerCase().includes(query)) hits.push({ threadId: group.threadId, messageId: message.id, text: message.text, role: message.role, at: message.at, groupId: group.id, name: group.name, onActivePath: true });
    }
    return json({ hits: hits.sort((a, b) => Number(b.at) - Number(a.at)).slice(0, limit) });
  }
  if (path === "/api/bots" && request.method === "GET") {
    let bots = await listBots(env, user.id);
    if (bots.length === 0) {
      const bot = newBot();
      await saveBot(env, user.id, bot);
      bots = [bot];
    }
    return json({ bots: bots.map(publicBot), groups: await listRecords<Group>(env, "groups", user.id), computerControl: {} });
  }
  if (path === "/api/bots" && request.method === "POST") {
    const bot = newBot("New bot");
    await saveBot(env, user.id, bot);
    return json({ bot: publicBot(bot) }, 201);
  }
  const computerMatch = path.match(/^\/api\/bots\/([^/]+)\/computer(?:\/(control|provision|exec|run|read-file|write-file|sleep|remove|join|screenshot))?$/);
  if (computerMatch) {
    const botId = decodeURIComponent(computerMatch[1]);
    const bot = await loadBot(env, user.id, botId);
    if (!bot) return json({ error: "Bot not found" }, 404);
    const action = computerMatch[2] ?? "status";
    // Bot IDs are globally random UUIDs and fit the Sandbox 63-character key limit.
    const sandboxId = bot.id;
    if (action === "status" && request.method === "GET") {
      return json({ backend: "cloudflare", configured: true, ready: true, container: "cloudflare", box: true, headless: true });
    }
    if (action === "control") {
      const body: { action?: string } = request.method === "POST" ? await request.json<{ action?: string }>().catch(() => ({})) : {};
      return json({ held: body.action === "take", helpReason: null });
    }
    if (action === "provision" && request.method === "POST") {
      return json({ backend: "cloudflare", configured: true, ready: true, container: "cloudflare", headless: true });
    }
    if (action === "exec" && request.method === "POST") {
      const body = await request.json<{ command?: string }>();
      const command = body.command?.trim().slice(0, 20_000) ?? "";
      if (!command) return json({ error: "Command required" }, 400);
      return json(await env.COMPUTER.exec(sandboxId, command));
    }
    if (action === "run" && request.method === "POST") {
      const body = await request.json<{ code?: string; language?: "python" | "javascript" | "typescript" }>();
      if (!body.code) return json({ error: "Code required" }, 400);
      return json(await env.COMPUTER.run(sandboxId, body.code.slice(0, 100_000), body.language));
    }
    if (action === "read-file" && request.method === "POST") {
      const body = await request.json<{ path?: string }>();
      if (!body.path) return json({ error: "Path required" }, 400);
      return json(await env.COMPUTER.readFile(sandboxId, body.path.slice(0, 1000)));
    }
    if (action === "write-file" && request.method === "POST") {
      const body = await request.json<{ path?: string; content?: string }>();
      if (!body.path || body.content === undefined) return json({ error: "Path and content required" }, 400);
      return json(await env.COMPUTER.writeFile(sandboxId, body.path.slice(0, 1000), body.content.slice(0, 1_000_000)));
    }
    if ((action === "sleep" || action === "remove") && request.method === "POST") {
      await env.COMPUTER.destroy(sandboxId);
      return json({ ok: true, container: "archived" });
    }
    if ((action === "join" || action === "screenshot") && request.method === "POST") {
      return json({ error: "This Cloudflare computer is headless; use chat or the shell tools instead." }, 409);
    }
  }
  const memoryTopicMatch = path.match(/^\/api\/bots\/([^/]+)\/memory\/topics\/([^/]+)$/);
  if (memoryTopicMatch && request.method === "GET") {
    const bot = await loadBot(env, user.id, decodeURIComponent(memoryTopicMatch[1]));
    if (!bot) return json({ error: "Bot not found" }, 404);
    const name = decodeURIComponent(memoryTopicMatch[2]);
    const topics = (bot.memoryTopics ?? {}) as Record<string, string>;
    return name in topics ? json({ name, text: topics[name] }) : json({ error: "Topic not found" }, 404);
  }
  const memoryMatch = path.match(/^\/api\/bots\/([^/]+)\/memory$/);
  if (memoryMatch) {
    const bot = await loadBot(env, user.id, decodeURIComponent(memoryMatch[1]));
    if (!bot) return json({ error: "Bot not found" }, 404);
    if (request.method === "GET") return json({ text: String(bot.memory ?? ""), topics: Object.keys((bot.memoryTopics ?? {}) as object) });
    if (request.method === "PUT") {
      const body = await request.json<{ text?: string }>();
      bot.memory = (body.text ?? "").slice(0, 200_000);
      await saveBot(env, user.id, bot);
      return json({ text: bot.memory, topics: Object.keys((bot.memoryTopics ?? {}) as object) });
    }
  }
  const tasksMatch = path.match(/^\/api\/bots\/([^/]+)\/tasks(?:\/([^/]+))?$/);
  if (tasksMatch) {
    const bot = await loadBot(env, user.id, decodeURIComponent(tasksMatch[1]));
    if (!bot) return json({ error: "Bot not found" }, 404);
    const threadId = tasksMatch[2] ? decodeURIComponent(tasksMatch[2]) : null;
    if (!threadId && request.method === "POST") {
      const body: { title?: string } = await request.json<{ title?: string }>().catch(() => ({}));
      const createdAt = Date.now();
      const nextThread = crypto.randomUUID();
      stashTask(bot);
      bot.tasks.unshift({ threadId: nextThread, title: body.title?.trim().slice(0, 120) || `Task ${bot.tasks.length + 1}`, createdAt });
      bot.threadId = nextThread;
      bot.messages = [];
      bot.activeLeafId = null;
      stashTask(bot);
      await saveBot(env, user.id, bot);
      return json({ bot: publicBot(bot), task: bot.tasks[0] }, 201);
    }
    if (threadId && request.method === "POST") {
      if (!activateTask(bot, threadId)) return json({ error: "Task not found" }, 404);
      await saveBot(env, user.id, bot);
      return json({ bot: publicBot(bot) });
    }
    if (threadId && request.method === "PATCH") {
      const body = await request.json<{ title?: string }>();
      const task = bot.tasks.find((item) => item.threadId === threadId);
      if (!task) return json({ error: "Task not found" }, 404);
      task.title = body.title?.trim().slice(0, 120) || task.title;
      await saveBot(env, user.id, bot);
      return json({ task });
    }
    if (threadId && request.method === "DELETE") {
      if (bot.tasks.length <= 1) return json({ error: "A bot keeps at least one task" }, 400);
      const deletingActive = bot.threadId === threadId;
      bot.tasks = bot.tasks.filter((item) => item.threadId !== threadId);
      const taskMessages = (bot._taskMessages ?? {}) as Record<string, unknown>;
      delete taskMessages[threadId];
      bot._taskMessages = taskMessages;
      if (deletingActive) {
        const next = bot.tasks[0];
        const transcript = (taskMessages[next.threadId] ?? { messages: [], activeLeafId: null }) as { messages: Message[]; activeLeafId: string | null };
        bot.threadId = next.threadId;
        bot.messages = transcript.messages;
        bot.activeLeafId = transcript.activeLeafId;
      }
      await saveBot(env, user.id, bot);
      return json({ bot: publicBot(bot) });
    }
  }
  const editMessageMatch = path.match(/^\/api\/bots\/([^/]+)\/messages\/([^/]+)\/edit$/);
  if (editMessageMatch && request.method === "POST") {
    const bot = await loadBot(env, user.id, decodeURIComponent(editMessageMatch[1]));
    if (!bot) return json({ error: "Bot not found" }, 404);
    const source = bot.messages.find((message) => message.id === decodeURIComponent(editMessageMatch[2]));
    if (!source || source.role !== "user") return json({ error: "Only user messages can be edited" }, 404);
    const body = await request.json<{ text?: string }>();
    const text = body.text?.trim() ?? "";
    if (!text) return json({ error: "Text required" }, 400);
    const branch: Message = { id: crypto.randomUUID(), role: "user", kind: "text", text, at: Date.now(), parentId: source.parentId };
    bot.messages.push(branch);
    bot.activeLeafId = branch.id;
    const reply = await aiReply(env, bot, text);
    const assistant: Message = { id: crypto.randomUUID(), role: "bot", kind: "text", text: reply, at: Date.now(), parentId: branch.id };
    bot.messages.push(assistant);
    bot.activeLeafId = assistant.id;
    stashTask(bot);
    await saveBot(env, user.id, bot);
    return json({ threadId: bot.threadId, messages: [branch, assistant] }, 202);
  }
  const branchMatch = path.match(/^\/api\/bots\/([^/]+)\/active-branch$/);
  if (branchMatch && request.method === "POST") {
    const bot = await loadBot(env, user.id, decodeURIComponent(branchMatch[1]));
    if (!bot) return json({ error: "Bot not found" }, 404);
    const body = await request.json<{ messageId?: string }>();
    if (!bot.messages.some((message) => message.id === body.messageId)) return json({ error: "Message not found" }, 404);
    bot.activeLeafId = body.messageId ?? null;
    stashTask(bot);
    await saveBot(env, user.id, bot);
    return json({ activeLeafId: bot.activeLeafId });
  }
  const interruptMatch = path.match(/^\/api\/bots\/([^/]+)\/interrupt$/);
  if (interruptMatch && request.method === "POST") return json({ ok: true });
  const botMatch = path.match(/^\/api\/bots\/([^/]+)$/);
  if (botMatch) {
    const botId = decodeURIComponent(botMatch[1]);
    const bot = await loadBot(env, user.id, botId);
    if (!bot) return json({ error: "Bot not found" }, 404);
    if (request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM bots WHERE id = ? AND user_id = ?").bind(botId, user.id).run();
      return json({ ok: true });
    }
    if (request.method === "PATCH") {
      const patch = await request.json<Record<string, unknown>>();
      const allowed = ["name", "title", "description", "notifications", "color", "unread", "modelSelection", "computer", "cloudBackend", "autoApprove", "speakReplies", "pinned", "hidden", "section", "chiefOfStaff", "composio"];
      for (const key of allowed) if (key in patch) bot[key] = patch[key];
      await saveBot(env, user.id, bot);
      const { messages: _messages, ...announcement } = bot;
      return json({ bot: announcement });
    }
  }
  const messagesMatch = path.match(/^\/api\/bots\/([^/]+)\/messages$/);
  if (messagesMatch && request.method === "POST") {
    const botId = decodeURIComponent(messagesMatch[1]);
    const bot = await loadBot(env, user.id, botId);
    if (!bot) return json({ error: "Bot not found" }, 404);
    if (!await withinRateLimit(env, `chat:${user.id}`, 20, 60)) {
      return json({ error: "Too many messages. Please wait a minute and try again." }, 429);
    }
    const body = await request.json<{ text?: string }>();
    const text = body.text?.trim() ?? "";
    if (!text || text.length > 20_000) return json({ error: "Message must be between 1 and 20,000 characters" }, 400);
    const reply = await aiReply(env, bot, text);
    const messages = appendTurn(bot, text, reply);
    await saveBot(env, user.id, bot);
    return json({ threadId: bot.threadId, messages });
  }
  return json({ error: "This feature is not available in the hosted version yet" }, 501);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const hookMatch = url.pathname.match(/^\/hooks\/([A-Za-z0-9_-]+)$/);
    if (hookMatch && request.method === "POST") return handleWebhook(request, env, hookMatch[1]);
    if (url.pathname === "/login" && request.method === "GET") return loginPage();
    if (url.pathname === "/signup" && request.method === "GET") return loginPage("", "signup");
    if ((url.pathname === "/login" || url.pathname === "/signup") && request.method === "POST") {
      if (!sameOrigin(request)) return loginPage("Cross-origin request refused", url.pathname === "/signup" ? "signup" : "login");
      const body = await requestBody(request);
      const email = (body.email ?? "").trim().toLowerCase();
      const password = body.password ?? "";
      const name = (body.name ?? email.split("@")[0] ?? "MagicBot user").trim().slice(0, 80);
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return loginPage("Use a valid email and a password of at least 8 characters.", url.pathname === "/signup" ? "signup" : "login");
      const clientAddress = request.headers.get("cf-connecting-ip") ?? "unknown";
      const addressKey = await sha256(clientAddress);
      const emailKey = await sha256(email);
      const allowed = url.pathname === "/signup"
        ? await withinRateLimit(env, `signup:${addressKey}`, 5, 60 * 60)
        : await withinRateLimit(env, `login:${addressKey}:${emailKey}`, 10, 15 * 60);
      if (!allowed) return loginPage("Too many attempts. Please wait and try again.", url.pathname === "/signup" ? "signup" : "login");
      let user: User | null = null;
      if (url.pathname === "/signup") {
        const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
        if (existing) return loginPage("An account already exists for this email.", "signup");
        const id = crypto.randomUUID();
        const salt = randomToken(18);
        await env.DB.prepare("INSERT INTO users (id, email, name, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(id, email, name || "MagicBot user", await passwordHash(password, salt), salt, Date.now()).run();
        user = { id, email, name: name || "MagicBot user" };
      } else {
        const row = await env.DB.prepare("SELECT id, email, name, password_hash, password_salt FROM users WHERE email = ?")
          .bind(email).first<User & { password_hash: string; password_salt: string }>();
        if (row && constantTimeEqual(row.password_hash, await passwordHash(password, row.password_salt))) user = row;
        if (!user) return loginPage("Email or password is incorrect.");
      }
      const token = await createSession(env, user.id);
      return redirect(safeNext(url.searchParams.get("next")), { "set-cookie": sessionCookie(token) });
    }
    if (url.pathname === "/logout") {
      const token = cookieValue(request, SESSION_COOKIE);
      if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
      return redirect("/login", { "set-cookie": clearSessionCookie() });
    }
    const user = await currentUser(request, env);
    if (!user) {
      if (url.pathname.startsWith("/api/")) return json({ error: "Authentication required" }, 401);
      return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    }
    if (url.pathname.startsWith("/api/")) return api(request, env, user, url.pathname);
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDueRoutines(env));
  },
} satisfies ExportedHandler<Env>;
