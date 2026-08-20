// MagicBot server — the harness host. Clients hold no transports
// (upstream rule): the React app dispatches typed commands over HTTP and
// folds one SSE event stream; every provider process runs here.
import { readFileSync, unlinkSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { extname, join } from "node:path";

import * as box from "./box.ts";
import * as cfcomputer from "./cfcomputer.ts";
import * as composio from "./composio.ts";
import { ensureDirs, instanceConfigs, loadConfig, saveConfig, EVENTS_DIR, NATIVE_DIR } from "./config.ts";
import type { RuntimeEvent } from "./contracts.ts";

import { BUILT_IN_DRIVERS } from "./drivers/builtIn.ts";
import { EventBus } from "./harness/bus.ts";
import * as memory from "./organs/memory.ts";
import * as routines from "./organs/routines.ts";
import * as delegation from "./organs/delegation.ts";
import { ProviderRegistry } from "./harness/registry.ts";
import { Store, type BotRecord, type Message } from "./store.ts";

const PORT = Number(process.env.OMB_PORT || process.env.OGB_PORT || 8799);
const STATIC_DIR = process.env.OMB_STATIC_DIR || null;
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

ensureDirs();
const cfg = loadConfig();
const registry = new ProviderRegistry(BUILT_IN_DRIVERS);
await registry.load(instanceConfigs(cfg));

const bus = new EventBus();
bus.attach(registry.instances());

// default selection for new bots: first available instance, claude preferred
async function defaultSelection() {
  const described = await registry.describe();
  const available = described.filter((d) => d.snapshot.state === "available");
  const pick = available.find((d) => d.driverKind === "claudeAgent") ?? available[0] ?? described[0];
  return { instanceId: pick?.instanceId ?? "claude", model: pick?.models.default || "claude-sonnet-5" };
}
let bootSelection = { instanceId: "claude", model: "claude-sonnet-5" };
const store = new Store(() => bootSelection);
bootSelection = await defaultSelection();
store.seedIfEmpty();

// ── SSE fan-out to clients ─────────────────────────────────────────────
const sseClients = new Set<ServerResponse>();
function broadcast(payload: unknown) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of [...sseClients]) {
    try {
      res.write(frame);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ── server-side event folding (upstream's ingestion worker, miniature) ──
// The canonical stream is the source of truth; the persisted transcript
// and every client view are projections of it.
type MessageRef = { threadId: string; messageId: string };
const toolMessageByItem = new Map<string, MessageRef>();
const askMessageByRequest = new Map<string, MessageRef>();
// delegation organ: [DELEGATE: bot | task] markers seen this turn, executed on
// turn.completed; hop counter (per orchestrator thread) bounds delegation chains
const pendingDelegations = new Map<string, delegation.Delegation[]>();
const delegationHops = new Map<string, number>();
type ActiveTurn = { token: symbol; turnId?: string; pendingCompletions: RuntimeEvent[] };
const activeTurns = new Map<string, ActiveTurn>();

function clearThreadLifecycle(threadId: string, preserveDelegationState = false) {
  if (!preserveDelegationState) {
    pendingDelegations.delete(threadId);
    delegationHops.delete(threadId);
  }
  for (const [itemId, ref] of toolMessageByItem) {
    if (ref.threadId === threadId) toolMessageByItem.delete(itemId);
  }
  for (const [requestId, ref] of askMessageByRequest) {
    if (ref.threadId === threadId) askMessageByRequest.delete(requestId);
  }
}

bus.subscribe((event: RuntimeEvent) => {
  const bot = store.botByThread(event.threadId);
  if (!bot) return;
  // Providers may flush buffered events after an interrupt/reload. Ignore
  // events tied to a turn that is no longer active so cancelled output cannot
  // reappear in the transcript or streaming UI.
  if (event.turnId) {
    const active = activeTurns.get(bot.id);
    if (!active || (active.turnId && event.turnId !== active.turnId)) return;
  }
  broadcast({ kind: "runtime", event });

  const pushMessage = (m: Omit<Message, "id" | "at">) => {
    const message = store.appendMessage(event.threadId, m);
    broadcast({ kind: "message", threadId: event.threadId, message });
    return message;
  };

  switch (event.type) {
    case "session.started":
      if (event.sessionId && event.providerInstanceId) {
        store.setResumeCursor(bot.id, event.providerInstanceId, event.sessionId);
      }
      break;
    case "item.completed":
      if (event.itemType === "assistant_text") {
        // AIOS memory organ: pull [REMEMBER: …] markers out of the reply,
        // persist them, and show the user the cleaned text.
        const { stripped, captured } = memory.captureFromText(bot.id, event.text);
        // delegation organ: pull [DELEGATE: bot | task] markers; stash them to
        // run when the turn completes, and hide them from the shown text.
        const delegations = delegation.parse(stripped);
        const display = delegation.strip(stripped);
        pushMessage({ role: "bot", kind: "text", text: display || stripped || event.text });
        for (const fact of captured) {
          pushMessage({ role: "bot", kind: "activity", tool: { name: `remembered: ${fact.text.slice(0, 60)}`, ok: true } });
        }
        if (delegations.length) {
          const list = pendingDelegations.get(event.threadId) ?? [];
          list.push(...delegations);
          pendingDelegations.set(event.threadId, list);
        }
      } else if (event.itemType === "tool" && event.itemId) {
        const ref = toolMessageByItem.get(event.itemId);
        if (ref?.threadId === event.threadId) {
          const messageId = ref.messageId;
          const patched = store.patchMessage(event.threadId, messageId, {
            tool: { name: store.messagesFor(event.threadId).find((m) => m.id === messageId)?.tool?.name ?? "tool", ok: event.ok },
          });
          if (patched) broadcast({ kind: "message.patch", threadId: event.threadId, message: patched });
          toolMessageByItem.delete(event.itemId);
        }
        // the bot just finished acting — refresh its screen preview now
        pokeScreenPoller(bot.id);
      }
      break;
    case "item.started":
      if (event.itemType === "tool") {
        const message = pushMessage({ role: "bot", kind: "activity", tool: { name: event.title ?? "tool" } });
        if (event.itemId) toolMessageByItem.set(event.itemId, { threadId: event.threadId, messageId: message.id });
      }
      break;
    case "request.opened": {
      const permission = event.requestType === "permission";
      const message = pushMessage({
        role: "bot",
        kind: "options",
        card: {
          title: permission ? "Approval needed" : "Your bot has a question",
          subtitle: event.summary,
          options: event.choices?.length ? event.choices : permission ? ["Allow", "Deny"] : [],
          requestId: event.requestId,
        },
      });
      if (event.requestId) askMessageByRequest.set(event.requestId, { threadId: event.threadId, messageId: message.id });
      break;
    }
    case "request.resolved": {
      const ref = event.requestId ? askMessageByRequest.get(event.requestId) : null;
      if (ref?.threadId === event.threadId) {
        const messageId = ref.messageId;
        const existing = store.messagesFor(event.threadId).find((m) => m.id === messageId);
        if (existing?.card && !existing.card.answered) {
          const patched = store.patchMessage(event.threadId, messageId, {
            card: { ...existing.card, answered: event.behavior, dismissed: event.source !== "user" },
          });
          if (patched) broadcast({ kind: "message.patch", threadId: event.threadId, message: patched });
        }
        if (event.requestId) askMessageByRequest.delete(event.requestId);
      }
      break;
    }
    case "runtime.error":
      pushMessage({ role: "bot", kind: "activity", tool: { name: `error: ${event.message.slice(0, 160)}`, ok: false } });
      break;
    case "turn.completed": {
      const active = activeTurns.get(bot.id);
      if (!active) break;
      // Some adapters can emit a terminal event before sendTurn's promise
      // resolves with the provider turn id. Queue it briefly so a fast local
      // response cannot leave the bot permanently busy.
      if (!active.turnId) {
        active.pendingCompletions.push(event);
        break;
      }
      if (event.turnId && event.turnId !== active.turnId) break;
      settleTurn(bot.id, event.threadId);
      break;
    }
  }
});

function settleTurn(botId: string, threadId: string) {
  const bot = store.bot(botId);
  if (!bot || bot.threadId !== threadId || !activeTurns.has(botId)) return;
      // the last live frame becomes a settled inline screen message —
      // the screenshot-in-chat moment
      const frame = stopScreenPoller(bot.id);
      if (frame) {
        const message = store.appendMessage(threadId, { role: "bot", kind: "screen", png: frame.png, mime: frame.mime });
        broadcast({ kind: "message", threadId, message });
      }
      activeTurns.delete(bot.id);
      store.patchBot(bot.id, { busy: false, unread: true });
      broadcast({ kind: "bot", bot: store.bot(bot.id) });
      // delegation organ: run any [DELEGATE] handoffs this turn queued, then
      // feed the results back so the orchestrator continues (bounded by hops)
      const pending = pendingDelegations.get(threadId);
      if (pending?.length) {
        pendingDelegations.delete(threadId);
        clearThreadLifecycle(threadId, true);
        void runDelegations(bot.id, threadId, pending);
      } else {
        clearThreadLifecycle(threadId);
      }
}

// ── live screen: poll the bot's box while it works ────────────────────
// Frames stream to clients as SSE {kind:'screen'} (the "Bot's screen"
// panel); the final frame is folded into the transcript on turn end.
type Frame = { png: string; mime: string };
const screenPollers = new Map<
  string,
  { timer: ReturnType<typeof setInterval>; capture: () => Promise<void>; last: Frame | null }
>();

function startScreenPoller(botId: string) {
  if (screenPollers.has(botId) || !box.boxConfigured(cfg)) return;
  let inFlight = false;
  const capture = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const { png, format } = await box.screenshotBox(cfg, botId);
      if (screenPollers.get(botId) !== entry) return;
      const frame = { png, mime: format === "jpeg" ? "image/jpeg" : "image/png" };
      entry.last = frame;
      broadcast({ kind: "screen", botId, ...frame });
    } catch {
      /* box asleep or mid-command — try again next tick */
    } finally {
      inFlight = false;
    }
  };
  const entry = {
    timer: setInterval(capture, 4000),
    capture,
    last: null as Frame | null,
  };
  screenPollers.set(botId, entry);
}

/** Event-driven refresh: capture NOW (the bot just acted on its screen)
 * instead of waiting for the next interval tick. */
function pokeScreenPoller(botId: string) {
  void screenPollers.get(botId)?.capture();
}

function stopScreenPoller(botId: string): Frame | null {
  const entry = screenPollers.get(botId);
  if (!entry) return null;
  clearInterval(entry.timer);
  screenPollers.delete(botId);
  return entry.last;
}

// Local computer-use contract written by Electron main on startup
// (~/Library/Application Support/MagicBot/cua-connection.json). Read
// fresh each turn — Electron may restart or permissions may change.
function readCuaConnection(): { command: string; args: string[]; env: Record<string, string> } | null {
  // new name first; pre-rename desktop builds used the old directory
  for (const dir of ["MagicBot", "magicbot", "OpenGrokBot", "opengrokbot"]) {
    try {
      const p = join(homedir(), "Library", "Application Support", dir, "cua-connection.json");
      const conn = JSON.parse(readFileSync(p, "utf8"));
      if (!conn || conn.mode === "unavailable" || !conn.mcpCommand) continue;
      return { command: conn.mcpCommand, args: conn.mcpArgs ?? ["mcp"], env: conn.mcpEnv ?? {} };
    } catch {
      /* try the next location */
    }
  }
  return null;
}

// The system-prompt block that teaches a bot to delegate to its teammates.
function delegationBlock(selfId: string): string {
  const others = store.bots.filter((b) => b.id !== selfId && !b.hidden).map((b) => b.name);
  if (!others.length) return "";
  return (
    ` You work alongside other bots you can hand tasks to: ${others.join(", ")}.` +
    ` To delegate, write [DELEGATE: <bot name> | <the task, with enough context to act>] in your reply.` +
    ` Their result is fed back to you so you can combine it and answer the user. Delegate only when a teammate is better suited; otherwise just do it yourself.`
  );
}

// ── delegation organ: run queued handoffs, feed results back ────────────
async function runDelegations(orchestratorId: string, threadId: string, delegations: delegation.Delegation[]) {
  const post = (m: Parameters<typeof store.appendMessage>[1]) => {
    const message = store.appendMessage(threadId, m);
    broadcast({ kind: "message", threadId, message });
  };
  const hops = delegationHops.get(threadId) ?? 0;
  if (hops >= delegation.MAX_HOPS) {
    post({ role: "bot", kind: "activity", tool: { name: "delegation limit reached — stopping", ok: false } });
    delegationHops.delete(threadId);
    return;
  }

  const results: string[] = [];
  for (const d of delegations) {
    const target = store.bots.find((b) => b.name.toLowerCase() === d.to.toLowerCase() && b.id !== orchestratorId);
    if (!target) {
      results.push(`(no bot named "${d.to}" — skipped)`);
      continue;
    }
    post({ role: "bot", kind: "activity", tool: { name: `delegated to ${target.name}: ${d.task.slice(0, 60)}` } });
    try {
      const answer = await delegation.collectTurn(bus, startTurn, target.id, target.threadId, d.task);
      results.push(`Result from ${target.name}:\n${answer}`);
    } catch (e) {
      results.push(`${target.name} could not complete it: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  delegationHops.set(threadId, hops + 1);
  // hand the results back to the orchestrator as its next input so it continues
  await startTurn(orchestratorId, `[delegation results]\n\n${results.join("\n\n")}`).catch(() => {
    delegationHops.delete(threadId);
  });
}

// ── turn dispatch (upstream ProviderCommandReactor, miniature) ──────────
async function startTurn(botId: string, text: string) {
  const bot = store.bot(botId);
  if (!bot) throw Object.assign(new Error("no such bot"), { status: 404 });
  if (bot.busy) throw Object.assign(new Error("the bot is already working — interrupt it first"), { status: 409 });

  const instance = registry.get(bot.modelSelection.instanceId);
  if (!instance) {
    throw Object.assign(
      new Error(`provider instance "${bot.modelSelection.instanceId}" is unavailable — pick another model in settings`),
      { status: 409 },
    );
  }

  const userMessage = store.appendMessage(bot.threadId, { role: "user", kind: "text", text });
  broadcast({ kind: "message", threadId: bot.threadId, message: userMessage });

  // transcript for API-backed drivers: settled text turns only
  const transcript = store
    .messagesFor(bot.threadId)
    .filter((m) => m.kind === "text" && m.text && m.id !== userMessage.id)
    .slice(-40)
    .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), text: m.text! }));

  const persona =
    [
      `You are ${bot.name}, a personal bot in MagicBot.`,
      bot.title && `Role: ${bot.title}.`,
      bot.description && `About: ${bot.description}`,
    ]
      .filter(Boolean)
      .join(" ") +
    " When you learn a durable fact about the user or their work that would help future conversations" +
    " (a preference, a name, an ongoing goal, a constraint), record it by writing [REMEMBER: the fact]" +
    " anywhere in your reply. Do not re-remember things already listed below." +
    delegationBlock(bot.id) +
    memory.memoryBlock(bot.id);

  // busy flips immediately so the composer locks; the dispatch itself runs
  // in the background — box provisioning can take ~90s and must never
  // hang the HTTP request
  store.patchBot(bot.id, { busy: true, unread: false });
  broadcast({ kind: "bot", bot: store.bot(bot.id) });
  const activeTurn: ActiveTurn = { token: Symbol(bot.id), pendingCompletions: [] };
  activeTurns.set(bot.id, activeTurn);

  void (async () => {
    try {
      const integrations: NonNullable<Parameters<typeof instance.adapter.sendTurn>[0]["integrations"]> = {};
      if (cfg.composio?.key) integrations.composio = { key: cfg.composio.key, url: cfg.composio.url };
      const wants = bot.computer; // 'cloud' | 'local' | 'off' | undefined(auto)
      if (wants !== "off" && wants !== "local" && box.boxConfigured(cfg)) {
        let b = await box.findBox(cfg, bot.id).catch(() => null);
        // the Computer driver runs ON the box — provision it on first use
        if (!b && instance.driverKind === "boxAgent") {
          broadcast({ kind: "computer", botId: bot.id, state: "provisioning" });
          await box.provisionBox(cfg, bot.id, bot.name);
          if (activeTurns.get(bot.id)?.token !== activeTurn.token) return;
          b = await box.findBox(cfg, bot.id).catch(() => null);
        }
        if (b) integrations.computer = { boxId: b.id, token: cfg.box!.token! };
      }
      // Cloudflare cloud computer (cf-computer/ Worker): the headless
      // fallback when Box isn't configured or has no box for this bot.
      // The Computer driver (boxAgent) runs ON a box, so it stays Box-only.
      if (
        !integrations.computer &&
        wants !== "off" &&
        wants !== "local" &&
        instance.driverKind !== "boxAgent" &&
        cfcomputer.cfConfigured(cfg)
      ) {
        integrations.cfComputer = { url: cfg.cfComputer!.url!, token: cfg.cfComputer!.token!, botId: bot.id };
      }
      // local computer (this Mac) via the Electron-hosted cua-driver: the
      // Electron main process owns the daemon (TCC attribution) and writes
      // its spawn contract to cua-connection.json; the harness only reads it
      if (!integrations.computer && !integrations.cfComputer && wants !== "off" && wants !== "cloud") {
        const cua = readCuaConnection();
        if (cua) integrations.localComputer = cua;
      }

      if (activeTurns.get(bot.id)?.token !== activeTurn.token) return;
      const started = await instance.adapter.sendTurn({
        threadId: bot.threadId,
        text,
        model: bot.modelSelection.model,
        resumeCursor: bot.resumeCursors[bot.modelSelection.instanceId],
        transcript,
        system:
          persona +
          (integrations.computer && instance.driverKind !== "boxAgent"
            ? " You have your own cloud computer — use the computer tools (screenshot, computer_exec, open_url) whenever browsing or acting on a desktop helps."
            : integrations.cfComputer
              ? " You have your own headless cloud computer — a persistent Linux container whose disk survives between turns. Use its tools (computer_exec, run_code, write_file, read_file, expose_port) whenever running code, keeping files, or hosting a service helps. It has no display — use CLI tools, not GUI apps."
              : integrations.localComputer
              ? " You can act on the user's computer through the computer tools — take a screenshot or read the desktop state first, prefer accessibility actions over raw coordinates, and act carefully."
              : ""),
        integrations,
      });
      if (activeTurns.get(bot.id)?.token !== activeTurn.token) {
        await instance.adapter.interruptTurn(bot.threadId, started.turnId).catch(() => {});
        return;
      }
      activeTurn.turnId = started.turnId;
      const completion = activeTurn.pendingCompletions.find(
        (event) => !event.turnId || event.turnId === started.turnId,
      );
      if (completion) {
        settleTurn(bot.id, completion.threadId);
        return;
      }
      if (integrations.computer) startScreenPoller(bot.id);
    } catch (e) {
      if (activeTurns.get(bot.id)?.token !== activeTurn.token) return;
      const message = e instanceof Error ? e.message : String(e);
      const failure = store.appendMessage(bot.threadId, {
        role: "bot",
        kind: "activity",
        tool: { name: `error: ${message.slice(0, 160)}`, ok: false },
      });
      broadcast({ kind: "message", threadId: bot.threadId, message: failure });
      activeTurns.delete(bot.id);
      stopScreenPoller(bot.id);
      clearThreadLifecycle(bot.threadId);
      store.patchBot(bot.id, { busy: false });
      broadcast({ kind: "bot", bot: store.bot(bot.id) });
    }
  })();
}

// ── config hot-reload ─────────────────────────────────────────────────
function configStatus() {
  return {
    xai: { configured: Boolean(cfg.xai?.key) },
    composio: { configured: Boolean(cfg.composio?.key), apiKeyConfigured: Boolean(cfg.composio?.apiKey) },
    box: { configured: Boolean(cfg.box?.token) },
  };
}

/** Rebuild the provider fleet after a config change so new keys take
 * effect without a server restart (kills any in-flight turns). */
async function reloadProviders() {
  for (const bot of store.bots) {
    const wasActive = Boolean(bot.busy || activeTurns.has(bot.id) || screenPollers.has(bot.id));
    activeTurns.delete(bot.id);
    stopScreenPoller(bot.id);
    clearThreadLifecycle(bot.threadId);
    if (bot.busy) store.patchBot(bot.id, { busy: false });
    if (wasActive) broadcast({ kind: "bot", bot: store.bot(bot.id) });
  }
  bus.detachAll();
  await registry.disposeAll();
  await registry.load(instanceConfigs(cfg));
  bus.attach(registry.instances());
}

// ── HTTP plumbing ─────────────────────────────────────────────────────
function json(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(data);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

const BOT_COLORS = new Set(["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral"]);
const BOT_EXPRESSIONS = new Set([
  "deadpan",
  "friendly",
  "focused",
  "thinking",
  "excited",
  "sleepy",
  "surprised",
  "skeptical",
  "worried",
  "mischievous",
]);

function validateBotPatch(body: unknown): Partial<BotRecord> {
  if (!isRecord(body)) throw httpError(400, "body must be a JSON object");
  const patch: Partial<BotRecord> = {};
  for (const key of ["name", "title", "description"] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "string") throw httpError(400, `${key} must be a string`);
    patch[key] = body[key];
  }
  for (const key of ["notifications", "unread", "pinned", "hidden"] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "boolean") throw httpError(400, `${key} must be a boolean`);
    patch[key] = body[key];
  }
  if (body.color !== undefined) {
    if (typeof body.color !== "string" || !BOT_COLORS.has(body.color)) throw httpError(400, "invalid bot color");
    patch.color = body.color as BotRecord["color"];
  }
  if (body.mascotExpression !== undefined) {
    if (body.mascotExpression !== null && (typeof body.mascotExpression !== "string" || !BOT_EXPRESSIONS.has(body.mascotExpression))) {
      throw httpError(400, "invalid mascotExpression");
    }
    patch.mascotExpression = body.mascotExpression as BotRecord["mascotExpression"];
  }
  if (body.computer !== undefined) {
    if (body.computer !== "cloud" && body.computer !== "local" && body.computer !== "off") {
      throw httpError(400, 'computer must be "cloud", "local", or "off"');
    }
    patch.computer = body.computer;
  }
  if (body.modelSelection !== undefined) {
    const selection = body.modelSelection;
    if (
      !isRecord(selection) ||
      typeof selection.instanceId !== "string" ||
      !selection.instanceId.trim() ||
      typeof selection.model !== "string" ||
      !selection.model.trim()
    ) {
      throw httpError(400, "modelSelection must contain non-empty instanceId and model strings");
    }
    patch.modelSelection = { instanceId: selection.instanceId, model: selection.model };
  }
  if (!Object.keys(patch).length) throw httpError(400, "no valid bot fields to update");
  return patch;
}

function validateResponse(body: unknown): { requestId: string; decision: { behavior: "allow" | "deny" | "answer"; message?: string } } {
  if (!isRecord(body)) throw httpError(400, "body must be a JSON object");
  if (typeof body.requestId !== "string" || !body.requestId.trim()) throw httpError(400, "requestId is required");
  if (body.behavior !== "allow" && body.behavior !== "deny" && body.behavior !== "answer") {
    throw httpError(400, 'behavior must be "allow", "deny", or "answer"');
  }
  if (body.message !== undefined && typeof body.message !== "string") throw httpError(400, "message must be a string");
  if (body.behavior === "answer" && (!body.message || !body.message.trim())) {
    throw httpError(400, "message is required when behavior is answer");
  }
  return {
    requestId: body.requestId,
    decision: { behavior: body.behavior, ...(body.message !== undefined ? { message: body.message } : {}) },
  };
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const onData = (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > 1_000_000) {
        settled = true;
        req.pause();
        req.off("data", onData);
        req.off("end", onEnd);
        reject(httpError(413, "body too large"));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      try {
        const data = Buffer.concat(chunks).toString("utf8");
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(httpError(400, "invalid JSON body"));
      }
    };
    const onError = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? "GET";
  try {
    // ── events stream ──
    if (method === "GET" && path === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ kind: "hello" })}\n\n`);
      sseClients.add(res);
      const keepalive = setInterval(() => {
        try {
          res.write(": keepalive\n\n");
        } catch {}
      }, 25_000);
      req.on("close", () => {
        clearInterval(keepalive);
        sseClients.delete(res);
      });
      return;
    }

    // ── bots ──
    if (method === "GET" && path === "/api/bots") {
      return json(res, 200, {
        bots: store.bots.map((b) => ({ ...b, messages: store.messagesFor(b.threadId) })),
      });
    }
    if (method === "POST" && path === "/api/bots") {
      const bot = store.createBot();
      store.patchBot(bot.id, { modelSelection: await defaultSelection() });
      return json(res, 201, { bot: { ...store.bot(bot.id)!, messages: store.messagesFor(bot.threadId) } });
    }
    let m = path.match(/^\/api\/bots\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const body = await readBody(req);
      const patch = validateBotPatch(body);
      const bot = store.patchBot(m[1], patch);
      if (!bot) return json(res, 404, { error: "no such bot" });
      broadcast({ kind: "bot", bot });
      return json(res, 200, { bot });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)$/);
    if (m && method === "DELETE") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      // a running turn dies with its bot
      const active = activeTurns.get(bot.id);
      activeTurns.delete(bot.id);
      stopScreenPoller(bot.id);
      clearThreadLifecycle(bot.threadId);
      await registry.get(bot.modelSelection.instanceId)?.adapter.interruptTurn(bot.threadId, active?.turnId).catch(() => {});
      store.deleteBot(bot.id);
      for (const dir of [EVENTS_DIR, NATIVE_DIR]) {
        try {
          unlinkSync(join(dir, `${bot.threadId}.ndjson`));
        } catch {}
      }
      broadcast({ kind: "bot.deleted", botId: bot.id });
      return json(res, 200, { ok: true });
    }

    // routines — recurring scheduled tasks per bot (AIOS organ)
    m = path.match(/^\/api\/bots\/([\w-]+)\/routines$/);
    if (m && method === "GET") return json(res, 200, { routines: routines.forBot(m[1]) });
    if (m && method === "POST") {
      if (!store.bot(m[1])) return json(res, 404, { error: "no such bot" });
      const body = await readBody(req);
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      if (!prompt.trim()) return json(res, 400, { error: "prompt required" });
      const everyMinutes = Number(body.everyMinutes) || 1440;
      const routine = routines.create(m[1], prompt, everyMinutes);
      broadcast({ kind: "routines", botId: m[1], routines: routines.forBot(m[1]) });
      return json(res, 200, { routine });
    }
    m = path.match(/^\/api\/routines\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const body = await readBody(req);
      const routine = routines.patch(m[1], body as Record<string, never>);
      if (!routine) return json(res, 404, { error: "no such routine" });
      broadcast({ kind: "routines", botId: routine.botId, routines: routines.forBot(routine.botId) });
      return json(res, 200, { routine });
    }
    if (m && method === "DELETE") {
      const existing = routines.get(m[1]);
      if (!routines.remove(m[1])) return json(res, 404, { error: "no such routine" });
      if (existing) broadcast({ kind: "routines", botId: existing.botId, routines: routines.forBot(existing.botId) });
      return json(res, 200, { ok: true });
    }

    // cloud computer (Cloudflare) — status + a one-shot connectivity test so
    // the user can confirm a deployed cf-computer/ Worker before relying on it
    if (method === "GET" && path === "/api/cfcomputer") {
      return json(res, 200, { configured: cfcomputer.cfConfigured(cfg) });
    }
    if (method === "POST" && path === "/api/cfcomputer/test") {
      if (!cfcomputer.cfConfigured(cfg)) return json(res, 400, { error: "set the cloud computer URL + token first" });
      try {
        const r = await cfcomputer.exec(cfg, "connectivity-test", "echo magicbot-ok");
        return json(res, 200, { ok: r.ok, stdout: r.stdout.trim() });
      } catch (e) {
        return json(res, 502, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // onboarding/ask cards persist their answered/dismissed state
    m = path.match(/^\/api\/bots\/([\w-]+)\/cards\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const existing = store.messagesFor(bot.threadId).find((msg) => msg.id === m![2]);
      if (!existing?.card) return json(res, 404, { error: "no such card" });
      const body = await readBody(req);
      const patched = store.patchMessage(bot.threadId, m[2], {
        card: {
          ...existing.card,
          ...(body.answered !== undefined ? { answered: body.answered } : {}),
          ...(body.dismissed !== undefined ? { dismissed: body.dismissed } : {}),
        },
      });
      broadcast({ kind: "message.patch", threadId: bot.threadId, message: patched });
      return json(res, 200, { message: patched });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/messages$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      const text = String(body.text ?? "").trim();
      if (!text) return json(res, 400, { error: "text required" });
      // a fresh human message resets the delegation hop budget for this thread
      const turnBot = store.bot(m[1]);
      if (turnBot) delegationHops.delete(turnBot.threadId);
      await startTurn(m[1], text);
      return json(res, 202, { ok: true });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/respond$/);
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const body = await readBody(req);
      const response = validateResponse(body);
      const instance = registry.get(bot.modelSelection.instanceId);
      if (!instance) return json(res, 409, { error: "provider unavailable" });
      await instance.adapter.respondToRequest(bot.threadId, response.requestId, response.decision);
      return json(res, 200, { ok: true });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/interrupt$/);
    if (m && method === "POST") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const instance = registry.get(bot.modelSelection.instanceId);
      const active = activeTurns.get(bot.id);
      activeTurns.delete(bot.id);
      stopScreenPoller(bot.id);
      clearThreadLifecycle(bot.threadId);
      if (bot.busy) {
        store.patchBot(bot.id, { busy: false });
        broadcast({ kind: "bot", bot: store.bot(bot.id) });
      }
      await instance?.adapter.interruptTurn(bot.threadId, active?.turnId);
      return json(res, 200, { ok: true });
    }

    // identity handshake for the packaged app's port fallback: the forked
    // child proves it is OURS by echoing its pid (a stray dev server has
    // the same API shape but a different pid)
    if (method === "GET" && path === "/api/health") {
      return json(res, 200, { app: "magicbot", pid: process.pid, static: Boolean(STATIC_DIR) });
    }

    // ── provider instances (model picker) ──
    if (method === "GET" && path === "/api/instances") {
      return json(res, 200, { instances: await registry.describe() });
    }

    // ── app config (API keys — never echoed back, booleans only) ──
    if (method === "GET" && path === "/api/config") {
      return json(res, 200, configStatus());
    }
    if ((method === "PUT" || method === "PATCH") && path === "/api/config") {
      const body = await readBody(req);
      const patch: Record<string, object> = {};
      for (const key of ["xai", "composio", "box"] as const) {
        if (body[key] && typeof body[key] === "object") patch[key] = body[key];
      }
      if (!Object.keys(patch).length) return json(res, 400, { error: "nothing to save" });
      saveConfig(patch);
      Object.assign(cfg, loadConfig());
      await reloadProviders();
      const status = configStatus();
      broadcast({ kind: "config", ...status });
      return json(res, 200, status);
    }

    // ── connectors (Composio) ──
    if (method === "GET" && path === "/api/connectors/catalog") {
      const { cards, source } = await composio.listToolkits(cfg);
      return json(res, 200, { configured: Boolean(cfg.composio?.key), source, cards });
    }
    if (method === "GET" && path === "/api/connectors") {
      const services = (url.searchParams.get("services") ?? "").split(",").filter(Boolean);
      if (!cfg.composio?.key) return json(res, 200, { configured: false, services: {} });
      const status = await composio.connectionStatus(cfg, services.length ? services : composio.CURATED_SLUGS);
      return json(res, 200, { configured: true, services: status });
    }
    m = path.match(/^\/api\/connectors\/([\w-]+)\/authorize$/);
    if (m && method === "POST") return json(res, 200, await composio.authorizeService(cfg, m[1]));
    m = path.match(/^\/api\/connectors\/([\w-]+)$/);
    if (m && method === "DELETE") return json(res, 200, await composio.removeService(cfg, m[1]));

    // ── the bot's cloud computer (Box) ──
    m = path.match(/^\/api\/bots\/([\w-]+)\/computer$/);
    if (m && method === "GET") return json(res, 200, await box.boxStatus(cfg, m[1]));
    m = path.match(/^\/api\/bots\/([\w-]+)\/computer\/(provision|join|sleep|exec|screenshot)$/);
    if (m && method === "POST") {
      const botId = m[1];
      const bot = store.bot(botId);
      if (!bot) return json(res, 404, { error: "no such bot" });
      switch (m[2]) {
        case "provision":
          return json(res, 200, await box.provisionBox(cfg, botId, bot.name));
        case "join":
          return json(res, 200, await box.joinBox(cfg, botId));
        case "sleep":
          return json(res, 200, await box.sleepBox(cfg, botId));
        case "exec": {
          const body = await readBody(req);
          return json(res, 200, await box.execOnBox(cfg, botId, String(body.command ?? "")));
        }
        case "screenshot":
          return json(res, 200, await box.screenshotBox(cfg, botId));
      }
    }

    // packaged app: the server serves the built UI too (window → :8799 for
    // everything, no dev proxy to die). OMB_STATIC_DIR is set by Electron.
    if (method === "GET" && !path.startsWith("/api/") && STATIC_DIR) {
      const safe = path === "/" ? "/index.html" : path.replace(/\.\./g, "");
      const file = join(STATIC_DIR, safe);
      try {
        const data = readFileSync(file);
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
        return res.end(data);
      } catch {
        // SPA fallback
        try {
          const data = readFileSync(join(STATIC_DIR, "index.html"));
          res.writeHead(200, { "content-type": "text/html" });
          return res.end(data);
        } catch {
          /* fall through to 404 */
        }
      }
    }

    return json(res, 404, { error: `no route: ${method} ${path}` });
  } catch (e) {
    const status = (e as any)?.status ?? 500;
    return json(res, status, { error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`magicbot server on http://127.0.0.1:${PORT}`);
});

// AIOS routines organ: run due scheduled tasks by firing them as turns.
// startTurn throws when the bot is busy/unavailable → routines.runDue leaves
// the routine to retry on the next tick.
routines.startScheduler((botId, prompt) => startTurn(botId, prompt));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void registry.disposeAll().finally(() => process.exit(0));
  });
}
