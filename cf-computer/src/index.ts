// MagicBots Cloudflare Computer service.
//
// Each bot maps to one @cloudflare/computer Workspace Durable Object. The
// Workspace owns a durable SQLite-backed filesystem and lazily attaches a
// full Linux container for command execution. The WebComputer entrypoint is
// consumed through a private service binding by the hosted MagicBots Worker.
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { acquire, connect, type Browser, type BrowserContextOptions, type BrowserWorker, type Page } from "@cloudflare/playwright";
import {
  type DurableObjectStorageLike,
  getWorkspace,
  type WorkspaceClient,
  type WorkspaceOptions,
  WorkspaceProxy,
  shellQuote,
  withWorkspace,
} from "@cloudflare/computer";
import {
  CloudflareContainerBackend,
  withWorkspaceContainer,
} from "@cloudflare/computer/backends/container";

// Keep the former class exported so deploying this upgrade does not delete
// existing Sandbox Durable Objects. New work is routed only to Computer.
export { Sandbox } from "@cloudflare/sandbox";
export { WorkspaceProxy };

interface Env {
  Computer: DurableObjectNamespace<Computer>;
  BrowserComputer: DurableObjectNamespace<BrowserComputer>;
  MYBROWSER: BrowserWorker;
  MAGICBOT_COMPUTER_TOKEN: string;
}

const SHARED_COMPUTER_ID = "team";

function computerScope(botId: string): string {
  const separator = botId.indexOf("__");
  return separator > 0 ? botId.slice(0, separator) : SHARED_COMPUTER_ID;
}

class ComputerBase extends withWorkspaceContainer(class extends DurableObject<Env> {}) {
  readonly backend = new CloudflareContainerBackend({
    container: () => this,
    workspace: { binding: "Computer", id: this.ctx.id.toString() },
    egress: { mode: "direct" },
  });
}

function workspaceOptions(self: InstanceType<typeof ComputerBase>): WorkspaceOptions {
  const { ctx } = self as unknown as { ctx: DurableObjectState };
  return {
    storage: ctx.storage as unknown as DurableObjectStorageLike,
    backends: [self.backend],
  };
}

/** One persistent Cloudflare Computer workspace per bot. */
export class Computer extends withWorkspace(ComputerBase, workspaceOptions) {
  override async fetch(request: Request): Promise<Response> {
    return this.backend.handleFetch(request);
  }

  async computerStatus() {
    // Read the container state directly from the Durable Object. Returning a
    // second RpcTarget from inside a DO RPC call can leave the outer service
    // binding waiting forever when the container is asleep.
    return {
      running: Boolean(this.ctx.container?.running),
      exit: null,
    };
  }

  async sleepComputer() {
    if (this.ctx.container?.running) await this.ctx.container.destroy();
  }

  async destroyComputer() {
    if (this.ctx.container?.running) await this.ctx.container.destroy();
    await this.ctx.storage.deleteAll();
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

function workspaceStub(env: Env, botId: string) {
  return env.Computer.get(env.Computer.idFromName(computerScope(botId)));
}

async function useWorkspace<T>(env: Env, botId: string, work: (ws: WorkspaceClient) => Promise<T>) {
  const stub = workspaceStub(env, botId);
  const ws = await getWorkspace(stub as unknown as Parameters<typeof getWorkspace>[0]);
  try {
    return await work(ws);
  } finally {
    ws[Symbol.dispose]();
  }
}

type BrowserAction = "open" | "state" | "text" | "snapshot" | "click" | "fill" | "press" | "screenshot" | "close";
const INTERACTIVE_SELECTOR = "a,button,input,textarea,select,[role=button],[role=link],[contenteditable=true]";
type BrowserOperation = {
  id: string;
  action: Exclude<BrowserAction, "screenshot">;
  detail: string;
  at: number;
  status: "running" | "completed" | "failed";
};

function refIndex(input: unknown): number {
  const match = /^e-(\d+)$/.exec(String(input ?? ""));
  if (!match) throw new Error("invalid browser ref");
  return Number(match[1]) - 1;
}

function publicUrl(input: unknown): string {
  const url = new URL(String(input ?? ""));
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("url must use http or https");
  return url.toString();
}

function browserStub(env: Env, botId: string) {
  return env.BrowserComputer.get(env.BrowserComputer.idFromName(computerScope(botId)));
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Wait for client-side redirects, onload form submissions, and the final page
 * to become readable. Older government and enterprise portals often return a
 * tiny bootstrap document which immediately POSTs into a cookie-backed app;
 * DOMContentLoaded on that bootstrap document is not the end of navigation. */
async function settlePage(page: Page, maximumMs = 30_000) {
  const startedAt = Date.now();
  let previousUrl = "";
  let previousTitle = "";
  let stableChecks = 0;

  while (Date.now() - startedAt < maximumMs) {
    await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
    const url = page.url();
    const title = await page.title().catch(() => "");
    const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
    const readable = bodyText.trim().length >= 40;

    if (url === previousUrl && title === previousTitle && readable) stableChecks += 1;
    else stableChecks = 0;
    if (stableChecks >= 2) return { url, title, readable: true };

    previousUrl = url;
    previousTitle = title;
    await delay(500);
  }

  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    readable: await page.locator("body").innerText({ timeout: 3_000 }).then((text) => text.trim().length >= 40).catch(() => false),
  };
}

async function openComplexPage(page: Page, input: unknown) {
  const url = publicUrl(input);
  let navigationError: unknown;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 75_000 });
  } catch (error) {
    navigationError = error;
  }

  // A navigation timeout can still leave a fully usable page behind. Inspect
  // and stabilize it before retrying so a slow analytics/resource request does
  // not turn a successful visit into a false failure.
  let settled = await settlePage(page);
  if (settled.readable) return { ...settled, recoveredFromNavigationTimeout: Boolean(navigationError) };

  // Retry once with the same browser context. Cookies and CSRF/session state
  // created by the first attempt are intentionally retained.
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 75_000 });
    navigationError = undefined;
  } catch (error) {
    navigationError = error;
  }
  settled = await settlePage(page);
  if (settled.readable) return { ...settled, recoveredFromNavigationTimeout: Boolean(navigationError) };
  if (navigationError) throw navigationError;
  throw new Error(`page did not become readable after navigation (${settled.url})`);
}

/** One shared browser profile with one independently addressable page per bot. */
export class BrowserComputer extends DurableObject<Env> {
  private liveBrowser: Browser | null = null;

  private operationDetail(action: Exclude<BrowserAction, "screenshot">, input: Record<string, unknown>): string {
    if (action === "open") {
      try {
        const url = new URL(String(input.url ?? ""));
        return `${url.origin}${url.pathname}`;
      } catch {
        return "page";
      }
    }
    if (action === "click" || action === "fill") return String(input.ref ?? "element");
    if (action === "press") return String(input.key ?? "key").slice(0, 40);
    if (action === "close") return "browser page";
    return "current page";
  }

  private async recordOperation(
    action: Exclude<BrowserAction, "screenshot">,
    input: Record<string, unknown>,
  ): Promise<BrowserOperation> {
    const operation: BrowserOperation = {
      id: crypto.randomUUID(),
      action,
      detail: this.operationDetail(action, input),
      at: Date.now(),
      status: "running",
    };
    const current = await this.ctx.storage.get<BrowserOperation[]>("browserOperations") ?? [];
    await this.ctx.storage.put("browserOperations", [...current.slice(-19), operation]);
    return operation;
  }

  private async finishOperation(operation: BrowserOperation, status: "completed" | "failed") {
    const current = await this.ctx.storage.get<BrowserOperation[]>("browserOperations") ?? [];
    await this.ctx.storage.put("browserOperations", current.map((item) =>
      item.id === operation.id ? { ...item, status } : item,
    ));
  }

  private async session(): Promise<{ browser: Browser; sessionId: string }> {
    if (this.liveBrowser?.isConnected()) {
      return { browser: this.liveBrowser, sessionId: this.liveBrowser.sessionId() };
    }
    const saved = await this.ctx.storage.get<string>("browserSessionId");
    if (saved) {
      try {
        this.liveBrowser = await connect(this.env.MYBROWSER, saved);
        return { browser: this.liveBrowser, sessionId: saved };
      } catch {
        await this.ctx.storage.delete("browserSessionId");
        await this.ctx.storage.delete("browserPageIndexes");
      }
    }
    const { sessionId } = await acquire(this.env.MYBROWSER, { keep_alive: 600_000 });
    await this.ctx.storage.put("browserSessionId", sessionId);
    this.liveBrowser = await connect(this.env.MYBROWSER, sessionId);
    return { browser: this.liveBrowser, sessionId };
  }

  private async agentPage(browser: Browser, botId: string, create: boolean): Promise<Page | null> {
    const marker = `magicbot:${botId}`;
    const contexts = browser.contexts();
    const storedState = contexts.length === 0
      ? await this.ctx.storage.get<BrowserContextOptions["storageState"]>("browserStorageState")
      : undefined;
    const context = contexts[0] ?? await browser.newContext({ storageState: storedState });
    const indexes = await this.ctx.storage.get<Record<string, number>>("browserPageIndexes") ?? {};
    const pages = context.pages();
    const savedIndex = indexes[botId];
    if (Number.isInteger(savedIndex) && savedIndex >= 0 && savedIndex < pages.length) {
      return pages[savedIndex];
    }
    if (!create) return null;
    const page = await context.newPage();
    await page.addInitScript({ content: `window.name = ${JSON.stringify(marker)}` });
    await page.evaluate(`window.name = ${JSON.stringify(marker)}`);
    indexes[botId] = context.pages().indexOf(page);
    await this.ctx.storage.put("browserPageIndexes", indexes);
    return page;
  }

  async act(botId: string, action: BrowserAction, input: Record<string, unknown>) {
    if (!/^[\w-]+$/.test(botId)) throw new Error("invalid bot id");
    const operation = action === "screenshot" ? null : await this.recordOperation(action, input);
    const { browser, sessionId } = await this.session();
    let operationFailed = false;
    try {
      const page = await this.agentPage(browser, botId, action !== "close");
      if (!page) return { ok: true, closed: true };
      if (action === "open") {
        await openComplexPage(page, input.url);
      } else if (action === "click") {
        await page.locator(INTERACTIVE_SELECTOR).nth(refIndex(input.ref)).click({ timeout: 15_000 });
        await settlePage(page, 15_000);
      } else if (action === "fill") {
        await page.locator(INTERACTIVE_SELECTOR).nth(refIndex(input.ref)).fill(String(input.text ?? ""), { timeout: 15_000 });
      } else if (action === "press") {
        await page.keyboard.press(String(input.key ?? "Enter"));
        await settlePage(page, 15_000);
      } else if (action === "close") {
        await page.goto("about:blank");
        return { ok: true, closed: true, sessionId };
      }

      if (action === "screenshot") {
        const bytes = await page.screenshot({ type: "jpeg", quality: 75 });
        const operations = await this.ctx.storage.get<BrowserOperation[]>("browserOperations") ?? [];
        return { ok: true, mimeType: "image/jpeg", image: Buffer.from(bytes).toString("base64"), url: page.url(), title: await page.title(), operations };
      }

      if (action === "snapshot") {
        const locator = page.locator(INTERACTIVE_SELECTOR);
        const count = Math.min(await locator.count(), 200);
        const elements: Array<{ ref: string; tag: string; role: string; name: string }> = [];
        for (let index = 0; index < count; index += 1) {
          const element = locator.nth(index);
          if (!await element.isVisible().catch(() => false)) continue;
          const ref = `e-${index + 1}`;
          elements.push({
            ref,
            tag: await element.evaluate("el => el.tagName.toLowerCase()"),
            role: await element.getAttribute("role") ?? "",
            name: ((await element.getAttribute("aria-label")) ?? (await element.getAttribute("placeholder")) ?? (await element.textContent()) ?? "").trim().slice(0, 240),
          });
        }
        return { ok: true, url: page.url(), title: await page.title(), elements };
      }

      if (action === "text") {
        return { ok: true, url: page.url(), title: await page.title(), text: (await page.locator("body").innerText()).slice(0, 100_000) };
      }

      return { ok: true, url: page.url(), title: await page.title(), sessionId };
    } catch (error) {
      operationFailed = true;
      if (operation) await this.finishOperation(operation, "failed");
      throw error;
    } finally {
      if (operation && !operationFailed) await this.finishOperation(operation, "completed").catch(() => undefined);
      const context = browser.contexts()[0];
      if (context) {
        const state = await context.storageState({ indexedDB: true }).catch(() => null);
        if (state) await this.ctx.storage.put("browserStorageState", state).catch(() => undefined);
      }
    }
  }
}

function durablePath(input: string): string {
  const normalized = input.trim().replaceAll("\\", "/");
  const relative = normalized.startsWith("/workspace/")
    ? normalized.slice("/workspace/".length)
    : normalized === "/workspace"
      ? ""
      : normalized.replace(/^\/+/, "");
  const segments = relative.split("/").filter(Boolean);
  if (segments.includes("..")) throw new Error("path cannot leave /workspace");
  return segments.length ? `/workspace/${segments.join("/")}` : "/workspace";
}

function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "/workspace" : path.slice(0, slash);
}

async function execComputer(env: Env, botId: string, command: string) {
  if (!command.trim()) throw new Error("command required");
  return useWorkspace(env, botId, async (ws) => {
    const handle = await ws.runtime.exec(command, {
      cwd: "/workspace",
      encoding: "utf8",
      timeoutMs: 120_000,
    });
    try {
      const result = await handle.result();
      return {
        ok: result.exitCode === 0,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exitCode: result.exitCode,
        runtime: "cloudflare-computer",
      };
    } finally {
      handle[Symbol.dispose]?.();
    }
  });
}

async function runComputer(
  env: Env,
  botId: string,
  code: string,
  language: "python" | "javascript" | "typescript" = "python",
) {
  if (!code) throw new Error("code required");
  return useWorkspace(env, botId, async (ws) => {
    const extension = language === "python" ? "py" : language === "typescript" ? "ts" : "mjs";
    const path = `/workspace/.magicbot/run-${crypto.randomUUID()}.${extension}`;
    await ws.fs.mkdir(parentPath(path), { recursive: true });
    await ws.fs.writeFile(path, code);
    const command = language === "python"
      ? `python3 '${path}'`
      : language === "typescript"
        ? `node --experimental-strip-types '${path}'`
        : `node '${path}'`;
    const handle = await ws.runtime.exec(command, {
      cwd: "/workspace",
      encoding: "utf8",
      timeoutMs: 120_000,
    });
    try {
      const result = await handle.result();
      return {
        ok: result.exitCode === 0,
        results: [],
        logs: { stdout: [result.stdout ?? ""], stderr: [result.stderr ?? ""] },
        error: result.exitCode === 0 ? null : `Process exited with code ${result.exitCode}`,
        exitCode: result.exitCode,
      };
    } finally {
      handle[Symbol.dispose]?.();
      await ws.fs.rm(path, { force: true }).catch(() => undefined);
    }
  });
}

async function writeComputerFile(env: Env, botId: string, inputPath: string, content: string) {
  const path = durablePath(inputPath);
  if (path === "/workspace") throw new Error("file path required");
  return useWorkspace(env, botId, async (ws) => {
    await ws.fs.mkdir(parentPath(path), { recursive: true });
    await ws.fs.writeFile(path, content);
    return { ok: true, path };
  });
}

async function readComputerFile(env: Env, botId: string, inputPath: string) {
  const path = durablePath(inputPath);
  return useWorkspace(env, botId, async (ws) => ({
    ok: true,
    path,
    content: await ws.fs.readFile(path, "utf8"),
  }));
}

type WhatsAppAction = "start" | "status" | "events" | "send" | "stop" | "logout";
const WHATSAPP_ROOT = "/workspace/.magicbot/whatsapp";

async function readJsonFile(ws: WorkspaceClient, path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await ws.fs.readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function whatsappComputer(
  env: Env,
  botId: string,
  action: WhatsAppAction,
  input: Record<string, unknown> = {},
) {
  return useWorkspace(env, botId, async (ws) => {
    await ws.fs.mkdir(`${WHATSAPP_ROOT}/commands`, { recursive: true });
    const ensureBridge = async () => {
      const command = [
        "set -eu",
        `mkdir -p ${shellQuote(`${WHATSAPP_ROOT}/commands`)}`,
        `chmod 700 ${shellQuote(WHATSAPP_ROOT)} ${shellQuote(`${WHATSAPP_ROOT}/commands`)}`,
        `if ! mkdir ${shellQuote(`${WHATSAPP_ROOT}/start.lock`)} 2>/dev/null; then exit 0; fi`,
        `trap 'rmdir ${WHATSAPP_ROOT}/start.lock 2>/dev/null || true' EXIT`,
        `pid=\"$(cat ${shellQuote(`${WHATSAPP_ROOT}/pid`)} 2>/dev/null || true)\"`,
        `if test -n \"$pid\" && kill -0 \"$pid\" 2>/dev/null && grep -Fq ${shellQuote("/opt/magicteams/whatsapp/worker.mjs")} \"/proc/$pid/cmdline\" 2>/dev/null; then exit 0; fi`,
        `rm -f ${shellQuote(`${WHATSAPP_ROOT}/pid`)}`,
        `nohup node /opt/magicteams/whatsapp/worker.mjs ${shellQuote(WHATSAPP_ROOT)} >> ${shellQuote(`${WHATSAPP_ROOT}/worker.log`)} 2>&1 < /dev/null &`,
        `echo $! > ${shellQuote(`${WHATSAPP_ROOT}/pid`)}`,
      ].join("\n");
      const handle = await ws.runtime.exec(command, { cwd: "/workspace", encoding: "utf8", timeoutMs: 10_000 });
      try {
        const result = await handle.result();
        if (result.exitCode !== 0) throw new Error(result.stderr || "could not start WhatsApp bridge");
      } finally {
        handle[Symbol.dispose]?.();
      }
    };
    if (action === "start") {
      await ensureBridge();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { ok: true, state: await readJsonFile(ws, `${WHATSAPP_ROOT}/state.json`) ?? { status: "starting" } };
    }
    if (action === "status") {
      return { ok: true, state: await readJsonFile(ws, `${WHATSAPP_ROOT}/state.json`) ?? { status: "disconnected" } };
    }
    if (action === "events") {
      await ensureBridge();
      const cursor = Math.max(0, Math.floor(Number(input.cursor ?? 0)));
      const content = await ws.fs.readFile(`${WHATSAPP_ROOT}/events.jsonl`, "utf8").catch(() => "");
      const bytes = new TextEncoder().encode(content);
      const next = Math.min(cursor, bytes.byteLength);
      const tail = new TextDecoder().decode(bytes.slice(next));
      const events = tail.split("\n").filter(Boolean).slice(0, 2_000).map((line) => JSON.parse(line));
      const consumed = new TextEncoder().encode(events.map((event) => JSON.stringify(event)).join("\n") + (events.length ? "\n" : "")).byteLength;
      return { ok: true, cursor: next + consumed, events };
    }
    const id = crypto.randomUUID();
    const command = action === "send"
      ? { id, type: "send", chatJid: String(input.chatJid ?? ""), text: String(input.text ?? "") }
      : { id, type: action };
    await ws.fs.writeFile(`${WHATSAPP_ROOT}/commands/${id}.json`, JSON.stringify(command));
    return { ok: true, commandId: id, queued: true };
  });
}

async function destroyComputer(env: Env, botId: string) {
  await browserStub(env, botId).act(botId, "close", {});
  return { ok: true, sharedWorkspacePreserved: true };
}

async function sleepComputer(env: Env, botId: string) {
  await browserStub(env, botId).act(botId, "close", {});
  return { ok: true, sharedWorkspacePreserved: true };
}

type CodexEffort = "low" | "medium" | "high" | "xhigh";

function codexAuthFile(raw: string): string {
  if (!raw || raw.length > 64_000) throw new Error("Codex connection is invalid");
  const parsed = JSON.parse(raw) as {
    auth_mode?: unknown;
    tokens?: { access_token?: unknown; account_id?: unknown };
  };
  if (parsed.auth_mode !== "chatgpt" || typeof parsed.tokens?.access_token !== "string" || typeof parsed.tokens.account_id !== "string") {
    throw new Error("Codex connection is incomplete");
  }
  return raw;
}

async function runCodex(
  env: Env,
  botId: string,
  authJson: string,
  prompt: string,
  model: string,
  effort: CodexEffort = "medium",
) {
  const auth = codexAuthFile(authJson);
  if (!prompt.trim() || prompt.length > 120_000) throw new Error("Codex prompt is invalid");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(model)) throw new Error("Codex model is invalid");
  if (!["low", "medium", "high", "xhigh"].includes(effort)) throw new Error("Codex effort is invalid");

  return useWorkspace(env, botId, async (ws) => {
    const command = [
      "set -eu",
      'auth_dir="$(mktemp -d)"',
      'trap \'rm -rf "$auth_dir"\' EXIT',
      'export CODEX_HOME="$auth_dir/codex"',
      'mkdir -p "$CODEX_HOME"',
      "node -e 'const fs=require(\"fs\");fs.writeFileSync(process.env.CODEX_HOME+\"/auth.json\",process.env.MAGICBOT_CODEX_AUTH,{mode:0o600})'",
      "unset MAGICBOT_CODEX_AUTH",
      // Codex is a reasoning runtime here, not an ungoverned side-effect path.
      // Mutating/browser/connector actions must flow through the web Worker's
      // governed tools so they can be classified, audited, and approved.
      `codex exec --json --ephemeral --ignore-user-config --ignore-rules --skip-git-repo-check --sandbox read-only -C /workspace -m ${shellQuote(model)} -c ${shellQuote(`model_reasoning_effort=${effort}`)} -o \"$auth_dir/last-message\" - > \"$auth_dir/events.jsonl\"`,
      'cat "$auth_dir/last-message"',
    ].join("; ");
    const handle = await ws.runtime.exec(command, {
      cwd: "/workspace",
      encoding: "utf8",
      env: { MAGICBOT_CODEX_AUTH: auth },
      stdin: prompt,
      timeoutMs: 180_000,
    });
    try {
      const result = await handle.result();
      return {
        ok: result.exitCode === 0 && Boolean(result.stdout?.trim()),
        text: result.stdout?.trim() ?? "",
        stderr: result.stderr?.slice(-8_000) ?? "",
        exitCode: result.exitCode,
        runtime: "codex-cli-cloudflare-computer",
      };
    } finally {
      handle[Symbol.dispose]?.();
    }
  });
}

/** Private service-binding API used by the hosted web Worker. */
export class WebComputer extends WorkerEntrypoint<Env> {
  async status(botId: string) {
    const stub = workspaceStub(this.env, botId) as unknown as {
      computerStatus(): Promise<{ running: boolean; exit: unknown }>;
    };
    return stub.computerStatus();
  }

  exec(botId: string, command: string) {
    return execComputer(this.env, botId, command);
  }

  run(botId: string, code: string, language?: "python" | "javascript" | "typescript") {
    return runComputer(this.env, botId, code, language);
  }

  writeFile(botId: string, path: string, content: string) {
    return writeComputerFile(this.env, botId, path, content);
  }

  readFile(botId: string, path: string) {
    return readComputerFile(this.env, botId, path);
  }

  destroy(botId: string) {
    return destroyComputer(this.env, botId);
  }

  sleep(botId: string) {
    return sleepComputer(this.env, botId);
  }

  codex(botId: string, authJson: string, prompt: string, model: string, effort?: CodexEffort) {
    return runCodex(this.env, botId, authJson, prompt, model, effort);
  }

  browser(botId: string, action: BrowserAction, input: Record<string, unknown> = {}) {
    return browserStub(this.env, botId).act(botId, action, input);
  }

  whatsapp(botId: string, action: WhatsAppAction, input: Record<string, unknown> = {}) {
    return whatsappComputer(this.env, botId, action, input);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const auth = request.headers.get("authorization") ?? "";
    if (!env.MAGICBOT_COMPUTER_TOKEN || auth !== `Bearer ${env.MAGICBOT_COMPUTER_TOKEN}`) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/computer\/([\w-]+)\/(\w+)$/);
    if (!match) return json({ ok: false, error: "no route" }, 404);
    const [, botId, action] = match;

    try {
      const body: Record<string, unknown> = request.method === "POST"
        ? await request.json<Record<string, unknown>>().catch(() => ({}))
        : {};
      switch (action) {
        case "status": {
          const stub = workspaceStub(env, botId) as unknown as {
            computerStatus(): Promise<{ running: boolean; exit: unknown }>;
          };
          const state = await stub.computerStatus();
          return json({ ok: true, ready: true, backend: "cloudflare-computer", ...state });
        }
        case "exec":
          return json(await execComputer(env, botId, String(body.command ?? "")));
        case "run":
          return json(await runComputer(
            env,
            botId,
            String(body.code ?? ""),
            (body.language === "javascript" || body.language === "typescript" ? body.language : "python"),
          ));
        case "writeFile":
          return json(await writeComputerFile(env, botId, String(body.path ?? ""), String(body.content ?? "")));
        case "readFile":
          return json(await readComputerFile(env, botId, String(body.path ?? "")));
        case "destroy":
          return json(await destroyComputer(env, botId));
        case "sleep":
          return json(await sleepComputer(env, botId));
        case "browserOpen":
          return json(await browserStub(env, botId).act(botId, "open", body));
        case "browserState":
          return json(await browserStub(env, botId).act(botId, "state", body));
        case "browserText":
          return json(await browserStub(env, botId).act(botId, "text", body));
        case "browserSnapshot":
          return json(await browserStub(env, botId).act(botId, "snapshot", body));
        case "browserClick":
          return json(await browserStub(env, botId).act(botId, "click", body));
        case "browserFill":
          return json(await browserStub(env, botId).act(botId, "fill", body));
        case "browserPress":
          return json(await browserStub(env, botId).act(botId, "press", body));
        case "browserScreenshot":
          return json(await browserStub(env, botId).act(botId, "screenshot", body));
        case "browserClose":
          return json(await browserStub(env, botId).act(botId, "close", body));
        case "expose":
          return json({ ok: false, error: "Public port sharing is not available on workers.dev." }, 409);
        default:
          return json({ ok: false, error: `unknown action: ${action}` }, 404);
      }
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
