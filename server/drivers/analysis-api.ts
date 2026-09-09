import { connectApiTools, type ApiTool } from "./api-tools.ts";
import { completeWithTools } from "./api-tool-loop.ts";
import type {
  DriverCreateInput,
  ModelCatalog,
  ProviderDriver,
  ProviderInstance,
  ProviderSnapshot,
  RuntimeEvent,
  RuntimeEventListener,
  SendTurnInput,
} from "../contracts.ts";
import { newEventId, newId } from "../contracts.ts";
import { appendNative } from "./native.ts";

const DRIVER_KIND = "analysis-api";

const PROVIDERS = [
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

type AnalysisProvider = (typeof PROVIDERS)[number];

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

const LABELS: Record<AnalysisProvider, string> = {
  gemini: "Gemini API",
  chatgpt: "OpenAI API",
  perplexity: "Perplexity API",
  grok: "xAI API",
  deepseek: "DeepSeek API",
  cloudflare: "Cloudflare AI",
  claude: "Anthropic API",
  nvidia: "NVIDIA NIM",
  mistral: "Mistral API",
  ollama: "Ollama",
};

export interface AnalysisApiConfig {
  provider: AnalysisProvider;
  model: string;
  language: string;
  cloudflareAccountId: string;
  ollamaBaseUrl: string;
}

function providerFrom(value: unknown): AnalysisProvider {
  return PROVIDERS.includes(value as AnalysisProvider) ? value as AnalysisProvider : "gemini";
}

function decodeConfig(raw: unknown): AnalysisApiConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  const provider = providerFrom(o.provider);
  const model = typeof o.model === "string" && o.model.trim() ? o.model.trim() : DEFAULT_MODELS[provider];
  return {
    provider,
    model,
    language: typeof o.language === "string" ? o.language.trim() : "",
    cloudflareAccountId: typeof o.cloudflareAccountId === "string" ? o.cloudflareAccountId.trim() : "",
    ollamaBaseUrl: typeof o.ollamaBaseUrl === "string" ? o.ollamaBaseUrl.trim() : "",
  };
}

function languageSystemPrompt(language: string): string {
  const chosen = language.trim();
  return chosen ? `Respond in ${chosen}. Keep tool/task summaries, teammate messages, and user-facing output in ${chosen} unless the user explicitly asks for another language.` : "";
}

function apiKey(provider: AnalysisProvider, env: Record<string, string | undefined>): string {
  const keyByProvider: Record<Exclude<AnalysisProvider, "ollama">, string> = {
    gemini: "GEMINI_API_KEY",
    chatgpt: "OPENAI_API_KEY",
    perplexity: "PERPLEXITY_API_KEY",
    grok: "XAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    cloudflare: "CLOUDFLARE_API_TOKEN",
    claude: "ANTHROPIC_API_KEY",
    nvidia: "NVIDIA_API_KEY",
    mistral: "MISTRAL_API_KEY",
  };
  if (provider === "ollama") return "";
  const envKey = keyByProvider[provider];
  return env[envKey] ?? process.env[envKey] ?? "";
}

async function readJson(response: Response): Promise<any> {
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

function chatMessages(turn: SendTurnInput, language = ""): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const languagePrompt = languageSystemPrompt(language);
  return [
    ...(turn.system ? [{ role: "system" as const, content: turn.system }] : []),
    ...(languagePrompt ? [{ role: "system" as const, content: languagePrompt }] : []),
    ...(turn.transcript ?? []).map((m) => ({
      role: m.role === "assistant" ? "assistant" as const : "user" as const,
      content: m.text,
    })),
    { role: "user" as const, content: turn.text },
  ];
}

async function complete(
  config: AnalysisApiConfig,
  env: Record<string, string | undefined>,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  signal: AbortSignal,
): Promise<string> {
  const key = apiKey(config.provider, env);
  if (config.provider !== "ollama" && !key) throw new Error(`${LABELS[config.provider]} API key is not configured`);
  const model = config.model || DEFAULT_MODELS[config.provider];

  if (config.provider === "gemini") {
    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
        signal,
      },
    );
    const body = await readJson(response);
    if (!response.ok) throw new Error(textAt(body, ["error", "message"]) || `Gemini HTTP ${response.status}`);
    return textAt(body, ["candidates", 0, "content", "parts", 0, "text"]);
  }

  if (config.provider === "claude") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        ...(system ? { system } : {}),
        messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
      }),
      signal,
    });
    const body = await readJson(response);
    if (!response.ok) throw new Error(textAt(body, ["error", "message"]) || `Anthropic HTTP ${response.status}`);
    return textAt(body, ["content", 0, "text"]);
  }

  if (config.provider === "cloudflare") {
    if (!config.cloudflareAccountId) throw new Error("Cloudflare account ID is not configured");
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.cloudflareAccountId)}/ai/run/${model}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ messages: messages.map((m) => ({ role: m.role, content: m.content })) }),
        signal,
      },
    );
    const body = await readJson(response);
    if (!response.ok) throw new Error(textAt(body, ["errors", 0, "message"]) || `Cloudflare AI HTTP ${response.status}`);
    return textAt(body, ["result", "response"]) || textAt(body, ["result", "text"]);
  }

  if (config.provider === "ollama") {
    const base = (config.ollamaBaseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
      signal,
    });
    const body = await readJson(response);
    if (!response.ok) throw new Error(textAt(body, ["error"]) || `Ollama HTTP ${response.status}`);
    return textAt(body, ["message", "content"]) || textAt(body, ["response"]);
  }

  const endpoints: Record<Exclude<AnalysisProvider, "gemini" | "claude" | "cloudflare" | "ollama">, string> = {
    chatgpt: "https://api.openai.com/v1/chat/completions",
    perplexity: "https://api.perplexity.ai/chat/completions",
    grok: "https://api.x.ai/v1/chat/completions",
    deepseek: "https://api.deepseek.com/chat/completions",
    nvidia: "https://integrate.api.nvidia.com/v1/chat/completions",
    mistral: "https://api.mistral.ai/v1/chat/completions",
  };
  const response = await fetch(endpoints[config.provider], {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages }),
    signal,
  });
  const body = await readJson(response);
  if (!response.ok) throw new Error(textAt(body, ["error", "message"]) || textAt(body, ["message"]) || `${LABELS[config.provider]} HTTP ${response.status}`);
  return textAt(body, ["choices", 0, "message", "content"]);
}

export const AnalysisApiDriver: ProviderDriver<AnalysisApiConfig> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Connected API", supportsMultipleInstances: false, access: "subscription" },
  models: { default: DEFAULT_MODELS.gemini, options: [{ id: DEFAULT_MODELS.gemini, label: DEFAULT_MODELS.gemini }] },
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input: DriverCreateInput<AnalysisApiConfig>): Promise<ProviderInstance> {
    const { config, instanceId } = input;
    const listeners = new Set<RuntimeEventListener>();
    const active = new Map<string, { abort: AbortController; turnId: string }>();
    const pending = new Map<string, { threadId: string; resolve: (allow: boolean) => void }>();
    const model = config.model || DEFAULT_MODELS[config.provider];
    const models: ModelCatalog = { default: model, options: [{ id: model, label: model }] };
    const displayName = LABELS[config.provider];
    const emit = (event: RuntimeEvent) => [...listeners].forEach((listener) => listener(event));
    const base = (threadId: string, turnId: string) => ({
      eventId: newEventId(),
      provider: DRIVER_KIND,
      threadId,
      turnId,
      createdAt: new Date().toISOString(),
    });

    const sendTurn = async (turn: SendTurnInput) => {
      if (active.has(turn.threadId)) throw new Error("a turn is already running on this thread");
      const turnId = newId();
      const abort = new AbortController();
      active.set(turn.threadId, { abort, turnId });
      const messages = chatMessages(turn, config.language);
      appendNative(turn.threadId, {
        dir: "out",
        source: "analysis-api.chat",
        msg: { provider: config.provider, model: turn.model ?? model, messageCount: messages.length },
      });
      emit({ ...base(turn.threadId, turnId), type: "turn.started" });
      emit({ ...base(turn.threadId, turnId), type: "session.started", sessionId: null, model: turn.model ?? model });
      (async () => {
        try {
          const connected = await connectApiTools(turn, abort.signal);
          let text: string;
          try {
            const invoke = async (tool: ApiTool, args: Record<string, unknown>) => {
              const requestId = newId();
              const allowed = await new Promise<boolean>((resolve) => {
                const finish = (allow: boolean) => {
                  clearTimeout(timer);
                  abort.signal.removeEventListener("abort", onAbort);
                  pending.delete(requestId);
                  resolve(allow);
                };
                const onAbort = () => finish(false);
                const timer = setTimeout(() => finish(false), 15 * 60_000);
                pending.set(requestId, { threadId: turn.threadId, resolve: finish });
                abort.signal.addEventListener("abort", onAbort, { once: true });
                if (abort.signal.aborted) return finish(false);
                emit({ ...base(turn.threadId, turnId), requestId, type: "request.opened", requestType: "permission", tool: tool.name, summary: `${tool.description}\n${JSON.stringify(args).slice(0, 4000)}` });
              });
              abort.signal.throwIfAborted();
              if (!allowed) return JSON.stringify({ error: "Tool execution was denied or approval expired. No action was performed." });
              const itemId = newId();
              emit({ ...base(turn.threadId, turnId), itemId, type: "item.started", itemType: "tool", title: tool.name });
              try {
                const result = await tool.execute(args, abort.signal);
                emit({ ...base(turn.threadId, turnId), itemId, type: "item.completed", itemType: "tool", ok: true });
                return result;
              } catch (error) {
                emit({ ...base(turn.threadId, turnId), itemId, type: "item.completed", itemType: "tool", ok: false });
                throw error;
              }
            };
            text = connected.tools.length
              ? await completeWithTools({ ...config, model: turn.model || model }, apiKey(config.provider, input.environment), messages, connected.tools, abort.signal, invoke)
              : await complete({ ...config, model: turn.model || model }, input.environment, messages, AbortSignal.any([abort.signal, AbortSignal.timeout(90_000)]));
          } finally {
            await connected.close();
          }
          appendNative(turn.threadId, { dir: "in", source: "analysis-api.chat", msg: { textLength: text.length } });
          if (text.trim()) emit({ ...base(turn.threadId, turnId), type: "item.completed", itemType: "assistant_text", text });
          active.delete(turn.threadId);
          emit({ ...base(turn.threadId, turnId), type: "turn.completed", ok: true, stopReason: null, cost: null });
        } catch (error) {
          active.delete(turn.threadId);
          const aborted = (error as Error).name === "AbortError";
          if (!aborted) emit({ ...base(turn.threadId, turnId), type: "runtime.error", message: (error as Error).message });
          emit({ ...base(turn.threadId, turnId), type: "turn.completed", ok: false, stopReason: aborted ? "interrupted" : "error", cost: null });
        }
      })();
      return { turnId };
    };

    const snapshot = async (): Promise<ProviderSnapshot> => {
      if (config.provider === "ollama") return config.ollamaBaseUrl ? { state: "available", authenticated: true, version: null, billing: "metered" } : { state: "unavailable", reason: "Ollama base URL is not configured" };
      if (!apiKey(config.provider, input.environment)) return { state: "unavailable", reason: `${displayName} API key is not configured` };
      if (config.provider === "cloudflare" && !config.cloudflareAccountId) return { state: "unavailable", reason: "Cloudflare account ID is not configured" };
      return { state: "available", authenticated: true, version: null, billing: "metered" };
    };

    return {
      instanceId,
      driverKind: DRIVER_KIND,
      displayName,
      enabled: input.enabled,
      models,
      snapshot,
      adapter: {
        provider: DRIVER_KIND,
        capabilities: { sessionModelSwitch: "in-session", agentsMcp: config.provider !== "perplexity", composioMcp: config.provider !== "perplexity" },
        sendTurn,
        interruptTurn: async (threadId) => active.get(threadId)?.abort.abort(),
        respondToRequest: async (threadId, requestId, decision) => {
          const request = pending.get(requestId);
          if (!request || request.threadId !== threadId) return "unavailable";
          const allow = decision.behavior === "allow";
          request.resolve(allow);
          emit({ ...base(threadId, active.get(threadId)?.turnId ?? ""), requestId, type: "request.resolved", behavior: allow ? "allow" : "deny", source: "user" });
          return allow ? "allowed-once" : "rejected";
        },
        hasSession: (threadId) => active.has(threadId),
        stopAll: async () => {
          for (const { abort } of active.values()) abort.abort();
          active.clear();
        },
        onEvent(listener: RuntimeEventListener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      dispose: async () => {
        for (const { abort } of active.values()) abort.abort();
        active.clear();
      },
    };
  },
};
