/** Session, password, CSRF, and rate-limit primitives for the hosted Worker.
 *
 * Everything here is a pure function over Web Crypto and a D1-shaped store,
 * with no Workers bindings, so the security core can be unit-tested in Node
 * (`pnpm web:test`). `index.ts` composes these into the request handlers. */

export const SESSION_COOKIE = "magicbot_session";
export const SESSION_AGE = 60 * 60 * 24 * 30;

const encoder = new TextEncoder();

export function cookieValue(request: Request, name: string): string | null {
  const source = request.headers.get("cookie") ?? "";
  for (const part of source.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_AGE}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** URL-safe base64 of `bytes` random bytes: 43 characters for the default 32. */
export function randomToken(bytes = 32): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function passwordHash(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    // Workers Web Crypto currently caps PBKDF2 at 100k iterations.
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100_000 },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

/** CSRF gate for every state-changing request. Fetch Metadata is set by
 * browsers from information that page scripts cannot alter, and it survives
 * privacy modes and proxies that hide or rewrite Origin, so it is consulted
 * first and Origin second. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();

  if (fetchSite === "cross-site" || fetchSite === "same-site") return false;
  if (!origin || origin === "null") return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";

  try {
    if (new URL(origin).origin === new URL(request.url).origin) return true;
  } catch {
    return false;
  }

  // A proxy can change the URL visible to the Worker while the browser still
  // correctly identifies the form submission as same-origin.
  return fetchSite === "same-origin";
}

/** Only a same-site absolute path may be used as a post-login redirect. */
export function safeNext(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** The slice of D1 the rate limiter needs; `env.DB` satisfies it directly and
 * tests hand in an in-memory fake. */
export interface RateLimitStore {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<{ success: boolean }>;
    };
  };
}

/** Fixed-window counter in the `rate_limits` table. `window` holds the end of
 * the current window as epoch milliseconds, so one upsert both resets a stale
 * window and returns the new count, and `purgeExpiredRateLimits` can drop
 * every finished window without knowing each key's window length. */
export async function withinRateLimit(db: RateLimitStore, key: string, limit: number, windowSeconds: number, now = Date.now()): Promise<boolean> {
  const windowMs = windowSeconds * 1000;
  const windowEnd = (Math.floor(now / windowMs) + 1) * windowMs;
  const row = await db.prepare(
    `INSERT INTO rate_limits (key, window, count) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window = excluded.window THEN rate_limits.count + 1 ELSE 1 END,
       window = excluded.window
     RETURNING count`,
  ).bind(key, windowEnd).first<{ count: number }>();
  // A missing row means the write did not happen; fail closed.
  return (row?.count ?? limit + 1) <= limit;
}

export async function purgeExpiredRateLimits(db: RateLimitStore, now = Date.now()): Promise<void> {
  await db.prepare("DELETE FROM rate_limits WHERE window <= ?").bind(now).run();
}
