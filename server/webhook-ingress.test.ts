import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listenWebhookIngress, MAX_WEBHOOK_BODY_BYTES, webhookCredential, type WebhookIngress } from "./webhook-ingress.ts";
import { WebhookManager } from "./webhooks.ts";

let dir: string;
let ingress: WebhookIngress;
let endpointId: string;
let secret: string;
let manager: WebhookManager;
const queued: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mb-webhook-ingress-"));
  manager = new WebhookManager({
    file: join(dir, "webhooks.json"),
    botState: () => "ready",
    enqueue: (input) => {
      queued.push(input);
      return { id: `run-${queued.length}` };
    },
  });
  const created = manager.create({ name: "Build event", prompt: "Review the build", botId: "bot-1" });
  endpointId = created.webhook.endpointId;
  secret = created.secret;
  ingress = await listenWebhookIngress(manager, { port: 0 });
});

afterAll(async () => {
  await new Promise<void>((resolve) => ingress.server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

describe("webhook-only ingress", () => {
  it("exposes health but nothing from the main MagicBots API", async () => {
    const health = await fetch(`${ingress.baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ app: "magicbots-webhooks", ready: true });
    expect((await fetch(`${ingress.baseUrl}/api/bots`)).status).toBe(404);
  });

  it("accepts capability URLs and deduplicates retries", async () => {
    const credential = webhookCredential(ingress.baseUrl, endpointId, secret);
    const send = () => fetch(credential.url, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "delivery-1", "x-github-event": "push" },
      body: JSON.stringify({ ref: "main", id: "event-in-body" }),
    });
    const first = await send();
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ accepted: true, duplicate: false, runId: "run-1" });
    const retry = await send();
    expect(retry.status).toBe(202);
    expect(await retry.json()).toMatchObject({ accepted: true, duplicate: true, runId: "run-1" });
    expect(queued).toHaveLength(1);
    expect(queued[0]?.prompt).toContain("Event: push");
  });

  it("also accepts a bearer secret without putting it in the URL", async () => {
    const response = await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
      body: "ticket=42&priority=high",
    });
    expect(response.status).toBe(202);
    expect(queued.at(-1)?.prompt).toContain('"ticket": "42"');
  });

  it("does not deduplicate separate requests that reuse a generic payload id", async () => {
    const credential = webhookCredential(ingress.baseUrl, endpointId, secret);
    const before = queued.length;
    const send = () => fetch(credential.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "shared-record", task: "Handle this update" }),
    });
    expect((await send()).status).toBe(202);
    expect((await send()).status).toBe(202);
    expect(queued).toHaveLength(before + 2);
  });

  it("captures a verification event without queueing work", async () => {
    const created = manager.create({ name: "Verify", prompt: "", botId: "bot-1", enabled: false, verificationPending: true });
    const before = queued.length;
    const response = await fetch(webhookCredential(ingress.baseUrl, created.webhook.endpointId, created.secret).url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-event": "support.created" },
      body: JSON.stringify({ task: "Triage ticket 42" }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, captured: true });
    expect(queued).toHaveLength(before);
    expect(manager.list().find((webhook) => webhook.id === created.webhook.id)).toMatchObject({ verificationPending: false, enabled: false });
  });

  // Node's HTTP parser accepts request targets the URL constructor refuses.
  // Parsing one outside the handler's error boundary took the whole harness
  // down, from one unauthenticated request, before authentication ran.
  it("answers a malformed request target and stays up", async () => {
    const statusLine = (target: string) =>
      new Promise<string>((resolve, reject) => {
        const socket = connect(ingress.port, "127.0.0.1", () => {
          socket.write(`POST ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\n\r\n`);
        });
        let buf = "";
        socket.on("data", (chunk) => {
          buf += chunk;
          if (buf.includes("\r\n")) {
            socket.destroy();
            resolve(buf.split("\r\n")[0]);
          }
        });
        socket.on("error", reject);
        socket.on("close", () => resolve(buf.split("\r\n")[0] ?? ""));
      });

    expect(await statusLine("//[")).toContain("400");
    // and the listener is still serving
    expect((await fetch(`${ingress.baseUrl}/health`)).status).toBe(200);
  });

  // decodeURIComponent throws on a half-formed escape. That threw inside the
  // handler, so it answered 500 "URI malformed" where a wrong secret answers
  // 401 — an oracle that tells a caller which of the two it sent — and the
  // rejection never reached the attempt log, because only 400 and 413 did.
  it("treats a malformed percent-escape in the secret as a bad secret", async () => {
    const before = manager.listAttempts().length;
    for (const target of [`/hooks/${endpointId}/%`, `/hooks/${endpointId}/%E0%A4%A`]) {
      const response = await fetch(`${ingress.baseUrl}${target}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status, target).toBe(401);
      expect(await response.json(), target).toEqual({ error: "Invalid webhook URL or secret" });
    }
    expect(manager.listAttempts().length, "the rejections were not recorded").toBe(before + 2);
  });

  // The cap is enforced by responding 413, but the connection was left open
  // and the sender could keep pushing the rest of its declared body.
  it("closes the connection after refusing an oversized body", async () => {
    const credential = webhookCredential(ingress.baseUrl, endpointId, secret);
    const path = new URL(credential.url).pathname;
    let seen = "";
    const result = await new Promise<{ status: string; closed: boolean }>((resolve) => {
      const socket = connect(ingress.port, "127.0.0.1", () => {
        socket.write(
          `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 10485760\r\n\r\n`,
        );
        const chunk = "a".repeat(16 * 1024);
        const pump = setInterval(() => {
          if (!socket.destroyed && socket.writable) socket.write(chunk);
        }, 5);
        socket.on("data", (d) => (seen ||= d.toString().split("\r\n")[0]));
        socket.on("close", () => {
          clearInterval(pump);
          resolve({ status: seen, closed: true });
        });
        setTimeout(() => {
          clearInterval(pump);
          resolve({ status: seen, closed: socket.destroyed });
        }, 3000);
      });
      // the server closing mid-write surfaces as ECONNRESET here, which is
      // the outcome under test, not a failure
      socket.on("error", () => resolve({ status: seen, closed: true }));
    });
    expect(result.status).toContain("413");
    expect(result.closed, "the listener answered 413 but kept reading the body").toBe(true);
  });

  it("rejects invalid credentials, malformed JSON and oversized bodies", async () => {
    const unauthorized = await fetch(`${ingress.baseUrl}/hooks/${endpointId}/wrong`, { method: "POST", body: "{}" });
    expect(unauthorized.status).toBe(401);

    const malformed = await fetch(`${ingress.baseUrl}/hooks/${endpointId}/${secret}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);

    const oversized = await fetch(`${ingress.baseUrl}/hooks/${endpointId}/${secret}`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1),
    });
    expect(oversized.status).toBe(413);
    expect(manager.listAttempts().filter((attempt) => attempt.webhookId === manager.list().find((webhook) => webhook.endpointId === endpointId)?.id && attempt.outcome === "rejected").length).toBeGreaterThanOrEqual(3);
  });
});
