// Harness client for the MagicBot cloud computer (cf-computer/ Worker).
// The hosted sibling of box.ts: same shape (run a command, read/write files,
// expose a service), but backed by a Cloudflare Sandbox container per bot
// instead of box.ascii.dev. Selected when cfg.cfComputer.url + token are set.
import type { AppConfig } from "./config.ts";

export function cfConfigured(cfg: AppConfig): boolean {
  return Boolean(cfg.cfComputer?.url && cfg.cfComputer?.token);
}

async function call(cfg: AppConfig, botId: string, action: string, body: unknown): Promise<any> {
  const base = cfg.cfComputer!.url!.replace(/\/+$/, "");
  const res = await fetch(`${base}/computer/${botId}/${action}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.cfComputer!.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error ?? `cf-computer ${action} failed (${res.status})`);
  }
  return json;
}

export function exec(cfg: AppConfig, botId: string, command: string) {
  return call(cfg, botId, "exec", { command }) as Promise<{
    ok: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
}

export function runCode(cfg: AppConfig, botId: string, code: string, language = "python") {
  return call(cfg, botId, "run", { code, language });
}

export function writeFile(cfg: AppConfig, botId: string, path: string, content: string) {
  return call(cfg, botId, "writeFile", { path, content });
}

export function readFile(cfg: AppConfig, botId: string, path: string) {
  return call(cfg, botId, "readFile", { path }) as Promise<{ ok: boolean; content: unknown }>;
}

export function exposePort(cfg: AppConfig, botId: string, port: number) {
  return call(cfg, botId, "expose", { port }) as Promise<{ ok: boolean; url: string }>;
}

export function destroy(cfg: AppConfig, botId: string) {
  return call(cfg, botId, "destroy", {});
}
