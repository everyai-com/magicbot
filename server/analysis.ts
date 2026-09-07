type AppConfig = { analysis?: {
  provider?: AnalysisProvider; model?: string; language?: string;
  keys?: Partial<Record<AnalysisProvider, string>>;
  cloudflareAccountId?: string; ollamaBaseUrl?: string;
} };

export const ANALYSIS_PROVIDERS = [
  "gemini",
  "chatgpt",
  "perplexity",
  "grok",
  "deepseek",
  "cloudflare",
  "claude",
  "nvidia",
  "mistral",
  "ollama",
] as const;

export type AnalysisProvider = (typeof ANALYSIS_PROVIDERS)[number];

const DEFAULT_MODELS: Record<AnalysisProvider, string> = {
  gemini: "gemini-1.5-flash",
  chatgpt: "gpt-4o-mini",
  perplexity: "sonar-pro",
  grok: "grok-3-mini",
  deepseek: "deepseek-chat",
  cloudflare: "@cf/meta/llama-3.1-8b-instruct",
  claude: "claude-3-5-sonnet-latest",
  nvidia: "meta/llama-3.1-70b-instruct",
  mistral: "mistral-large-latest",
  ollama: "llama3.1",
};

function providerFrom(value: unknown, fallback: AnalysisProvider): AnalysisProvider {
  return ANALYSIS_PROVIDERS.includes(value as AnalysisProvider) ? value as AnalysisProvider : fallback;
}

function jsonHeaders(key?: string): Record<string, string> {
  return key ? { "content-type": "application/json", authorization: `Bearer ${key}` } : { "content-type": "application/json" };
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { text };
  }
}

function textAt(value: unknown, path: Array<string | number>): string {
  let cursor: unknown = value;
  for (const part of path) {
    if (typeof part === "number") cursor = Array.isArray(cursor) ? cursor[part] : undefined;
    else cursor = cursor && typeof cursor === "object" ? (cursor as Record<string, unknown>)[part] : undefined;
  }
  return typeof cursor === "string" ? cursor.trim() : "";
}

async function checkedFetch(url: string, init: RequestInit, provider: AnalysisProvider): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(60_000) });
  const body = await parseResponse(response);
  if (!response.ok) {
    const message =
      textAt(body, ["error", "message"]) ||
      textAt(body, ["message"]) ||
      `${provider} analysis request failed (${response.status})`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return body;
}

function promptMessages(prompt: string) {
  return [
    {
      role: "system",
      content: "You generate clear, production-ready system prompts for AI voice agents. Return only the final prompt.",
    },
    { role: "user", content: prompt },
  ];
}

function languageInstruction(language?: string): string {
  const chosen = language?.trim();
  return chosen ? `Respond in ${chosen}. Keep every user-facing answer, generated prompt, summary, and task assignment in ${chosen} unless the user explicitly asks for another language.` : "";
}

export async function generateAnalysisText(
  cfg: AppConfig,
  input: { prompt: string; provider?: unknown; model?: unknown; userKey?: unknown },
): Promise<{ provider: AnalysisProvider; model: string; text: string }> {
  const provider = providerFrom(input.provider, cfg.analysis?.provider ?? "gemini");
  const model =
    (typeof input.model === "string" && input.model.trim()) ||
    cfg.analysis?.model?.trim() ||
    DEFAULT_MODELS[provider];
  const key =
    (typeof input.userKey === "string" && input.userKey.trim()) ||
    (provider === "ollama" ? "" : cfg.analysis?.keys?.[provider]?.trim() ?? "");
  const rawPrompt = input.prompt.trim();
  if (!rawPrompt) throw Object.assign(new Error("prompt is required"), { status: 400 });
  const prompt = [languageInstruction(cfg.analysis?.language), rawPrompt].filter(Boolean).join("\n\n");
  if (provider !== "ollama" && !key) throw Object.assign(new Error(`${provider} API key is not configured`), { status: 400 });

  if (provider === "gemini") {
    const body = await checkedFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
      },
      provider,
    );
    return { provider, model, text: textAt(body, ["candidates", 0, "content", "parts", 0, "text"]) };
  }

  if (provider === "chatgpt") {
    const body = await checkedFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: jsonHeaders(key),
      body: JSON.stringify({ model, input: prompt }),
    }, provider);
    return { provider, model, text: textAt(body, ["output_text"]) || textAt(body, ["output", 0, "content", 0, "text"]) };
  }

  if (provider === "claude") {
    const body = await checkedFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { ...jsonHeaders(key), "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
    }, provider);
    return { provider, model, text: textAt(body, ["content", 0, "text"]) };
  }

  if (provider === "cloudflare") {
    const accountId = cfg.analysis?.cloudflareAccountId?.trim();
    if (!accountId) throw Object.assign(new Error("Cloudflare account ID is not configured"), { status: 400 });
    const body = await checkedFetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`,
      {
        method: "POST",
        headers: jsonHeaders(key),
        body: JSON.stringify({ messages: promptMessages(prompt) }),
      },
      provider,
    );
    return { provider, model, text: textAt(body, ["result", "response"]) || textAt(body, ["result", "text"]) };
  }

  if (provider === "ollama") {
    const base = (cfg.analysis?.ollamaBaseUrl?.trim() || "http://127.0.0.1:11434").replace(/\/+$/, "");
    const body = await checkedFetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages: promptMessages(prompt), stream: false }),
    }, provider);
    return { provider, model, text: textAt(body, ["message", "content"]) || textAt(body, ["response"]) };
  }

  const endpoints: Record<Exclude<AnalysisProvider, "gemini" | "chatgpt" | "claude" | "cloudflare" | "ollama">, string> = {
    perplexity: "https://api.perplexity.ai/chat/completions",
    grok: "https://api.x.ai/v1/chat/completions",
    deepseek: "https://api.deepseek.com/chat/completions",
    nvidia: "https://integrate.api.nvidia.com/v1/chat/completions",
    mistral: "https://api.mistral.ai/v1/chat/completions",
  };
  const body = await checkedFetch(endpoints[provider], {
    method: "POST",
    headers: jsonHeaders(key),
    body: JSON.stringify({ model, messages: promptMessages(prompt), temperature: 0.4 }),
  }, provider);
  return { provider, model, text: textAt(body, ["choices", 0, "message", "content"]) };
}
