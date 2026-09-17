// Boundary tests for the hosted worker. This file exists because the worker
// had none: every route here is reachable from the open internet, and the
// defects below were all "a check that is right next door is missing here".
import { describe, expect, it } from "vitest";

import { attachmentResponseHeaders, findUserForLogin, requestFailure, sameOrigin, UPLOADABLE_MIME } from "./index";

/** A DB stub that answers one prepared statement. */
function dbWithUser(row: Record<string, unknown> | null) {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => row,
        run: async () => undefined,
      }),
    }),
  };
}

describe("login", () => {
  const row = {
    id: "u1",
    email: "ada@example.com",
    name: "Ada",
    // PBKDF2 of "correct horse" with this salt is irrelevant here — the test
    // is about cost, not about matching
    password_hash: "0".repeat(64),
    password_salt: "saltsaltsaltsaltsa",
  };

  // The key derivation ran only when the email existed, so a miss returned in
  // a fraction of the time a hit took. That difference is measurable from the
  // open internet, and the rate limit is keyed per (address, email) — so
  // sweeping a list of candidate emails was never throttled at all.
  it("costs the same whether or not the email exists", async () => {
    const time = async (email: string, db: ReturnType<typeof dbWithUser>) => {
      const started = performance.now();
      await findUserForLogin({ DB: db } as never, email, "some password");
      return performance.now() - started;
    };
    // warm the subtle-crypto path so the first call is not the slow one
    await time("ada@example.com", dbWithUser(row));

    const hit = await time("ada@example.com", dbWithUser(row));
    const miss = await time("nobody@example.com", dbWithUser(null));

    expect(hit).toBeGreaterThan(1);
    // a miss that skips the derivation lands near zero; the ratio was ~15x
    expect(miss).toBeGreaterThan(hit / 3);
  });

  it("still refuses a wrong password and accepts the right one", async () => {
    const salt = "saltsaltsaltsaltsa";
    const stored = await findUserForLogin({ DB: dbWithUser(null) } as never, "nobody@example.com", "x");
    expect(stored).toBeNull();

    // derive a real hash so the happy path is exercised end to end
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode("correct horse"), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100_000 },
      key,
      256,
    );
    const hash = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const db = dbWithUser({ ...row, password_hash: hash, password_salt: salt });

    expect(await findUserForLogin({ DB: db } as never, "ada@example.com", "wrong")).toBeNull();
    expect(await findUserForLogin({ DB: db } as never, "ada@example.com", "correct horse")).toMatchObject({ id: "u1" });
  });
});

describe("logout", () => {
  // Every neighbouring state-changing route checks sameOrigin; /logout ran for
  // any method from anywhere. SameSite=Lax keeps a cross-site <img> from
  // carrying the cookie, but a top-level navigation still does, so a link was
  // enough to sign someone out.
  it("is refused cross-site, like its neighbours", () => {
    const cross = new Request("https://bots.example/logout", {
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    });
    expect(sameOrigin(cross)).toBe(false);

    const own = new Request("https://bots.example/logout", {
      headers: { origin: "https://bots.example", "sec-fetch-site": "same-origin" },
    });
    expect(sameOrigin(own)).toBe(true);
  });
});

describe("attachments", () => {
  // /api/attachments restricts uploads to images; /api/file-attachments took
  // whatever content type the caller declared and GET served it back inline,
  // so an uploaded text/html document ran as script on the app's own origin.
  it("never serves a caller-declared type inline", () => {
    const dangerous = attachmentResponseHeaders({ mime: "text/html", name: "note.html", size: 10 });
    expect(dangerous["content-type"]).not.toContain("text/html");
    expect(dangerous["content-disposition"]).toContain("attachment");
    expect(dangerous["x-content-type-options"]).toBe("nosniff");

    // an image the upload route already vetted still renders in place
    const image = attachmentResponseHeaders({ mime: "image/png", name: "shot.png", size: 10 });
    expect(image["content-type"]).toBe("image/png");
    expect(image["content-disposition"]).toContain("inline");
  });

  it("agrees with the type list the upload route enforces", () => {
    for (const mime of UPLOADABLE_MIME) {
      expect(attachmentResponseHeaders({ mime, name: "x", size: 1 })["content-type"]).toBe(mime);
    }
  });

  it("keeps a quoted filename from breaking out of the header", () => {
    const headers = attachmentResponseHeaders({ mime: "text/plain", name: 'a";x="y', size: 1 });
    expect(headers["content-disposition"]).not.toContain('";x="');
  });
});

describe("request failures", () => {
  // A body the caller sent wrong is the caller's error. Every write route
  // calls request.json() unguarded, so a malformed body reached the top-level
  // catch and came back as 503 "MagicTeams hit a temporary server problem" —
  // telling the caller to retry something that will never succeed.
  it("answers a malformed JSON body with a 4xx, not a server fault", async () => {
    const request = new Request("https://bots.example/api/bots", { method: "POST", body: "{" });
    const response = requestFailure(request, new SyntaxError("Unexpected end of JSON input"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "That request body is not valid JSON." });
  });

  it("still reports a real fault as one, with a reference", async () => {
    const request = new Request("https://bots.example/api/bots", { method: "POST" });
    const response = requestFailure(request, new Error("D1 is down"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ reference: expect.any(String) });
  });
});
