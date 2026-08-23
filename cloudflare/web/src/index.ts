interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
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
  return Object.fromEntries(Array.from(form.entries(), ([key, value]) => [key, String(value)]));
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
  };
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
  const result = await env.AI.run(MODEL as keyof AiModels, {
    messages: [
      { role: "system", content: `You are ${bot.name}, ${bot.title || "a capable AI assistant"}. ${bot.description || "Be practical, clear, and proactive."}` },
      ...history,
      { role: "user", content: text },
    ],
    max_tokens: 2048,
  }) as { response?: string; choices?: Array<{ message?: { content?: string } }> };
  return result.response ?? result.choices?.[0]?.message?.content ?? "I couldn't generate a reply. Please try again.";
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
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
      xai: { configured: false }, composio: { configured: false, mode: "unavailable" },
      cfComputer: { configured: true, url: "https://magicbot-cf-computer.everyai-com.workers.dev" },
      vps: { configured: false, sshAlias: "" }, rooms: { turnTimeoutMinutes: 5 },
      localVm: { mode: "shared", maxInstances: 0 }, tts: { configured: false, ready: false, voice: "" },
      imageGen: { configured: false }, profile: { name: user.name, email: user.email },
    });
  }
  if (path === "/api/routines") return json({ routines: [], runs: [] });
  if (path === "/api/webhooks") return json({ webhooks: [], attempts: [], ingress: { available: false } });
  if (path === "/api/events") {
    return new Response(`data: ${JSON.stringify({ kind: "hello", resumed: false })}\n\n`, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" },
    });
  }
  if (path === "/api/bots" && request.method === "GET") {
    let bots = await listBots(env, user.id);
    if (bots.length === 0) {
      const bot = newBot();
      await saveBot(env, user.id, bot);
      bots = [bot];
    }
    return json({ bots, groups: [], computerControl: {} });
  }
  if (path === "/api/bots" && request.method === "POST") {
    const bot = newBot("New bot");
    await saveBot(env, user.id, bot);
    return json({ bot }, 201);
  }
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
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", kind: "text", text, at: Date.now(), parentId: bot.activeLeafId };
    bot.messages.push(userMessage);
    bot.activeLeafId = userMessage.id;
    const reply = await aiReply(env, bot, text);
    const assistantMessage: Message = { id: crypto.randomUUID(), role: "bot", kind: "text", text: reply, at: Date.now(), parentId: userMessage.id };
    bot.messages.push(assistantMessage);
    bot.activeLeafId = assistantMessage.id;
    await saveBot(env, user.id, bot);
    return json({ threadId: bot.threadId, messages: [userMessage, assistantMessage] });
  }
  return json({ error: "This feature is not available in the hosted version yet" }, 501);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
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
} satisfies ExportedHandler<Env>;
