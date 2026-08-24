import {
  createCodexFetch,
  ensureFreshTokens,
  exchangeDeviceAuthorization,
  listCodexModels,
  pollDeviceCode,
  requestDeviceCode,
  resolveConfig,
  type ChatGPTTokens,
} from "@opencoredev/loginwithchatgpt-core";

interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  FILES: R2Bucket;
  CREDENTIAL_KEY: string;
  CONNECTORS: {
    request(userId: string, apiKey: string, path: string, method?: string, body?: string, mcpSession?: string): Promise<{ status: number; body: string; contentType?: string; mcpSession?: string }>;
  };
  COMPUTER: {
    status(botId: string): Promise<{ running: boolean; exit: unknown }>;
    exec(botId: string, command: string): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }>;
    run(botId: string, code: string, language?: "python" | "javascript" | "typescript"): Promise<unknown>;
    writeFile(botId: string, path: string, content: string): Promise<unknown>;
    readFile(botId: string, path: string): Promise<unknown>;
    sleep(botId: string): Promise<unknown>;
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
  modelSelection: { instanceId: string; model: string; effort?: "none" | "low" | "medium" | "high" | "xhigh" };
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
const MODEL = "@cf/moonshotai/kimi-k2.6";
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const VOICE_MODEL = "@cf/deepgram/aura-2-en";
const CODEX_CREDENTIAL = "codex_subscription";
const CODEX_PENDING_SECRET = "codex_pending_secret";
const CODEX_MODELS_CACHE = "codex_models";
const CODEX_RUNTIME_READY = "codex_runtime_ready";
const CODEX_CONSENT_VERSION = "2026-08-24";
const CLAUDE_CREDENTIAL = "claude_code_subscription";
const CLAUDE_PENDING = "claude_code_pending";
const CLAUDE_RUNTIME_READY = "claude_code_runtime_ready";
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_REDIRECT = "https://console.anthropic.com/oauth/code/callback";
const CLAUDE_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_MODELS = ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"];
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

function base64Bytes(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function standardBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function bytesFromBase64(value: string): Uint8Array {
  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function credentialCryptoKey(env: Env): Promise<CryptoKey> {
  if (!env.CREDENTIAL_KEY) throw new Error("Credential encryption is not configured");
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode(env.CREDENTIAL_KEY));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function saveCredential(env: Env, userId: string, kind: string, value: string): Promise<void> {
  if (!value) {
    await env.DB.prepare("DELETE FROM user_credentials WHERE user_id = ? AND kind = ?").bind(userId, kind).run();
    return;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await credentialCryptoKey(env), encoder.encode(value));
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO user_credentials (user_id, kind, encrypted, iv, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, kind) DO UPDATE SET encrypted = excluded.encrypted, iv = excluded.iv, updated_at = excluded.updated_at`,
  ).bind(userId, kind, base64Bytes(new Uint8Array(encrypted)), base64Bytes(iv), now, now).run();
}

async function credentialValue(env: Env, userId: string, kind: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT encrypted, iv FROM user_credentials WHERE user_id = ? AND kind = ?")
    .bind(userId, kind).first<{ encrypted: string; iv: string }>();
  if (!row) return null;
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesFromBase64(row.iv) }, await credentialCryptoKey(env), bytesFromBase64(row.encrypted),
  );
  return new TextDecoder().decode(decrypted);
}

async function credentialConfigured(env: Env, userId: string, kind: string): Promise<boolean> {
  return Boolean(await env.DB.prepare("SELECT 1 AS present FROM user_credentials WHERE user_id = ? AND kind = ?")
    .bind(userId, kind).first());
}

async function codexTokens(env: Env, userId: string): Promise<ChatGPTTokens | null> {
  const raw = await credentialValue(env, userId, CODEX_CREDENTIAL);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ChatGPTTokens;
    return parsed.accessToken ? parsed : null;
  } catch {
    return null;
  }
}

const codexConfig = resolveConfig({});

async function freshCodexTokens(env: Env, userId: string): Promise<ChatGPTTokens> {
  const current = await codexTokens(env, userId);
  const fresh = await ensureFreshTokens(codexConfig, current ?? undefined, {
    onRefresh: (tokens) => saveCredential(env, userId, CODEX_CREDENTIAL, JSON.stringify(tokens)),
  });
  if (!fresh.accountId) throw new Error("ChatGPT account id is missing; reconnect Codex");
  return fresh;
}

async function discoverCodexModels(env: Env, userId: string, live = true): Promise<string[]> {
  if (live) {
    try {
      const models = await listCodexModels({
        config: codexConfig,
        getAuth: async () => {
          const tokens = await freshCodexTokens(env, userId);
          return { accessToken: tokens.accessToken, accountId: tokens.accountId! };
        },
      });
      if (models.length > 0) {
        await saveCredential(env, userId, CODEX_MODELS_CACHE, JSON.stringify(models));
        return models;
      }
    } catch { /* use the last verified account catalog */ }
  }
  const cached = await credentialValue(env, userId, CODEX_MODELS_CACHE);
  if (!cached) return [];
  try {
    const parsed = JSON.parse(cached);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

type ClaudePending = { verifier: string; state: string; authorizeUrl: string; expiresAt: number };
type ClaudeCredential = { accessToken: string; refreshToken?: string; expiresAt?: number };

function randomUrlSafe(bytes: number): string {
  return base64Bytes(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function pkceChallenge(verifier: string): Promise<string> {
  return base64Bytes(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
}

function claudeExpiry(expiresIn?: number): number | undefined {
  return expiresIn ? Date.now() + expiresIn * 1000 - 5 * 60 * 1000 : undefined;
}

async function claudeCredential(env: Env, userId: string): Promise<ClaudeCredential | null> {
  const raw = await credentialValue(env, userId, CLAUDE_CREDENTIAL);
  if (!raw) return null;
  if (raw.startsWith("sk-ant-oat")) return { accessToken: raw };
  try {
    const parsed = JSON.parse(raw) as ClaudeCredential;
    return parsed.accessToken ? parsed : null;
  } catch { return null; }
}

async function freshClaudeCredential(env: Env, userId: string): Promise<ClaudeCredential> {
  const current = await claudeCredential(env, userId);
  if (!current) throw new Error("Connect Claude in App Settings → Engines");
  if (!current.expiresAt || current.expiresAt > Date.now()) return current;
  if (!current.refreshToken) throw new Error("Claude connection expired; reconnect Claude");
  const response = await fetch(CLAUDE_TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", client_id: CLAUDE_CLIENT_ID, refresh_token: current.refreshToken }),
  });
  if (!response.ok) throw new Error("Claude connection expired; reconnect Claude");
  const body = await response.json<{ access_token?: string; refresh_token?: string; expires_in?: number }>();
  if (!body.access_token) throw new Error("Claude connection expired; reconnect Claude");
  const fresh = { accessToken: body.access_token, refreshToken: body.refresh_token ?? current.refreshToken, expiresAt: claudeExpiry(body.expires_in) };
  await saveCredential(env, userId, CLAUDE_CREDENTIAL, JSON.stringify(fresh));
  return fresh;
}

async function claudeRequest(env: Env, userId: string, body: Record<string, unknown>): Promise<Response> {
  const credential = await freshClaudeCredential(env, userId);
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      authorization: `Bearer ${credential.accessToken}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
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
  return {
    ...visible,
    modelSelection: visible.modelSelection?.instanceId === "cloudflare-ai"
      ? { ...visible.modelSelection, model: MODEL }
      : visible.modelSelection,
  } as Bot;
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

async function generatedImage(env: Env, userId: string, prompt: string, name = "generated-avatar.jpg"): Promise<string> {
  const result = await env.AI.run(IMAGE_MODEL as keyof AiModels, {
    prompt: prompt.slice(0, 2_000),
  } as never) as { image?: string };
  if (!result.image) throw new Error("Image generation returned no image");
  const bytes = bytesFromBase64(result.image);
  const id = crypto.randomUUID();
  const objectKey = `${userId}/${id}`;
  await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { name } });
  await env.DB.prepare("INSERT INTO attachments (id, user_id, object_key, name, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, userId, objectKey, name, "image/jpeg", bytes.byteLength, Date.now()).run();
  return `/api/attachments/${id}`;
}

function parseMcpPayload(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as Record<string, unknown>;
  const data = trimmed.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
  return data ? JSON.parse(data) as Record<string, unknown> : {};
}

async function mcpRequest(
  env: Env, userId: string, session: string, method: string, params: Record<string, unknown> = {}, id = crypto.randomUUID(),
): Promise<{ payload: Record<string, unknown>; session: string }> {
  const response = await connectorRequest(env, userId, "/v1/mcp", {
    method: "POST", headers: session ? { "mcp-session-id": session } : {},
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error((parseMcpPayload(text).error as { message?: string } | undefined)?.message ?? `Connected-app tools returned ${response.status}`);
  return { payload: parseMcpPayload(text), session: response.headers.get("mcp-session-id") ?? session };
}

async function connectorTools(env: Env, userId: string): Promise<{ tools: Array<Record<string, unknown>>; session: string }> {
  if (!await credentialConfigured(env, userId, "composio")) return { tools: [], session: "" };
  const initialized = await mcpRequest(env, userId, "", "initialize", {
    protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "magicbot-web", version: "1.0" },
  });
  const listed = await mcpRequest(env, userId, initialized.session, "tools/list");
  const result = (listed.payload.result ?? {}) as { tools?: Array<{ name?: string; description?: string; inputSchema?: Record<string, unknown> }> };
  const tools = (result.tools ?? []).filter((tool) => tool.name).slice(0, 30).map((tool) => ({
    name: tool.name!, description: tool.description ?? `Use connected-app tool ${tool.name}`,
    parameters: tool.inputSchema ?? { type: "object", properties: {} },
  }));
  return { tools, session: listed.session };
}

type ModelContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

const ATTACHED_RESOURCE = /<attached-(image|file)\s+path="\/api\/attachments\/([^"&]+)"\s*\/?>(?:\s*\n)?/g;

function isReadableAttachment(mime: string, name: string): boolean {
  return mime.startsWith("text/") || [
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-javascript",
    "application/yaml",
  ].includes(mime) || /\.(?:txt|md|markdown|json|csv|tsv|xml|ya?ml|js|mjs|cjs|ts|tsx|jsx|css|html|py|rb|go|rs|java|kt|swift|sh|sql|log)$/i.test(name);
}

async function modelContentForPrompt(env: Env, userId: string, prompt: string): Promise<string | ModelContentPart[]> {
  const matches = [...prompt.matchAll(ATTACHED_RESOURCE)];
  if (matches.length === 0) return prompt;
  const notes: string[] = [];
  const images: ModelContentPart[] = [];
  for (const match of matches.slice(0, 6)) {
    const kind = match[1];
    const id = decodeURIComponent(match[2] ?? "");
    const row = await env.DB.prepare("SELECT object_key, mime, name, bytes FROM attachments WHERE id = ? AND user_id = ?")
      .bind(id, userId).first<{ object_key: string; mime: string; name: string; bytes: number }>();
    if (!row) {
      notes.push(`[Attachment unavailable: ${id}]`);
      continue;
    }
    const object = await env.FILES.get(row.object_key);
    if (!object) {
      notes.push(`[Attachment data unavailable: ${row.name}]`);
      continue;
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (kind === "image" && row.mime.startsWith("image/")) {
      images.push({ type: "image_url", image_url: { url: `data:${row.mime};base64,${standardBase64(bytes)}` } });
    } else if (isReadableAttachment(row.mime, row.name)) {
      const decoded = new TextDecoder().decode(bytes.subarray(0, 300_000));
      const clipped = bytes.length > 300_000 ? `${decoded}\n\n[File clipped after 300 KB]` : decoded;
      notes.push(`<uploaded-file name="${row.name.replaceAll('"', "'")}" type="${row.mime}">\n${clipped}\n</uploaded-file>`);
    } else {
      notes.push(`[Uploaded file ${row.name} (${row.mime}) cannot be read as text. Tell the user this file type is not supported yet.]`);
    }
  }
  const cleanPrompt = prompt.replace(ATTACHED_RESOURCE, "").trim();
  const text = [cleanPrompt, ...notes].filter(Boolean).join("\n\n") || "Describe the attached content.";
  return images.length > 0 ? [{ type: "text", text }, ...images] : text;
}

type CodexOutputItem = {
  id?: string;
  type?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  content?: Array<{ type?: string; text?: string }>;
};

type CodexCompleted = {
  output?: CodexOutputItem[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

async function readCodexResponse(response: Response): Promise<{ completed: CodexCompleted | null; text: string }> {
  const raw = await response.text();
  let completed: CodexCompleted | null = null;
  let deltaText = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const event = JSON.parse(payload) as { type?: string; delta?: string; response?: CodexCompleted };
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") deltaText += event.delta;
      if (event.type === "response.completed" && event.response) completed = event.response;
    } catch { /* SSE keepalives and partial lines are ignored */ }
  }
  const finalText = (completed?.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .map((block) => block.text ?? "")
    .join("");
  return { completed, text: finalText || deltaText };
}

async function verifyCodexRuntime(env: Env, userId: string, model: string): Promise<boolean> {
  try {
    const tokens = await freshCodexTokens(env, userId);
    const codexFetch = createCodexFetch({
      config: codexConfig,
      getAuth: () => ({ accessToken: tokens.accessToken, accountId: tokens.accountId! }),
      reasoningEffort: "low",
      textVerbosity: "low",
    });
    const response = await codexFetch(`${codexConfig.codexBaseUrl}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", session_id: crypto.randomUUID() },
      body: JSON.stringify({
        model,
        instructions: "This is a connection check.",
        input: [{ role: "user", content: [{ type: "input_text", text: "Reply exactly CONNECTED." }] }],
        tools: [], tool_choice: "none", parallel_tool_calls: false, stream: true,
      }),
    });
    if (!response.ok) throw new Error(`probe ${response.status}`);
    const parsed = await readCodexResponse(response);
    const ready = Boolean(parsed.completed && parsed.text.trim());
    await saveCredential(env, userId, CODEX_RUNTIME_READY, ready ? "true" : "");
    return ready;
  } catch {
    await saveCredential(env, userId, CODEX_RUNTIME_READY, "");
    return false;
  }
}

function codexPromptContent(content: string | ModelContentPart[]): unknown {
  if (typeof content === "string") return [{ type: "input_text", text: content }];
  return content.map((part) => part.type === "text"
    ? { type: "input_text", text: part.text }
    : { type: "input_image", image_url: part.image_url.url });
}

async function codexReply(env: Env, userId: string, bot: Bot, text: string): Promise<string> {
  const tokens = await freshCodexTokens(env, userId);
  const codexFetch = createCodexFetch({
    config: codexConfig,
    getAuth: () => ({ accessToken: tokens.accessToken, accountId: tokens.accountId! }),
    reasoningEffort: bot.modelSelection.effort === "none" ? "none" : (bot.modelSelection.effort as "low" | "medium" | "high" | "xhigh" | undefined),
  });
  const input: Array<Record<string, unknown>> = bot.messages
    .filter((message) => message.kind === "text")
    .slice(-24)
    .map((message) => ({
      role: message.role === "bot" ? "assistant" : "user",
      content: [{ type: message.role === "bot" ? "output_text" : "input_text", text: message.text }],
    }));
  input.push({ role: "user", content: codexPromptContent(await modelContentForPrompt(env, userId, text)) });

  const tools: Array<Record<string, unknown>> = [{
    type: "function", name: "computer_exec",
    description: "Run a shell command in this bot's private persistent Cloudflare Linux computer.",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  }, {
    type: "function", name: "generate_image",
    description: "Generate an image and save it to the user's MagicBot files.",
    parameters: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
  }];
  let connectorSession = "";
  const connectorToolNames = new Set<string>();
  if (bot.composio !== false) {
    try {
      const connected = await connectorTools(env, userId);
      connectorSession = connected.session;
      for (const tool of connected.tools) {
        if (typeof tool.name !== "string") continue;
        tools.push({ type: "function", ...tool });
        connectorToolNames.add(tool.name);
      }
    } catch { /* connected apps remain optional */ }
  }

  for (let step = 0; step < 5; step += 1) {
    const response = await codexFetch(`${codexConfig.codexBaseUrl}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", session_id: crypto.randomUUID() },
      body: JSON.stringify({
        model: bot.modelSelection.model,
        instructions: `You are ${bot.name}, ${bot.title || "a capable AI assistant"}. ${bot.description || "Be practical, clear, and proactive."}`,
        input, tools, tool_choice: "auto", parallel_tool_calls: false, stream: true,
      }),
    });
    if (!response.ok) throw new Error(`Codex returned ${response.status}; reconnect or try again later`);
    const parsed = await readCodexResponse(response);
    if (!parsed.completed) throw new Error("Codex response ended before completion");
    const calls = (parsed.completed.output ?? []).filter((item) => item.type === "function_call" && item.name && item.call_id);
    if (calls.length === 0) return parsed.text || "Codex completed without a text reply.";
    input.push(...(parsed.completed.output ?? []) as Array<Record<string, unknown>>);
    for (const call of calls.slice(0, 3)) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.arguments ?? "{}"); } catch { args = {}; }
      let result: unknown;
      if (call.name === "computer_exec" && typeof args.command === "string") {
        result = await env.COMPUTER.exec(bot.id, args.command.slice(0, 20_000))
          .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      } else if (call.name === "generate_image" && typeof args.prompt === "string") {
        result = await generatedImage(env, userId, args.prompt.slice(0, 2_000))
          .then((url) => ({ ok: true, url, instruction: `Embed with Markdown: ![generated image](${url})` }))
          .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      } else if (call.name && connectorToolNames.has(call.name)) {
        result = await mcpRequest(env, userId, connectorSession, "tools/call", { name: call.name, arguments: args })
          .then((called) => { connectorSession = called.session; return called.payload.result ?? called.payload; })
          .catch((error) => ({ isError: true, error: error instanceof Error ? error.message : String(error) }));
      } else result = { ok: false, error: "Invalid tool call" };
      input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result).slice(0, 24_000) });
    }
  }
  return "I reached the computer-action limit for this turn. Ask me to continue and I'll pick up from here.";
}

type AnthropicContentBlock = {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
};

function anthropicPromptContent(content: string | ModelContentPart[]): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ type: "text", text: content }];
  const blocks: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (part.type === "text") {
      blocks.push({ type: "text", text: part.text });
      continue;
    }
    const match = part.image_url.url.match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) blocks.push({ type: "text", text: "[Image attachment could not be encoded for Claude.]" });
    else blocks.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
  }
  return blocks;
}

async function anthropicReply(env: Env, userId: string, bot: Bot, text: string): Promise<string> {
  const messages: Array<Record<string, unknown>> = bot.messages
    .filter((message) => message.kind === "text")
    .slice(-24)
    .map((message) => ({ role: message.role === "bot" ? "assistant" : "user", content: message.text }));
  messages.push({ role: "user", content: anthropicPromptContent(await modelContentForPrompt(env, userId, text)) });

  const tools: Array<Record<string, unknown>> = [{
    name: "computer_exec",
    description: "Run a shell command in this bot's private persistent Cloudflare Linux computer.",
    input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  }, {
    name: "generate_image",
    description: "Generate an image and save it to the user's MagicBot files.",
    input_schema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
  }];
  let connectorSession = "";
  const connectorToolNames = new Set<string>();
  if (bot.composio !== false) {
    try {
      const connected = await connectorTools(env, userId);
      connectorSession = connected.session;
      for (const tool of connected.tools) {
        if (typeof tool.name !== "string") continue;
        tools.push({ name: tool.name, description: tool.description, input_schema: tool.parameters });
        connectorToolNames.add(tool.name);
      }
    } catch { /* connected apps remain optional */ }
  }

  for (let step = 0; step < 5; step += 1) {
    const response = await claudeRequest(env, userId, {
      model: bot.modelSelection.model,
      max_tokens: bot.modelSelection.model.includes("opus") || bot.modelSelection.model.includes("sonnet") ? 12_000 : 4096,
      system: [
        { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
        { type: "text", text: `You are ${bot.name}, ${bot.title || "a capable AI assistant"}. ${bot.description || "Be practical, clear, and proactive."}` },
      ],
      messages, tools,
    });
    if (!response.ok) {
      const detail = response.status === 401 || response.status === 403 ? "the Claude subscription needs to be reconnected" : `Anthropic returned ${response.status}`;
      throw new Error(`Claude could not answer because ${detail}.`);
    }
    const body = await response.json<{ content?: AnthropicContentBlock[] }>();
    const content = body.content ?? [];
    const calls = content.filter((block) => block.type === "tool_use" && block.id && block.name);
    if (calls.length === 0) {
      const answer = content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
      return answer || "Claude completed without a text reply.";
    }
    messages.push({ role: "assistant", content });
    const results: Array<Record<string, unknown>> = [];
    for (const [callIndex, call] of calls.entries()) {
      const args = call.input ?? {};
      let result: unknown;
      if (callIndex >= 3) {
        result = { ok: false, error: "Only three tool actions can run in one step" };
      } else if (call.name === "computer_exec" && typeof args.command === "string") {
        result = await env.COMPUTER.exec(bot.id, args.command.slice(0, 20_000))
          .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      } else if (call.name === "generate_image" && typeof args.prompt === "string") {
        result = await generatedImage(env, userId, args.prompt.slice(0, 2_000))
          .then((url) => ({ ok: true, url, instruction: `Embed with Markdown: ![generated image](${url})` }))
          .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      } else if (call.name && connectorToolNames.has(call.name)) {
        result = await mcpRequest(env, userId, connectorSession, "tools/call", { name: call.name, arguments: args })
          .then((called) => { connectorSession = called.session; return called.payload.result ?? called.payload; })
          .catch((error) => ({ isError: true, error: error instanceof Error ? error.message : String(error) }));
      } else result = { ok: false, error: "Invalid tool call" };
      results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result).slice(0, 24_000) });
    }
    messages.push({ role: "user", content: results });
  }
  return "I reached the computer-action limit for this turn. Ask me to continue and I'll pick up from here.";
}

async function aiReply(env: Env, userId: string, bot: Bot, text: string): Promise<string> {
  if (bot.modelSelection.instanceId === "codex-subscription") return codexReply(env, userId, bot, text);
  if (bot.modelSelection.instanceId === "claude-subscription" || bot.modelSelection.instanceId === "anthropic-api") return anthropicReply(env, userId, bot, text);
  const history = bot.messages.filter((message) => message.kind === "text").slice(-24).map((message) => ({
    role: message.role === "bot" ? "assistant" : "user",
    content: message.text,
  }));
  const userContent = await modelContentForPrompt(env, userId, text);
  const messages: Array<Record<string, unknown>> = [
      { role: "system", content: `You are ${bot.name}, ${bot.title || "a capable AI assistant"}. ${bot.description || "Be practical, clear, and proactive."}` },
      ...history,
      { role: "user", content: userContent },
  ];
  const tools: Array<Record<string, unknown>> = [{
    name: "computer_exec",
    description: "Run a shell command in this bot's private persistent Cloudflare Linux computer. Use it for coding, calculations, files, and command-line tasks.",
    parameters: {
      type: "object", properties: { command: { type: "string", description: "The shell command to run" } }, required: ["command"],
    },
  }, {
    name: "generate_image",
    description: "Generate an image and save it to the user's MagicBot files. Use when the user asks you to create an image, illustration, concept, or avatar.",
    parameters: {
      type: "object", properties: { prompt: { type: "string", description: "A detailed description of the image to generate" } }, required: ["prompt"],
    },
  }];
  let connectorSession = "";
  const connectorToolNames = new Set<string>();
  if (bot.composio !== false) {
    try {
      const connected = await connectorTools(env, userId);
      connectorSession = connected.session;
      for (const tool of connected.tools) {
        tools.push(tool);
        if (typeof tool.name === "string") connectorToolNames.add(tool.name);
      }
    } catch { /* a connector outage must not take ordinary chat down */ }
  }
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
      const prompt = typeof args.prompt === "string" ? args.prompt.slice(0, 2_000) : "";
      let toolResult: unknown;
      if (call.name === "computer_exec" && command) {
        toolResult = await env.COMPUTER.exec(bot.id, command).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      } else if (call.name === "generate_image" && prompt) {
        toolResult = await generatedImage(env, userId, prompt).then((url) => ({ ok: true, url, instruction: `Embed this image in the reply with Markdown: ![generated image](${url})` }))
          .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      } else if (call.name && connectorToolNames.has(call.name)) {
        toolResult = await mcpRequest(env, userId, connectorSession, "tools/call", { name: call.name, arguments: args })
          .then((result) => { connectorSession = result.session; return result.payload.result ?? result.payload; })
          .catch((error) => ({ isError: true, error: error instanceof Error ? error.message : String(error) }));
      } else toolResult = { ok: false, error: "Invalid tool call" };
      messages.push({ role: "assistant", content: JSON.stringify(call) });
      messages.push({ role: "tool", content: JSON.stringify(toolResult).slice(0, 24_000) });
    }
  }
  return "I reached the computer-action limit for this turn. Ask me to continue and I'll pick up from here.";
}

function appendTurn(bot: Bot, text: string, reply: string, clientMessageId?: string): [Message, Message] {
  const userMessage: Message = {
    id: clientMessageId && /^[A-Za-z0-9_-]{8,128}$/.test(clientMessageId) ? clientMessageId : crypto.randomUUID(),
    role: "user", kind: "text", text, at: Date.now(), parentId: bot.activeLeafId,
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
    const output = await aiReply(env, userId, bot, prompt);
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

const TEAM_LIBRARY_REPOSITORY = "https://github.com/milind-soni/openmausbot-teams";
const TEAM_LIBRARY_RAW = "https://raw.githubusercontent.com/milind-soni/openmausbot-teams/main";

async function fetchJsonLimited(url: string, maxBytes = 1_000_000): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(12_000) });
  if (response.status >= 300 && response.status < 400) throw new Error("GitHub returned an unexpected redirect");
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  const announced = Number(response.headers.get("content-length") ?? 0);
  if (announced > maxBytes) throw new Error("The remote file is too large");
  const text = await response.text();
  if (encoder.encode(text).byteLength > maxBytes) throw new Error("The remote file is too large");
  return JSON.parse(text);
}

function githubTeamUrls(input: string): string[] {
  const url = new URL(input.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Only public HTTPS GitHub links are supported");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (!parts.every((part) => /^[A-Za-z0-9._-]+$/.test(part) && part !== "." && part !== "..")) throw new Error("That GitHub path is not supported");
  if ((url.hostname === "github.com" || url.hostname === "www.github.com") && parts.length === 2) {
    return [`https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/main/team.mausteam.json`, `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/master/team.mausteam.json`];
  }
  if ((url.hostname === "github.com" || url.hostname === "www.github.com") && parts.length >= 5 && ["blob", "raw"].includes(parts[2])) {
    return [`https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts[3]}/${parts.slice(4).join("/")}`];
  }
  if (url.hostname === "raw.githubusercontent.com" && parts.length >= 4) return [`https://raw.githubusercontent.com/${parts.join("/")}`];
  throw new Error("Paste a GitHub repository or JSON team-file link");
}

async function connectorRequest(env: Env, userId: string, path: string, init: RequestInit = {}): Promise<Response> {
  const key = await credentialValue(env, userId, "composio");
  if (!key) throw new Error("Add a Composio project key in App Settings → Connections");
  const method = init.method ?? "GET";
  const body = typeof init.body === "string" ? init.body : "";
  const result = await env.CONNECTORS.request(userId, key, path, method, body, new Headers(init.headers).get("mcp-session-id") ?? "");
  const headers = new Headers({ "content-type": result.contentType ?? "application/json" });
  if (result.mcpSession) headers.set("mcp-session-id", result.mcpSession);
  return new Response(result.body, { status: result.status, headers });
}

async function connectorJson(response: Response): Promise<Response> {
  const body = await response.json<unknown>().catch(() => ({ error: "Connected-app service returned an invalid response" }));
  return json(body, response.status);
}

async function api(request: Request, env: Env, user: User, path: string): Promise<Response> {
  if (request.method !== "GET" && !sameOrigin(request)) return json({ error: "Cross-origin request refused" }, 403);
  if (path === "/api/auth/me" && request.method === "GET") return json({ user });
  if (path === "/api/health") return json({ app: "magicbot-web", cloud: "cloudflare" });
  if (path === "/api/codex/login" && request.method === "POST") {
    const body: { consentVersion?: string } = await request.json<{ consentVersion?: string }>().catch(() => ({}));
    if (body.consentVersion !== CODEX_CONSENT_VERSION) return json({ error: "Review and accept the current Codex connection notice" }, 400);
    if (!await withinRateLimit(env, `codex-login:${user.id}`, 5, 60 * 60)) return json({ error: "Too many connection attempts. Please try again later." }, 429);
    try {
      const device = await requestDeviceCode(codexConfig);
      await saveCredential(env, user.id, CODEX_PENDING_SECRET, device.deviceAuthId);
      await env.DB.prepare(
        `INSERT INTO codex_auth_pending
          (user_id, device_auth_id, user_code, verification_url, poll_interval, expires_at, last_polled_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT(user_id) DO UPDATE SET device_auth_id = excluded.device_auth_id,
           user_code = excluded.user_code, verification_url = excluded.verification_url,
           poll_interval = excluded.poll_interval, expires_at = excluded.expires_at,
           last_polled_at = 0, created_at = excluded.created_at`,
      ).bind(user.id, "encrypted", device.userCode, device.verificationUrl, device.interval, device.expiresAt, Date.now()).run();
      return json({ status: "pending", userCode: device.userCode, verificationUrl: device.verificationUrl, interval: device.interval, expiresAt: device.expiresAt, consentVersion: CODEX_CONSENT_VERSION });
    } catch {
      return json({ error: "Could not start ChatGPT sign-in. Please try again." }, 502);
    }
  }
  if (path === "/api/codex/login" && request.method === "DELETE") {
    await Promise.all([
      env.DB.prepare("DELETE FROM codex_auth_pending WHERE user_id = ?").bind(user.id).run(),
      saveCredential(env, user.id, CODEX_PENDING_SECRET, ""),
    ]);
    return json({ ok: true });
  }
  if (path === "/api/codex/poll" && request.method === "POST") {
    const row = await env.DB.prepare(
      "SELECT device_auth_id, user_code, verification_url, poll_interval, expires_at, last_polled_at FROM codex_auth_pending WHERE user_id = ?",
    ).bind(user.id).first<{ device_auth_id: string; user_code: string; verification_url: string; poll_interval: number; expires_at: number; last_polled_at: number }>();
    if (!row) return json({ error: "No Codex connection is waiting for approval" }, 404);
    if (row.expires_at <= Date.now()) {
      await Promise.all([
        env.DB.prepare("DELETE FROM codex_auth_pending WHERE user_id = ?").bind(user.id).run(),
        saveCredential(env, user.id, CODEX_PENDING_SECRET, ""),
      ]);
      return json({ error: "That sign-in code expired. Start again for a new code." }, 410);
    }
    if (row.last_polled_at + row.poll_interval * 1000 > Date.now()) {
      return json({ status: "pending", interval: row.poll_interval, expiresAt: row.expires_at });
    }
    await env.DB.prepare("UPDATE codex_auth_pending SET last_polled_at = ? WHERE user_id = ?").bind(Date.now(), user.id).run();
    try {
      const deviceAuthId = await credentialValue(env, user.id, CODEX_PENDING_SECRET);
      if (!deviceAuthId) return json({ error: "That sign-in attempt is no longer available. Start again." }, 410);
      const polled = await pollDeviceCode(codexConfig, { deviceAuthId, userCode: row.user_code });
      if (polled.status === "pending") return json({ status: "pending", interval: row.poll_interval, expiresAt: row.expires_at });
      const tokens = await exchangeDeviceAuthorization(codexConfig, polled);
      await saveCredential(env, user.id, CODEX_CREDENTIAL, JSON.stringify(tokens));
      await Promise.all([
        env.DB.prepare("DELETE FROM codex_auth_pending WHERE user_id = ?").bind(user.id).run(),
        saveCredential(env, user.id, CODEX_PENDING_SECRET, ""),
      ]);
      const models = await discoverCodexModels(env, user.id, true);
      const runtimeReady = models.length > 0 && await verifyCodexRuntime(env, user.id, models[0]);
      return json({
        status: "connected", runtimeReady, models,
        warning: runtimeReady ? null : "ChatGPT is connected, but Cloudflare could not reach Codex inference. You can retry the check later.",
      });
    } catch {
      return json({ error: "ChatGPT authorization could not be completed. Start again or retry shortly." }, 502);
    }
  }
  if (path === "/api/codex/check" && request.method === "POST") {
    if (!await credentialConfigured(env, user.id, CODEX_CREDENTIAL)) return json({ error: "Connect ChatGPT first" }, 400);
    const models = await discoverCodexModels(env, user.id, true);
    const runtimeReady = models.length > 0 && await verifyCodexRuntime(env, user.id, models[0]);
    return json({ runtimeReady, models, warning: runtimeReady ? null : "ChatGPT is connected, but hosted Codex inference is not reachable from Cloudflare right now." });
  }
  if (path === "/api/codex/status" && request.method === "GET") {
    const [configured, ready, models, pending] = await Promise.all([
      credentialConfigured(env, user.id, CODEX_CREDENTIAL),
      credentialValue(env, user.id, CODEX_RUNTIME_READY),
      discoverCodexModels(env, user.id, false),
      env.DB.prepare("SELECT user_code, verification_url, poll_interval, expires_at FROM codex_auth_pending WHERE user_id = ? AND expires_at > ?")
        .bind(user.id, Date.now()).first<{ user_code: string; verification_url: string; poll_interval: number; expires_at: number }>(),
    ]);
    return json({
      configured, runtimeReady: ready === "true", modelCount: models.length, consentVersion: CODEX_CONSENT_VERSION,
      pending: pending ? { userCode: pending.user_code, verificationUrl: pending.verification_url, interval: pending.poll_interval, expiresAt: pending.expires_at } : null,
    });
  }
  if (path === "/api/codex" && request.method === "DELETE") {
    await Promise.all([
      saveCredential(env, user.id, CODEX_CREDENTIAL, ""),
      saveCredential(env, user.id, CODEX_MODELS_CACHE, ""),
      saveCredential(env, user.id, CODEX_RUNTIME_READY, ""),
      saveCredential(env, user.id, CODEX_PENDING_SECRET, ""),
      env.DB.prepare("DELETE FROM codex_auth_pending WHERE user_id = ?").bind(user.id).run(),
    ]);
    return json({ ok: true });
  }
  if (path === "/api/claude/login" && request.method === "POST") {
    if (!await withinRateLimit(env, `claude-login:${user.id}`, 10, 60 * 60)) return json({ error: "Too many connection attempts. Please try again later." }, 429);
    const verifier = randomUrlSafe(64);
    const state = randomUrlSafe(32);
    const params = new URLSearchParams({
      code: "true", client_id: CLAUDE_CLIENT_ID, response_type: "code", redirect_uri: CLAUDE_REDIRECT,
      scope: "user:inference", code_challenge: await pkceChallenge(verifier), code_challenge_method: "S256", state,
    });
    const pending: ClaudePending = {
      verifier, state, authorizeUrl: `https://claude.ai/oauth/authorize?${params}`, expiresAt: Date.now() + 10 * 60 * 1000,
    };
    await saveCredential(env, user.id, CLAUDE_PENDING, JSON.stringify(pending));
    return json({ authorizeUrl: pending.authorizeUrl, expiresAt: pending.expiresAt });
  }
  if (path === "/api/claude/complete" && request.method === "POST") {
    const body = await request.json<{ code?: string }>().catch(() => ({}));
    const pasted = body.code?.trim() ?? "";
    if (!pasted || pasted.length > 512) return json({ error: "Paste the one-time code shown by Claude" }, 400);
    const rawPending = await credentialValue(env, user.id, CLAUDE_PENDING);
    if (!rawPending) return json({ error: "Start Claude sign-in again first" }, 400);
    try {
      const pending = JSON.parse(rawPending) as ClaudePending;
      if (pending.expiresAt <= Date.now()) throw new Error("That Claude sign-in expired. Start again.");
      const [code, state] = pasted.split("#", 2);
      if (!code || !state || !constantTimeEqual(state, pending.state)) throw new Error("Paste the complete code from the newest Claude sign-in tab, including the part after #");
      const response = await fetch(CLAUDE_TOKEN_URL, {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code", client_id: CLAUDE_CLIENT_ID, code, state,
          redirect_uri: CLAUDE_REDIRECT, code_verifier: pending.verifier,
        }),
      });
      if (!response.ok) throw new Error(response.status === 400
        ? "Claude rejected that one-time code. Start again and use the newest code."
        : "Claude sign-in could not finish. Nothing was saved; try again.");
      const tokens = await response.json<{ access_token?: string; refresh_token?: string; expires_in?: number }>();
      if (!tokens.access_token) throw new Error("Claude did not return a connection token. Start again.");
      const credential: ClaudeCredential = {
        accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: claudeExpiry(tokens.expires_in),
      };
      await Promise.all([
        saveCredential(env, user.id, CLAUDE_CREDENTIAL, JSON.stringify(credential)),
        saveCredential(env, user.id, CLAUDE_RUNTIME_READY, "true"),
        saveCredential(env, user.id, CLAUDE_PENDING, ""),
      ]);
      return json({ status: "connected", configured: true, runtimeReady: true, models: CLAUDE_MODELS });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Claude authorization failed" }, 400);
    }
  }
  if (path === "/api/claude/status" && request.method === "GET") {
    return json({ status: "idle" });
  }
  if (path === "/api/claude/login" && request.method === "DELETE") {
    await saveCredential(env, user.id, CLAUDE_PENDING, "");
    return json({ ok: true });
  }
  if (path === "/api/claude" && request.method === "DELETE") {
    await Promise.all([
      saveCredential(env, user.id, CLAUDE_CREDENTIAL, ""),
      saveCredential(env, user.id, CLAUDE_PENDING, ""),
      saveCredential(env, user.id, CLAUDE_RUNTIME_READY, ""),
    ]);
    return json({ ok: true });
  }
  if (path === "/api/instances") {
    const composio = await credentialConfigured(env, user.id, "composio");
    const instances: Array<Record<string, unknown>> = [{
      instanceId: "cloudflare-ai", driverKind: "cloudflareAi", displayName: "Cloudflare AI",
      snapshot: { state: "available", authenticated: true, billing: "metered" },
      models: { default: MODEL, options: [{ id: MODEL, label: "Kimi K2.6" }] },
      capabilities: { computerMcp: true, agentsMcp: false, composioMcp: composio, images: true, queueing: false },
      access: "subscription",
    }];
    if (await credentialConfigured(env, user.id, CODEX_CREDENTIAL)) {
      const [models, ready] = await Promise.all([
        discoverCodexModels(env, user.id, false), credentialValue(env, user.id, CODEX_RUNTIME_READY),
      ]);
      const runtimeReady = ready === "true" && models.length > 0;
      instances.push({
        instanceId: "codex-subscription", driverKind: "codex", displayName: "Codex",
        snapshot: {
          state: runtimeReady ? "available" : "unavailable", authenticated: true, billing: "subscription",
          reason: runtimeReady ? undefined : "ChatGPT is connected, but hosted Codex inference is not reachable from Cloudflare yet.",
        },
        models: { default: models[0] ?? "", options: models.map((id) => ({ id, label: id.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) })) },
        capabilities: { computerMcp: true, agentsMcp: false, composioMcp: composio, images: true, effortLevels: ["low", "medium", "high", "xhigh"], queueing: false },
        access: "subscription",
      });
    }
    if (await credentialConfigured(env, user.id, CLAUDE_CREDENTIAL)) {
      const ready = await credentialValue(env, user.id, CLAUDE_RUNTIME_READY);
      const runtimeReady = ready === "true";
      instances.push({
        instanceId: "claude-subscription", driverKind: "claudeAgent", displayName: "Claude Code",
        snapshot: {
          state: runtimeReady ? "available" : "unavailable", authenticated: true, billing: "subscription",
          reason: runtimeReady ? undefined : "Reconnect the Claude subscription.",
        },
        models: { default: CLAUDE_MODELS[0], options: CLAUDE_MODELS.map((id) => ({ id, label: id.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) })) },
        capabilities: { computerMcp: true, agentsMcp: false, composioMcp: composio, images: true, queueing: false },
        access: "subscription",
      });
    }
    return json({ instances });
  }
  if (path === "/api/config") {
    if (request.method === "PUT") {
      const body = await request.json<{ profile?: { name?: string; email?: string }; composio?: { apiKey?: string } }>();
      const name = body.profile?.name?.trim().slice(0, 80) || user.name;
      const email = body.profile?.email?.trim().toLowerCase() || user.email;
      if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Use a valid email address" }, 400);
      try {
        await env.DB.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").bind(name, email, user.id).run();
      } catch {
        return json({ error: "That email address is already in use" }, 409);
      }
      user = { ...user, name, email };
      if (body.composio?.apiKey !== undefined) {
        const key = body.composio.apiKey.trim();
        if (key.length > 500) return json({ error: "Composio key is too long" }, 400);
        await saveCredential(env, user.id, "composio", key);
      }
    }
    const [composioConfigured, codexConfigured, codexReady, codexModels, anthropicConfigured, anthropicReady] = await Promise.all([
      credentialConfigured(env, user.id, "composio"), credentialConfigured(env, user.id, CODEX_CREDENTIAL),
      credentialValue(env, user.id, CODEX_RUNTIME_READY), discoverCodexModels(env, user.id, false),
      credentialConfigured(env, user.id, CLAUDE_CREDENTIAL), credentialValue(env, user.id, CLAUDE_RUNTIME_READY),
    ]);
    return json({
      hosted: true,
      xai: { configured: false }, composio: { configured: composioConfigured, mode: composioConfigured ? "managed" : "unavailable" },
      codex: { configured: codexConfigured, runtimeReady: codexReady === "true", modelCount: codexModels.length, consentVersion: CODEX_CONSENT_VERSION },
      anthropic: { configured: anthropicConfigured, runtimeReady: anthropicReady === "true", modelCount: anthropicConfigured ? CLAUDE_MODELS.length : 0 },
      cfComputer: { configured: true, url: "https://magicbot-cf-computer.everyai-com.workers.dev" },
      vps: { configured: false, sshAlias: "" }, rooms: { turnTimeoutMinutes: 5 },
      localVm: { mode: "shared", maxInstances: 0 }, tts: { configured: true, ready: true, voice: "luna", provider: "cloudflare" },
      imageGen: { configured: true, provider: "cloudflare" }, profile: { name: user.name, email: user.email },
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
    const configured = await credentialConfigured(env, user.id, "composio");
    return json({ configured, mode: configured ? "managed" : "unavailable", source: "curated", cards });
  }
  if (path === "/api/connectors/connected" && request.method === "GET") {
    if (!await credentialConfigured(env, user.id, "composio")) return json({ configured: false, services: {} });
    return connectorJson(await connectorRequest(env, user.id, "/v1/connectors/connected"));
  }
  if (path === "/api/connectors" && request.method === "GET") {
    if (!await credentialConfigured(env, user.id, "composio")) return json({ configured: false, services: {} });
    const services = new URL(request.url).searchParams.get("services") ?? "";
    return connectorJson(await connectorRequest(env, user.id, `/v1/connectors?services=${encodeURIComponent(services)}`));
  }
  let connectorMatch = path.match(/^\/api\/connectors\/([a-z0-9][a-z0-9_-]{0,80})\/authorize$/);
  if (connectorMatch && request.method === "POST") {
    const body = await request.text();
    return connectorJson(await connectorRequest(env, user.id, `/v1/connectors/${connectorMatch[1]}/authorize`, { method: "POST", body: body || "{}" }));
  }
  connectorMatch = path.match(/^\/api\/connectors\/([a-z0-9][a-z0-9_-]{0,80})\/accounts\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/);
  if (connectorMatch && request.method === "DELETE") {
    return connectorJson(await connectorRequest(env, user.id, `/v1/connectors/${connectorMatch[1]}/accounts/${connectorMatch[2]}`, { method: "DELETE" }));
  }
  connectorMatch = path.match(/^\/api\/connectors\/([a-z0-9][a-z0-9_-]{0,80})$/);
  if (connectorMatch && request.method === "DELETE") {
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
  if (path === "/api/tts/voices" && request.method === "GET") {
    const ids = ["luna", "apollo", "athena", "atlas", "aurora", "cora", "hermes", "iris", "juno", "mars", "orpheus", "thalia"];
    return json({ voices: ids.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), description: "Cloudflare Aura 2" })) });
  }
  if (path === "/api/tts/prepare" && request.method === "POST") {
    const body = await request.json<{ text?: string }>();
    const text = body.text?.trim().slice(0, 10_000) ?? "";
    if (!text) return json({ ready: true, utterances: [] });
    const sentences = text.match(/[^.!?\n]+(?:[.!?]+|$)/g)?.map((part) => part.trim()).filter(Boolean) ?? [text];
    const utterances: string[] = [];
    for (const sentence of sentences) {
      if (sentence.length <= 450) utterances.push(sentence);
      else for (let start = 0; start < sentence.length; start += 450) utterances.push(sentence.slice(start, start + 450));
    }
    return json({ ready: true, utterances: utterances.slice(0, 40) });
  }
  if (path === "/api/tts/speak" && request.method === "POST") {
    const body = await request.json<{ text?: string; voiceId?: string }>();
    const text = body.text?.trim() ?? "";
    if (!text || text.length > 500) return json({ error: "Voice utterances must be between 1 and 500 characters" }, 400);
    const allowed = new Set(["amalthea", "andromeda", "apollo", "arcas", "aries", "asteria", "athena", "atlas", "aurora", "callista", "cora", "cordelia", "delia", "draco", "electra", "harmonia", "helena", "hera", "hermes", "hyperion", "iris", "janus", "juno", "jupiter", "luna", "mars", "minerva", "neptune", "odysseus", "ophelia", "orion", "orpheus", "pandora", "phoebe", "pluto", "saturn", "thalia", "theia", "vesta", "zeus"]);
    const speaker = allowed.has(body.voiceId ?? "") ? body.voiceId! : "luna";
    const audio = await env.AI.run(VOICE_MODEL as keyof AiModels, { text, speaker, encoding: "mp3" } as never) as ReadableStream;
    return new Response(audio, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
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
      const reply = await aiReply(env, user.id, roomBot, `${group.bulletin ? `Room instructions: ${group.bulletin}\n\n` : ""}${text}`);
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
  const groupInterruptMatch = path.match(/^\/api\/groups\/([^/]+)\/interrupt$/);
  if (groupInterruptMatch && request.method === "POST") return json({ ok: true });
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
  const threadRespondMatch = path.match(/^\/api\/threads\/([^/]+)\/respond$/);
  if (threadRespondMatch && request.method === "POST") return json({ ok: true });
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
    const mode = new URL(request.url).searchParams.get("mode") ?? "add";
    const archivedBots: Bot[] = [];
    const archived: Array<{ id: string; chiefOfStaff: boolean }> = [];
    if (mode === "replace") {
      for (const existing of (await listBots(env, user.id)).filter((bot) => !bot.hidden)) {
        existing.hidden = true;
        await saveBot(env, user.id, existing);
        archivedBots.push(publicBot(existing));
        archived.push({ id: existing.id, chiefOfStaff: existing.chiefOfStaff === true });
      }
    }
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
    let group: Group | undefined;
    if (mode === "project" && imported.length) {
      const url = new URL(request.url);
      const createdAt = Date.now();
      group = {
        id: crypto.randomUUID(), threadId: crypto.randomUUID(), name: (url.searchParams.get("room") ?? manifest.team?.name ?? "Project room").slice(0, 100),
        memberIds: imported.map((bot) => bot.id), defaultResponder: { kind: "member", botId: imported[0].id }, bulletin: "", unread: false,
        createdAt, messages: [], setupCompletedAt: createdAt,
        ...(url.searchParams.get("cwd") ? { cwd: url.searchParams.get("cwd")!.slice(0, 500) } : {}),
      };
      await saveRecord(env, "groups", user.id, group.id, group, createdAt);
    }
    return json({ bots: imported, archivedBots, archived, ...(group ? { group } : {}) }, 201);
  }
  if (path === "/api/team-library/catalog" && request.method === "GET") {
    try {
      const value = await fetchJsonLimited(`${TEAM_LIBRARY_RAW}/catalog.json`, 256_000) as { teams?: unknown[] };
      return json({ ...value, repositoryUrl: TEAM_LIBRARY_REPOSITORY });
    } catch (error) {
      return json({ repositoryUrl: TEAM_LIBRARY_REPOSITORY, teams: [], error: error instanceof Error ? error.message : String(error) });
    }
  }
  const libraryTeamMatch = path.match(/^\/api\/team-library\/teams\/([a-z0-9][a-z0-9-]{0,79})$/);
  if (libraryTeamMatch && request.method === "GET") {
    const catalog = await fetchJsonLimited(`${TEAM_LIBRARY_RAW}/catalog.json`, 256_000) as { teams?: Array<{ slug?: string; manifest?: string }> };
    const entry = catalog.teams?.find((team) => team.slug === libraryTeamMatch[1]);
    if (!entry?.manifest || !entry.manifest.startsWith(`teams/${libraryTeamMatch[1]}/`) || !entry.manifest.endsWith(".json") || entry.manifest.includes("..")) {
      return json({ error: "That library team was not found" }, 404);
    }
    return json(await fetchJsonLimited(`${TEAM_LIBRARY_RAW}/${entry.manifest}`));
  }
  if (path === "/api/team-library/github" && request.method === "POST") {
    const body = await request.json<{ url?: string }>();
    if (!body.url) return json({ error: "GitHub URL required" }, 400);
    let lastError: unknown;
    for (const url of githubTeamUrls(body.url)) {
      try { return json(await fetchJsonLimited(url)); }
      catch (error) { lastError = error; }
    }
    return json({ error: lastError instanceof Error ? lastError.message : "No team file was found" }, 404);
  }
  if (path === "/api/teams/scout" && request.method === "GET") {
    const target = (new URL(request.url).searchParams.get("cwd") ?? "Web project").trim().slice(0, 300);
    const project = target.split(/[\\/]/).filter(Boolean).at(-1)?.replace(/[-_]+/g, " ") || "Web project";
    return json({
      profile: { name: project, summary: `A browser-managed project at ${target}`, stacks: ["Cloudflare", "TypeScript", "Web"] },
      suggestion: {
        roomName: `${project} team`,
        manifest: { format: "openmaus.team", version: 2, team: { name: `${project} team`, members: [
          { key: "lead", name: "Project Lead", title: "Plans and coordinates delivery", description: `Own the plan and decisions for ${project}.`, appearance: { color: "purple" } },
          { key: "builder", name: "Builder", title: "Implements the project", description: `Build and test ${project} using its Cloudflare computer.`, appearance: { color: "cyan" } },
          { key: "reviewer", name: "Reviewer", title: "Checks quality and security", description: `Review changes for correctness, usability, and security.`, appearance: { color: "green" } },
        ] } },
        reasons: { lead: "Coordinates work", builder: "Implements changes", reviewer: "Validates quality" },
      },
    });
  }
  if (path === "/api/teams/scout/directory" && request.method === "GET") return json({ directory: [] });
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
  const avatarGenerateMatch = path.match(/^\/api\/bots\/([^/]+)\/avatar\/generate$/);
  if (avatarGenerateMatch && request.method === "POST") {
    const bot = await loadBot(env, user.id, decodeURIComponent(avatarGenerateMatch[1]));
    if (!bot) return json({ error: "Bot not found" }, 404);
    const body = await request.json<{ prompt?: string }>().catch(() => ({} as { prompt?: string }));
    const direction = body.prompt?.trim().slice(0, 400) ?? "";
    const prompt = [
      `Square profile avatar for an AI agent named ${bot.name}.`,
      bot.title ? `Role: ${bot.title}.` : "",
      bot.description ? `Personality: ${bot.description.slice(0, 500)}.` : "",
      direction,
      "Premium editorial character portrait, simple background, centered head and shoulders, no text, no logos.",
    ].filter(Boolean).join(" ");
    const avatarUrl = await generatedImage(env, user.id, prompt, `${bot.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "bot"}-avatar.jpg`);
    bot.avatarUrl = avatarUrl;
    bot.avatarCrop = "circle";
    await saveBot(env, user.id, bot);
    return json({ avatarUrl, bot: publicBot(bot) }, 201);
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
      const state = await env.COMPUTER.status(sandboxId);
      return json({ backend: "cloudflare-computer", configured: true, ready: true, running: state.running, container: state.running ? "cloudflare" : "sleeping", box: false, headless: true, persistentWorkspace: true });
    }
    if (action === "control") {
      const body: { action?: string } = request.method === "POST" ? await request.json<{ action?: string }>().catch(() => ({})) : {};
      return json({ held: body.action === "take", helpReason: null });
    }
    if (action === "provision" && request.method === "POST") {
      return json({ backend: "cloudflare-computer", configured: true, ready: true, container: "cloudflare", headless: true, persistentWorkspace: true });
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
    if (action === "sleep" && request.method === "POST") {
      await env.COMPUTER.sleep(sandboxId);
      return json({ ok: true, container: "sleeping", persistentWorkspace: true });
    }
    if (action === "remove" && request.method === "POST") {
      await env.COMPUTER.destroy(sandboxId);
      return json({ ok: true, container: "removed", persistentWorkspace: false });
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
    const reply = await aiReply(env, user.id, bot, text);
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
  const cardMatch = path.match(/^\/api\/bots\/([^/]+)\/cards\/([^/]+)$/);
  if (cardMatch && request.method === "PATCH") {
    const bot = await loadBot(env, user.id, decodeURIComponent(cardMatch[1]));
    if (!bot) return json({ error: "Bot not found" }, 404);
    const message = bot.messages.find((item) => item.id === decodeURIComponent(cardMatch[2]));
    if (!message) return json({ error: "Card not found" }, 404);
    const patch = await request.json<Record<string, unknown>>();
    message.card = { ...((message.card ?? {}) as object), ...patch };
    await saveBot(env, user.id, bot);
    return json({ message });
  }
  const botRespondMatch = path.match(/^\/api\/bots\/([^/]+)\/respond$/);
  if (botRespondMatch && request.method === "POST") return json({ ok: true });
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
      const allowed = ["name", "title", "description", "notifications", "color", "mascotExpression", "avatarUrl", "avatarCrop", "unread", "modelSelection", "computer", "cloudBackend", "cwd", "autoApprove", "alwaysAllow", "speakReplies", "voice", "pinned", "hidden", "section", "pinnedMessageId", "chiefOfStaff", "approvePeerComms", "composio"];
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
    const body = await request.json<{ text?: string; clientMessageId?: string }>();
    const text = body.text?.trim() ?? "";
    if (!text || text.length > 20_000) return json({ error: "Message must be between 1 and 20,000 characters" }, 400);
    const reply = await aiReply(env, user.id, bot, text);
    const messages = appendTurn(bot, text, reply, body.clientMessageId);
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
