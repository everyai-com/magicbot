// Harness client for the MagicBots cloud computer (cf-computer/ Worker).
// The hosted sibling of box.ts: same shape (run a command, read/write files,
// and persist files), backed by one shared @cloudflare/computer Workspace and
// one shared Browser Run profile. Each bot receives its own browser page.
import type { AppConfig } from "./config.ts";
import { SPAWNED_PROXIES } from "./proxy-paths.ts";

export function cfConfigured(cfg: AppConfig): boolean {
  return Boolean(cfg.cfComputer?.url && cfg.cfComputer?.token);
}

export function cfComputerMcp(cfg: AppConfig, botId: string): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  if (!cfConfigured(cfg)) throw new Error("Cloudflare computer is not configured");
  return {
    command: process.execPath,
    args: [SPAWNED_PROXIES.cfComputer],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      OMB_CF_COMPUTER_URL: cfg.cfComputer!.url!,
      OMB_CF_COMPUTER_TOKEN: cfg.cfComputer!.token!,
      OMB_CF_COMPUTER_BOT: botId,
    },
  };
}

export function status(cfg: AppConfig) {
  return {
    configured: cfConfigured(cfg),
    ready: cfConfigured(cfg),
    container: cfConfigured(cfg) ? "cloudflare" : null,
    headless: false,
    shared: true,
  };
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

export async function screenshot(cfg: AppConfig, botId: string) {
  const shot = await call(cfg, botId, "browserScreenshot", {});
  return { png: String(shot.image ?? ""), format: String(shot.mimeType ?? "image/jpeg") };
}

export function destroy(cfg: AppConfig, botId: string) {
  return call(cfg, botId, "destroy", {});
}
