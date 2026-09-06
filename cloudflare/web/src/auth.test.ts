import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_COOKIE,
  clearSessionCookie,
  constantTimeEqual,
  cookieValue,
  escapeHtml,
  passwordHash,
  purgeExpiredRateLimits,
  randomToken,
  safeNext,
  sameOrigin,
  sessionCookie,
  sha256,
  withinRateLimit,
  type RateLimitStore,
} from "./auth";

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("cookies", () => {
  it("reads one cookie out of a header with several, keeping '=' inside the value", () => {
    const req = request("https://bots.example", { cookie: `theme=dark; ${SESSION_COOKIE}=a%3Db%3D; other=1` });
    expect(cookieValue(req, SESSION_COOKIE)).toBe("a=b=");
    expect(cookieValue(req, "theme")).toBe("dark");
    expect(cookieValue(req, "missing")).toBeNull();
    expect(cookieValue(request("https://bots.example"), SESSION_COOKIE)).toBeNull();
  });

  it("issues an HttpOnly, Secure, SameSite session cookie and clears it with Max-Age=0", () => {
    const set = sessionCookie("tok en");
    expect(set).toMatch(/^magicbot_session=tok%20en; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);
    expect(clearSessionCookie()).toBe("magicbot_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  });
});

describe("tokens and hashing", () => {
  it("makes URL-safe, unpadded, unique tokens", () => {
    const token = randomToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(randomToken(18)).toHaveLength(24);
    expect(randomToken()).not.toBe(token);
  });

  it("computes a standard SHA-256 hex digest", async () => {
    expect(await sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("derives a stable 256-bit password hash that changes with the salt", async () => {
    const one = await passwordHash("correct horse", "salt-a");
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(await passwordHash("correct horse", "salt-a")).toBe(one);
    expect(await passwordHash("correct horse", "salt-b")).not.toBe(one);
    expect(await passwordHash("wrong horse", "salt-a")).not.toBe(one);
  });

  it("compares strings without short-circuiting on content", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});

describe("sameOrigin", () => {
  const url = "https://bots.example/api/bots";

  it("trusts Fetch Metadata over Origin", () => {
    expect(sameOrigin(request(url, { "sec-fetch-site": "cross-site", origin: "https://bots.example" }))).toBe(false);
    expect(sameOrigin(request(url, { "sec-fetch-site": "same-site", origin: "https://bots.example" }))).toBe(false);
    expect(sameOrigin(request(url, { "Sec-Fetch-Site": "Same-Origin", origin: "https://other.example" }))).toBe(true);
  });

  it("accepts a matching Origin and rejects a foreign or malformed one", () => {
    expect(sameOrigin(request(url, { origin: "https://bots.example" }))).toBe(true);
    expect(sameOrigin(request(url, { origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(request(url, { origin: "not a url" }))).toBe(false);
    expect(sameOrigin(request(url, { origin: "not a url", "sec-fetch-site": "same-origin" }))).toBe(false);
  });

  it("treats a missing or null Origin as same-origin only when Fetch Metadata agrees or is absent", () => {
    expect(sameOrigin(request(url))).toBe(true);
    expect(sameOrigin(request(url, { "sec-fetch-site": "none" }))).toBe(true);
    expect(sameOrigin(request(url, { origin: "null", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(sameOrigin(request(url, { origin: "null", "sec-fetch-site": "cross-site" }))).toBe(false);
  });
});

describe("page helpers", () => {
  it("only follows same-site absolute paths after login", () => {
    expect(safeNext("/today?tab=1")).toBe("/today?tab=1");
    expect(safeNext("//evil.example/x")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });

  it("escapes the characters that break out of text and attribute context", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/a&gt;");
  });
});

/** In-memory stand-in for the `rate_limits` table that mirrors the upsert
 * semantics the SQL relies on, so the tests fail if the statement shape
 * drifts away from one atomic round trip. */
function fakeStore() {
  const rows = new Map<string, { window: number; count: number }>();
  const statements: string[] = [];
  const store: RateLimitStore = {
    prepare(query) {
      statements.push(query);
      return {
        bind(...values) {
          return {
            async first<T = unknown>() {
              if (!query.startsWith("INSERT INTO rate_limits")) throw new Error(`unexpected first() on: ${query}`);
              if (!/RETURNING count\s*$/.test(query)) throw new Error("upsert must return the new count");
              // SAFETY: withinRateLimit binds exactly (key, windowEnd) to the upsert.
              const [key, windowEnd] = values as [string, number];
              const current = rows.get(key);
              const next = current && current.window === windowEnd
                ? { window: windowEnd, count: current.count + 1 }
                : { window: windowEnd, count: 1 };
              rows.set(key, next);
              // SAFETY: the only caller asks for `{ count: number }`, which is what the upsert returns.
              return { count: next.count } as T;
            },
            async run() {
              if (!query.startsWith("DELETE FROM rate_limits WHERE window <= ?")) throw new Error(`unexpected run() on: ${query}`);
              // SAFETY: purgeExpiredRateLimits binds exactly (now) to the delete.
              const [now] = values as [number];
              for (const [key, row] of rows) if (row.window <= now) rows.delete(key);
              return { success: true };
            },
          };
        },
      };
    },
  };
  return { store, rows, statements };
}

describe("withinRateLimit", () => {
  afterEach(() => vi.useRealTimers());

  it("allows exactly `limit` hits per window in one statement each, then refuses", async () => {
    const { store, statements } = fakeStore();
    const now = Date.UTC(2026, 8, 2, 12, 0, 0);
    for (let hit = 1; hit <= 3; hit += 1) expect(await withinRateLimit(store, "login:a", 3, 60, now)).toBe(true);
    expect(await withinRateLimit(store, "login:a", 3, 60, now)).toBe(false);
    expect(statements).toHaveLength(4);
    expect(await withinRateLimit(store, "login:b", 3, 60, now)).toBe(true);
  });

  it("starts counting again once the window has rolled over", async () => {
    const { store } = fakeStore();
    const start = Date.UTC(2026, 8, 2, 12, 0, 30);
    expect(await withinRateLimit(store, "chat:u", 1, 60, start)).toBe(true);
    expect(await withinRateLimit(store, "chat:u", 1, 60, start + 10_000)).toBe(false);
    expect(await withinRateLimit(store, "chat:u", 1, 60, start + 31_000)).toBe(true);
  });

  it("stores the window end so finished windows can be purged without knowing their length", async () => {
    const { store, rows } = fakeStore();
    const now = Date.UTC(2026, 8, 2, 12, 0, 30);
    await withinRateLimit(store, "short", 5, 60, now);
    await withinRateLimit(store, "long", 5, 60 * 60, now);
    expect(rows.get("short")?.window).toBe(Date.UTC(2026, 8, 2, 12, 1, 0));
    expect(rows.get("long")?.window).toBe(Date.UTC(2026, 8, 2, 13, 0, 0));
    await purgeExpiredRateLimits(store, Date.UTC(2026, 8, 2, 12, 1, 0));
    expect([...rows.keys()]).toEqual(["long"]);
  });

  it("fails closed when the store returns no row", async () => {
    const store: RateLimitStore = {
      prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({ success: true }) }) }),
    };
    expect(await withinRateLimit(store, "k", 10, 60)).toBe(false);
  });
});
