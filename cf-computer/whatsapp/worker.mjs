import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import makeWASocket, {
  DisconnectReason,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";

const root = process.argv[2];
if (!root) throw new Error("state directory required");

const authDir = path.join(root, "auth");
const commandsDir = path.join(root, "commands");
const eventsFile = path.join(root, "events.jsonl");
const stateFile = path.join(root, "state.json");
const logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL ?? "warn" });
const seen = new Set();
let socket;
let stopping = false;

await fs.mkdir(authDir, { recursive: true, mode: 0o700 });
await fs.mkdir(commandsDir, { recursive: true, mode: 0o700 });

async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await fs.rename(temporary, file);
}

async function state(value) {
  await atomicJson(stateFile, { updatedAt: Date.now(), ...value });
}

async function emit(type, payload = {}) {
  const event = { cursor: crypto.randomUUID(), type, at: Date.now(), ...payload };
  await fs.appendFile(eventsFile, `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

function jid(value) {
  return typeof value === "string" ? value : "";
}

function messageText(message) {
  if (!message) return "";
  const content = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message;
  return String(
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    content.buttonsResponseMessage?.selectedDisplayText ??
    content.listResponseMessage?.title ??
    "",
  ).slice(0, 50_000);
}

async function canonicalJid(primary, alternate = "") {
  const value = jid(primary);
  const alt = jid(alternate);
  if (!value.endsWith("@lid")) return value;
  if (alt.endsWith("@s.whatsapp.net")) return alt;
  try {
    return jid(await socket?.signalRepository?.lidMapping?.getPNForLID(value)) || value;
  } catch {
    return value;
  }
}

async function normalizeMessage(item) {
  const rawChatJid = jid(item.key?.remoteJid);
  const chatJid = await canonicalJid(rawChatJid, item.key?.remoteJidAlt);
  const rawSenderJid = item.key?.fromMe
    ? jid(socket?.user?.id)
    : jid(item.key?.participant ?? item.participant ?? rawChatJid);
  const senderJid = await canonicalJid(rawSenderJid, item.key?.participantAlt ?? item.participantAlt);
  return {
    id: String(item.key?.id ?? crypto.randomUUID()),
    chatJid,
    senderJid,
    rawChatJid,
    rawSenderJid,
    fromMe: Boolean(item.key?.fromMe),
    participantJid: jid(item.key?.participant),
    text: messageText(item.message),
    timestamp: Number(item.messageTimestamp ?? Date.now() / 1000) * 1000,
    pushName: String(item.pushName ?? "").slice(0, 160),
    messageType: item.message ? Object.keys(item.message)[0] ?? "unknown" : "unknown",
  };
}

async function emitMessages(messages, source) {
  for (const item of messages ?? []) {
    const normalized = await normalizeMessage(item);
    if (!normalized.chatJid || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    if (seen.size > 20_000) seen.delete(seen.values().next().value);
    await emit("message", { source, message: normalized });
  }
}

async function connect() {
  const { state: auth, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestWaWebVersion();
  socket = makeWASocket({
    version,
    auth: {
      creds: auth.creds,
      keys: makeCacheableSignalKeyStore(auth.keys, logger),
    },
    logger,
    browser: ["MagicTeams", "Chrome", "1.0.0"],
    syncFullHistory: true,
    shouldSyncHistoryMessage: () => true,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });

  socket.ev.on("creds.update", saveCreds);
  socket.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      await state({ status: "pairing", qr });
      await emit("qr", { qr });
    }
    if (connection === "open") {
      const me = { jid: jid(socket.user?.id), name: String(socket.user?.name ?? "") };
      await state({ status: "connected", me });
      await emit("connected", { me });
    }
    if (connection === "close" && !stopping) {
      const statusCode = lastDisconnect?.error?.output?.statusCode ?? lastDisconnect?.error?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      await state({ status: loggedOut ? "disconnected" : "reconnecting", reason: String(statusCode ?? "unknown") });
      await emit("disconnected", { loggedOut, reason: String(statusCode ?? "unknown") });
      if (!loggedOut) setTimeout(() => void connect().catch(fatal), 2_000);
    }
  });
  socket.ev.on("contacts.upsert", async (contacts) => {
    for (const contact of contacts) {
      const rawJid = jid(contact.id);
      await emit("contact", { contact: {
        jid: await canonicalJid(rawJid, contact.phoneNumber), rawJid,
        name: String(contact.name ?? contact.notify ?? contact.verifiedName ?? "").slice(0, 160),
      } });
    }
  });
  socket.ev.on("contacts.update", async (contacts) => {
    for (const contact of contacts) {
      const rawJid = jid(contact.id);
      await emit("contact", { contact: {
        jid: await canonicalJid(rawJid, contact.phoneNumber), rawJid,
        name: String(contact.notify ?? "").slice(0, 160),
      } });
    }
  });
  socket.ev.on("chats.upsert", async (chats) => {
    for (const chat of chats) await emit("chat", { chat: {
      jid: jid(chat.id), name: String(chat.name ?? "").slice(0, 160), unreadCount: Number(chat.unreadCount ?? 0),
      conversationTimestamp: Number(chat.conversationTimestamp ?? 0) * 1000,
    } });
  });
  socket.ev.on("chats.update", async (chats) => {
    for (const chat of chats) await emit("chat", { chat: {
      jid: jid(chat.id), name: String(chat.name ?? "").slice(0, 160), unreadCount: Number(chat.unreadCount ?? 0),
      conversationTimestamp: Number(chat.conversationTimestamp ?? 0) * 1000,
    } });
  });
  socket.ev.on("messaging-history.set", async ({ chats, contacts, messages, isLatest }) => {
    for (const contact of contacts ?? []) {
      const rawJid = jid(contact.id);
      await emit("contact", { contact: {
        jid: await canonicalJid(rawJid, contact.phoneNumber), rawJid,
        name: String(contact.name ?? contact.notify ?? contact.verifiedName ?? "").slice(0, 160),
      } });
    }
    for (const chat of chats ?? []) await emit("chat", { chat: {
      jid: jid(chat.id), name: String(chat.name ?? "").slice(0, 160), unreadCount: Number(chat.unreadCount ?? 0),
      conversationTimestamp: Number(chat.conversationTimestamp ?? 0) * 1000,
    } });
    await emitMessages(messages, "history");
    await emit("history_complete", { isLatest: Boolean(isLatest), messages: messages?.length ?? 0 });
  });
  socket.ev.on("messages.upsert", async ({ messages, type }) => emitMessages(messages, type === "notify" ? "live" : type));
  socket.ev.on("messages.update", async (updates) => {
    for (const update of updates) await emit("receipt", { id: String(update.key?.id ?? ""), chatJid: jid(update.key?.remoteJid), update: update.update ?? {} });
  });
  socket.ev.on("groups.upsert", async (groups) => {
    for (const group of groups) await emit("group", { group: {
      jid: jid(group.id), subject: String(group.subject ?? "").slice(0, 160), participants: (group.participants ?? []).map((p) => jid(p.id)).filter(Boolean),
    } });
  });
}

async function processCommands() {
  const names = (await fs.readdir(commandsDir).catch(() => [])).filter((name) => name.endsWith(".json")).sort();
  for (const name of names) {
    const file = path.join(commandsDir, name);
    try {
      const command = JSON.parse(await fs.readFile(file, "utf8"));
      if (command.type === "send") {
        if (!socket?.user) throw new Error("WhatsApp is not connected");
        const target = jid(command.chatJid);
        const text = String(command.text ?? "").trim();
        if (!target || !text || text.length > 10_000) throw new Error("invalid send command");
        const sent = await socket.sendMessage(target, { text });
        await emit("sent", { commandId: command.id, chatJid: target, messageId: String(sent?.key?.id ?? "") });
      } else if (command.type === "logout") {
        stopping = true;
        await socket?.logout();
        await fs.rm(authDir, { recursive: true, force: true });
        await fs.mkdir(authDir, { recursive: true, mode: 0o700 });
        await state({ status: "disconnected" });
        await emit("logged_out");
        process.exit(0);
      } else if (command.type === "stop") {
        stopping = true;
        socket?.end(undefined);
        await state({ status: "stopped" });
        process.exit(0);
      }
    } catch (error) {
      await emit("command_error", { commandId: name.replace(/\.json$/, ""), error: error instanceof Error ? error.message : String(error) });
    } finally {
      await fs.rm(file, { force: true });
    }
  }
}

async function fatal(error) {
  logger.error(error);
  await state({ status: "error", error: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
  await emit("error", { error: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
}

process.on("SIGTERM", () => { stopping = true; socket?.end(undefined); process.exit(0); });
await state({ status: "starting" });
await connect().catch(fatal);
setInterval(() => void processCommands().catch(fatal), 500);
await processCommands();
