import type { AppConfig } from "./config.ts";
import { existsSync, readFileSync } from "node:fs";

const API = "https://api.ultravox.ai/api";
const MAX_PAGES = 8;

const SERVER_ENV_FILES = [
  ".env.local",
  ".env",
  "/Users/vamsireddy/Desktop/untitled folder/magicteams 1/magicteamsai/.env.local",
  "/Users/vamsireddy/Desktop/untitled folder/magicteams 1/magicteamsai/.env",
];

let cachedEnvApiKey: string | null = null;

export interface UltravoxVoice {
  voiceId: string;
  name: string;
  languageLabel?: string;
  primaryLanguage?: string;
  provider?: string;
  previewUrl?: string;
}

export interface UltravoxKnowledgeInput {
  name: string;
  description?: string | null;
  content?: string | null;
  fileName?: string | null;
  websiteUrl?: string | null;
}

export interface UltravoxKnowledgeResult {
  corpusId: string;
  sourceId?: string;
  documentId?: string;
}

export interface UltravoxAgentCallInput {
  agentId: string;
  voice?: string;
  maxDurationSeconds?: number;
  metadata?: Record<string, string>;
}

export interface UltravoxAgentCallResult {
  callId: string | null;
  joinUrl: string;
  clientVersion?: string | null;
}

function apiKey(cfg: AppConfig): string {
  return cfg.ultravox?.apiKey || process.env.ULTRAVOX_API_KEY || process.env.VITE_ULTRAVOX_API_KEY || envFileApiKey();
}

function envFileApiKey(): string {
  if (cachedEnvApiKey !== null) return cachedEnvApiKey;
  cachedEnvApiKey = "";
  for (const path of SERVER_ENV_FILES) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const match = text.match(/^(?:ULTRAVOX_API_KEY|VITE_ULTRAVOX_API_KEY)\s*=\s*(.+)$/m);
    const value = match?.[1]?.trim().replace(/^['"]|['"]$/g, "");
    if (value) {
      cachedEnvApiKey = value;
      break;
    }
  }
  return cachedEnvApiKey;
}

function platformBaseUrl(): string {
  return (
    process.env.MAGICTEAMS_API_URL ||
    process.env.MAGICTEAMS_PLATFORM_URL ||
    process.env.VITE_API_URL ||
    "https://app.magicteams.ai"
  ).replace(/\/+$/, "");
}

function message(status: number, body: unknown): string {
  const text =
    body && typeof body === "object"
      ? String((body as { error?: unknown; detail?: unknown; message?: unknown }).error ?? (body as { detail?: unknown }).detail ?? (body as { message?: unknown }).message ?? "")
      : typeof body === "string"
        ? body
        : "";
  return text || `Ultravox returned ${status}`;
}

function isAudioMime(value: string | null): boolean {
  return (value ?? "").toLowerCase().startsWith("audio/");
}

function audioMimeFromUrl(value: string): string | null {
  const path = new URL(value).pathname.toLowerCase();
  if (path.endsWith(".mp3")) return "audio/mpeg";
  if (path.endsWith(".wav")) return "audio/wav";
  if (path.endsWith(".m4a")) return "audio/mp4";
  if (path.endsWith(".ogg")) return "audio/ogg";
  if (path.endsWith(".webm")) return "audio/webm";
  return null;
}

export function configured(cfg: AppConfig): boolean {
  return Boolean(apiKey(cfg));
}

function demoCallDataMessages(): Record<string, boolean> {
  return {
    state: true,
    transcript: true,
    callStarted: true,
    callEvent: true,
    toolUsed: true,
    invokingTool: true,
    userStartedSpeaking: true,
    userStoppedSpeaking: true,
  };
}

export async function createAgentCall(cfg: AppConfig, input: UltravoxAgentCallInput): Promise<UltravoxAgentCallResult> {
  const agentId = input.agentId.trim();
  if (!agentId) throw Object.assign(new Error("agentId is required"), { status: 400 });

  const body: Record<string, unknown> = {
    medium: { webRtc: { dataMessages: demoCallDataMessages() } },
    joinTimeout: "30s",
    metadata: input.metadata ?? {},
  };
  const voice = input.voice?.trim();
  if (voice) body.voice = voice;
  if (input.maxDurationSeconds && Number.isFinite(input.maxDurationSeconds)) {
    body.maxDuration = `${Math.max(1, Math.floor(input.maxDurationSeconds))}s`;
  }

  const call = await ultravoxJson<{ callId?: unknown; joinUrl?: unknown; clientVersion?: unknown }>(
    cfg,
    `/agents/${encodeURIComponent(agentId)}/calls`,
    { method: "POST", body },
  );
  const joinUrl = typeof call.joinUrl === "string" ? call.joinUrl : "";
  if (!joinUrl) throw Object.assign(new Error("Ultravox did not return a join URL"), { status: 502 });
  return {
    callId: typeof call.callId === "string" ? call.callId : null,
    joinUrl,
    clientVersion: typeof call.clientVersion === "string" ? call.clientVersion : null,
  };
}

async function ultravoxJson<T>(
  cfg: AppConfig,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const key = apiKey(cfg);
  if (!key) throw Object.assign(new Error("Ultravox API key is not configured in the backend"), { status: 409 });
  const res = await fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "X-API-Key": key,
      "Content-Type": "application/json",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const contentType = res.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await res.json().catch(() => ({})) : await res.text().catch(() => "");
  if (!res.ok) throw Object.assign(new Error(message(res.status, body)), { status: res.status });
  return body as T;
}

async function uploadCorpusDocument(
  cfg: AppConfig,
  corpusId: string,
  fileName: string,
  content: string,
): Promise<string> {
  const upload = await ultravoxJson<{ documentId?: unknown; presignedUrl?: unknown }>(
    cfg,
    `/corpora/${encodeURIComponent(corpusId)}/uploads`,
    {
      method: "POST",
      body: {
        mimeType: "text/plain",
        fileName: fileName.replace(/[\u0000-\u001f/\\]/g, "_").slice(0, 255) || "knowledge.txt",
      },
    },
  );
  const documentId = typeof upload.documentId === "string" ? upload.documentId : "";
  const presignedUrl = typeof upload.presignedUrl === "string" ? upload.presignedUrl : "";
  if (!documentId || !presignedUrl) throw Object.assign(new Error("Ultravox did not return a document upload URL"), { status: 502 });
  const put = await fetch(presignedUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: content,
  });
  if (!put.ok) {
    const body = await put.text().catch(() => "");
    throw Object.assign(new Error(body || `Ultravox document upload failed (${put.status})`), { status: put.status });
  }
  return documentId;
}

export async function createKnowledgeCorpus(cfg: AppConfig, input: UltravoxKnowledgeInput): Promise<UltravoxKnowledgeResult> {
  const corpus = await ultravoxJson<{ corpusId?: unknown }>(cfg, "/corpora", {
    method: "POST",
    body: {
      name: input.name,
      description: input.description ?? "",
    },
  });
  const corpusId = typeof corpus.corpusId === "string" ? corpus.corpusId : "";
  if (!corpusId) throw Object.assign(new Error("Ultravox did not return a corpus id"), { status: 502 });

  const sourceBody: Record<string, unknown> = {
    name: input.name,
    description: input.description ?? "",
  };
  let documentId = "";
  const content = input.content?.trim();
  if (input.websiteUrl?.trim() && !content) {
    sourceBody.crawl = {
      startUrls: [input.websiteUrl.trim()],
      maxDepth: 1,
      maxDocuments: 20,
    };
  } else {
    if (!content) throw Object.assign(new Error("No readable file content was available for Ultravox"), { status: 400 });
    documentId = await uploadCorpusDocument(cfg, corpusId, input.fileName || `${input.name}.txt`, content);
    sourceBody.upload = { documentIds: [documentId] };
  }
  const source = await ultravoxJson<{ sourceId?: unknown }>(
    cfg,
    `/corpora/${encodeURIComponent(corpusId)}/sources`,
    {
      method: "POST",
      body: sourceBody,
    },
  );
  const sourceId = typeof source.sourceId === "string" ? source.sourceId : undefined;
  return { corpusId, sourceId, documentId: documentId || undefined };
}

export async function deleteKnowledgeCorpus(cfg: AppConfig, corpusId: string): Promise<void> {
  if (!corpusId.trim()) return;
  await ultravoxJson(cfg, `/corpora/${encodeURIComponent(corpusId)}`, { method: "DELETE" });
}

function normalizeVoices(value: unknown): UltravoxVoice[] {
  const rows =
    value && typeof value === "object" && Array.isArray((value as { voices?: unknown }).voices)
      ? (value as { voices: unknown[] }).voices
      : value && typeof value === "object" && Array.isArray((value as { results?: unknown }).results)
        ? (value as { results: unknown[] }).results
        : [];
  const voices: UltravoxVoice[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const voiceId = typeof record.voiceId === "string"
      ? record.voiceId
      : typeof record.voice_id === "string"
        ? record.voice_id
        : typeof record.id === "string"
          ? record.id
          : "";
    const name = typeof record.name === "string"
      ? record.name
      : typeof record.label === "string"
        ? record.label
        : "";
    if (!voiceId || !name) continue;
    voices.push({
      voiceId,
      name,
      languageLabel: typeof record.languageLabel === "string" ? record.languageLabel : typeof record.language === "string" ? record.language : undefined,
      primaryLanguage: typeof record.primaryLanguage === "string" ? record.primaryLanguage : undefined,
      provider: typeof record.provider === "string" ? record.provider : undefined,
      previewUrl: firstString(record.previewUrl, record.preview_url, record.previewMp3Url, record.previewWavUrl, record.audioPreviewUrl, record.sampleUrl),
    });
  }
  return voices;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

async function listPlatformVoices(input: { search?: string; primaryLanguage?: string }, authorization?: string): Promise<UltravoxVoice[]> {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization) headers.set("authorization", authorization);
  const attempts: Array<[method: string, path: string, body?: string]> = [
    ["GET", "/api/ultravox/voices"],
    ["POST", "/api/voices/platform", "{}"],
  ];
  let body: unknown = {};
  let lastError = "";
  for (const [method, path, requestBody] of attempts) {
    const res = await fetch(`${platformBaseUrl()}${path}`, { method, headers, body: requestBody });
    const contentType = res.headers.get("content-type") ?? "";
    body = contentType.includes("application/json") ? await res.json().catch(() => ({})) : await res.text().catch(() => "");
    if (res.ok && contentType.includes("application/json")) break;
    lastError = message(res.status, body);
    body = {};
  }
  let voices = normalizeVoices(body);
  if (voices.length === 0 && lastError) throw new Error(lastError);
  const search = input.search?.trim().toLowerCase();
  if (search) {
    voices = voices.filter((voice) =>
      voice.name.toLowerCase().includes(search) ||
      voice.voiceId.toLowerCase().includes(search) ||
      (voice.languageLabel ?? "").toLowerCase().includes(search) ||
      (voice.primaryLanguage ?? "").toLowerCase().includes(search) ||
      (voice.provider ?? "").toLowerCase().includes(search),
    );
  }
  const language = input.primaryLanguage?.trim().toLowerCase();
  if (language) {
    voices = voices.filter((voice) =>
      (voice.primaryLanguage ?? "").toLowerCase() === language ||
      (voice.languageLabel ?? "").toLowerCase() === language,
    );
  }
  return voices;
}

export async function listVoices(
  cfg: AppConfig,
  input: { search?: string; primaryLanguage?: string } = {},
  authorization?: string,
): Promise<UltravoxVoice[]> {
  const key = apiKey(cfg);
  if (!key) {
    return listPlatformVoices(input, authorization);
  }

  const voices: UltravoxVoice[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${API}/voices`);
    url.searchParams.set("pageSize", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    if (input.search?.trim()) url.searchParams.set("search", input.search.trim());
    if (input.primaryLanguage?.trim()) url.searchParams.set("primaryLanguage", input.primaryLanguage.trim());

    const res = await fetch(url, { headers: { "X-API-Key": key } });
    const contentType = res.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json") ? await res.json().catch(() => ({})) : await res.text().catch(() => "");
    if (!res.ok) throw new Error(message(res.status, body));
    voices.push(...normalizeVoices(body));
    const next = body && typeof body === "object" ? (body as { next?: unknown }).next : null;
    if (typeof next !== "string" || !next) break;
    const nextUrl = new URL(next);
    cursor = nextUrl.searchParams.get("cursor") ?? "";
    if (!cursor) break;
  }
  return voices;
}

async function previewPlatformVoice(voiceId: string, authorization?: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  const direct = await fetch(`${platformBaseUrl()}/api/ultravox/voices/${encodeURIComponent(voiceId)}/preview`, { headers });
  if (direct.ok && isAudioMime(direct.headers.get("content-type"))) {
    return {
      bytes: await direct.arrayBuffer(),
      mime: direct.headers.get("content-type") || "audio/wav",
    };
  }

  headers.set("content-type", "application/json");
  const legacy = await fetch(`${platformBaseUrl()}/api/voices/preview`, {
    method: "POST",
    headers,
    body: JSON.stringify({ provider: "ultravox", voiceId }),
  });
  if (!legacy.ok) {
    const contentType = legacy.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json") ? await legacy.json().catch(() => ({})) : await legacy.text().catch(() => "");
    throw Object.assign(new Error(message(legacy.status, body)), { status: legacy.status });
  }
  const contentType = legacy.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await legacy.json().catch(() => ({})) as { contentType?: unknown; audioBase64?: unknown };
    if (typeof body.audioBase64 === "string" && body.audioBase64) {
      const binary = Buffer.from(body.audioBase64, "base64");
      return {
        bytes: binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength),
        mime: typeof body.contentType === "string" ? body.contentType : "audio/mpeg",
      };
    }
  }
  if (!contentType.includes("application/json") && !isAudioMime(contentType)) {
    throw Object.assign(new Error("Voice preview audio is not available from the backend"), { status: 502 });
  }
  return {
    bytes: await legacy.arrayBuffer(),
    mime: legacy.headers.get("content-type") || "audio/wav",
  };
}

export async function previewVoice(cfg: AppConfig, voiceId: string, authorization?: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const key = apiKey(cfg);
  if (!/^[\w-]+$/.test(voiceId)) throw Object.assign(new Error("voiceId must be a valid voice id"), { status: 400 });
  if (!key) return previewPlatformVoice(voiceId, authorization);
  const metadataRes = await fetch(`${API}/voices/${encodeURIComponent(voiceId)}`, {
    headers: { "X-API-Key": key },
  });
  const metadataContentType = metadataRes.headers.get("content-type") ?? "";
  const metadata = metadataContentType.includes("application/json")
    ? await metadataRes.json().catch(() => ({}))
    : await metadataRes.text().catch(() => "");
  if (!metadataRes.ok) {
    throw Object.assign(new Error(message(metadataRes.status, metadata)), { status: metadataRes.status });
  }
  const previewUrl = metadata && typeof metadata === "object"
    ? firstString(
      (metadata as Record<string, unknown>).previewUrl,
      (metadata as Record<string, unknown>).preview_url,
      (metadata as Record<string, unknown>).previewMp3Url,
      (metadata as Record<string, unknown>).previewWavUrl,
      (metadata as Record<string, unknown>).audioPreviewUrl,
      (metadata as Record<string, unknown>).sampleUrl,
    )
    : undefined;
  if (!previewUrl) {
    throw Object.assign(new Error("Ultravox did not return a preview URL for this voice"), { status: 502 });
  }
  const res = await fetch(previewUrl, { headers: { "X-API-Key": key } });
  if (!res.ok) {
    const contentType = res.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json") ? await res.json().catch(() => ({})) : await res.text().catch(() => "");
    throw Object.assign(new Error(message(res.status, body)), { status: res.status });
  }
  const contentType = res.headers.get("content-type") ?? "";
  const urlMime = audioMimeFromUrl(previewUrl);
  if (!isAudioMime(contentType) && !urlMime) {
    throw Object.assign(new Error("Ultravox preview URL did not return playable audio"), { status: 502 });
  }
  return {
    bytes: await res.arrayBuffer(),
    mime: isAudioMime(contentType) ? contentType : urlMime || "audio/mpeg",
  };
}
