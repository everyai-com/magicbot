type AppConfig = { ultravox?: { apiKey?: string } };
import { parseCustomTool } from "../../../shared/custom-tool.js";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  return JSON.stringify(value) ?? "undefined";
}
const isDeepStrictEqual = (a: unknown, b: unknown) => canonical(a) === canonical(b);

const API = "https://api.ultravox.ai/api";

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

function apiKey(cfg: AppConfig): string { return cfg.ultravox?.apiKey || ""; }
function message(status: number, body: unknown): string {
  const text =
    body && typeof body === "object"
      ? String((body as { error?: unknown; detail?: unknown; message?: unknown }).error ?? (body as { detail?: unknown }).detail ?? (body as { message?: unknown }).message ?? "")
      : typeof body === "string"
        ? body
        : "";
  return text || `Ultravox returned ${status}`;
}

async function ultravoxJson<T>(
  cfg: AppConfig,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const key = apiKey(cfg);
  if (!key) throw Object.assign(new Error("Ultravox API key is not configured in the backend"), { status: 409 });
  const res = await fetch(`${API}${path}`, {
    signal: AbortSignal.timeout(25_000),
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

export async function registerCustomTool(cfg: AppConfig, agentId: string, entry: string, previousEntry?: string, remove = false): Promise<string> {
  const tool = parseCustomTool(entry);
  const previous = previousEntry ? parseCustomTool(previousEntry) : tool;
  const agentPath = `/agents/${encodeURIComponent(agentId)}`;
  const agent = await ultravoxJson<{ callTemplate: Record<string, unknown> }>(cfg, agentPath);
  if (!agent.callTemplate) throw new Error("Ultravox agent has no call template.");
  const definition = {
    modelToolName: tool.name, description: tool.description,
    timeout: tool.timeout,
    http: { baseUrlPattern: tool.http_url, httpMethod: tool.http_method },
    dynamicParameters: tool.parameters.map(({ paramType: _kind, location, ...parameter }) => ({ ...parameter, location: `PARAMETER_LOCATION_${location.toUpperCase()}` })),
  };
  let toolId = "";
  let path = "/tools";
  for (let page = 0; path && page < 100; page++) {
    const list = await ultravoxJson<{ results: Array<{ toolId: string; name: string; definition: typeof definition }>; next?: string }>(cfg, path);
    const existing = list.results.find((candidate) => ((candidate.name === previous.name && candidate.definition.http?.baseUrlPattern === previous.http_url && candidate.definition.http?.httpMethod === previous.http_method) || (candidate.name === tool.name && candidate.definition.http?.baseUrlPattern === tool.http_url && candidate.definition.http?.httpMethod === tool.http_method)));
    if (existing) {
      if (!previousEntry && !remove && (!isDeepStrictEqual(existing.definition.dynamicParameters ?? [], definition.dynamicParameters) || (existing.definition.description ?? "") !== definition.description || (existing.definition.timeout ?? "20s") !== definition.timeout)) {
        throw new Error("An Ultravox tool with this name and URL has different settings. Choose a unique tool name.");
      }
      toolId = existing.toolId; break;
    }
    path = list.next ? new URL(list.next, API).pathname.replace(/^\/api/, "") + new URL(list.next, API).search : "";
    if (page === 99 && path) throw new Error("Too many Ultravox tools to safely check for duplicates.");
  }
  if (toolId && previousEntry && !remove) {
    await ultravoxJson(cfg, `/tools/${encodeURIComponent(toolId)}`, { method: "PUT", body: { name: tool.name, definition } });
  }
  if (!toolId && !remove) {
    const created = await ultravoxJson<{ toolId: string }>(cfg, "/tools", { method: "POST", body: { name: tool.name, definition } });
    toolId = created.toolId;
    if (!toolId) throw new Error("Ultravox did not return a tool ID.");
  }
  const selected = Array.isArray(agent.callTemplate.selectedTools) ? agent.callTemplate.selectedTools as Array<Record<string, unknown>> : [];
  const retained = selected.filter((item) => item.toolId !== toolId && (item.temporaryTool as { modelToolName?: string } | undefined)?.modelToolName !== tool.name && (item.temporaryTool as { modelToolName?: string } | undefined)?.modelToolName !== previous.name);
  await ultravoxJson(cfg, agentPath, { method: "PATCH", body: { callTemplate: { ...agent.callTemplate, selectedTools: remove ? retained : [...retained, { toolId }] } } });
  if (remove && toolId) await ultravoxJson(cfg, `/tools/${encodeURIComponent(toolId)}`, { method: "DELETE" });
  return toolId;
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

