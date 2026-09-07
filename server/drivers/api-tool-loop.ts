import type { ApiTool } from "./api-tools.ts";
import type { AnalysisApiConfig } from "./analysis-api.ts";

type Message = { role: string; content: string };
type Call = { id: string; name: string; args: Record<string, unknown> };

function argumentsObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Tool arguments must be an object");
  return parsed as Record<string, unknown>;
}

/** Keep provider-native assistant frames intact, including Gemini signatures. */
export async function completeWithTools(
  config: AnalysisApiConfig, key: string, messages: Message[], tools: ApiTool[], signal: AbortSignal,
  invoke: (tool: ApiTool, args: Record<string, unknown>) => Promise<string>,
): Promise<string> {
  const provider = config.provider;
  if (provider === "perplexity") throw new Error("This Perplexity engine does not support custom tool execution. Select a tool-capable engine in AI Analysis.");
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const history: any[] = provider === "gemini"
    ? messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }))
    : provider === "claude" ? messages.filter((m) => m.role !== "system") : [...messages];
  const endpoints = {
    chatgpt: "https://api.openai.com/v1/chat/completions", grok: "https://api.x.ai/v1/chat/completions",
    deepseek: "https://api.deepseek.com/chat/completions", nvidia: "https://integrate.api.nvidia.com/v1/chat/completions",
    mistral: "https://api.mistral.ai/v1/chat/completions",
  };
  for (let step = 0; step < 12; step++) {
    signal.throwIfAborted();
    let url: string;
    const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${key}` };
    let body: Record<string, unknown>;
    if (provider === "gemini") {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
      delete headers.authorization;
      headers["x-goog-api-key"] = key;
      body = { contents: history, systemInstruction: { parts: [{ text: system }] }, tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }] };
    } else if (provider === "claude") {
      url = "https://api.anthropic.com/v1/messages";
      delete headers.authorization;
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
      body = { model: config.model, max_tokens: 4096, system, messages: history, tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) };
    } else {
      if (provider === "ollama") url = `${(config.ollamaBaseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "")}/api/chat`;
      else if (provider === "cloudflare") {
        if (!config.cloudflareAccountId) throw new Error("Cloudflare account ID is not configured");
        url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.cloudflareAccountId)}/ai/run/${config.model}`;
      } else url = endpoints[provider];
      body = { model: config.model, messages: history, stream: false, tools: tools.map((t) => provider === "cloudflare"
        ? { name: t.name, description: t.description, parameters: t.parameters }
        : { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }) };
    }
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]) });
    const data = await response.json() as any;
    if (!response.ok) throw new Error(data.error?.message ?? data.error ?? `${provider} request failed (${response.status})`);
    let text = "";
    let calls: Call[] = [];
    if (provider === "gemini") {
      const content = data.candidates?.[0]?.content;
      if (!content) throw new Error("Gemini returned no content");
      history.push(content);
      text = (content.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join("");
      calls = (content.parts ?? []).filter((p: any) => p.functionCall).map((p: any) => ({ id: p.functionCall.id ?? "", name: p.functionCall.name, args: argumentsObject(p.functionCall.args ?? {}) }));
    } else if (provider === "claude") {
      history.push({ role: "assistant", content: data.content });
      text = (data.content ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("");
      calls = (data.content ?? []).filter((p: any) => p.type === "tool_use").map((p: any) => ({ id: p.id, name: p.name, args: argumentsObject(p.input) }));
    } else {
      const message = provider === "ollama" ? data.message : provider === "cloudflare" ? data.result : data.choices?.[0]?.message;
      if (!message) throw new Error(`${provider} returned no message`);
      text = message.content ?? message.response ?? "";
      history.push(provider === "cloudflare" ? { role: "assistant", content: text, tool_calls: message.tool_calls } : { ...message, role: "assistant" });
      calls = (message.tool_calls ?? []).map((c: any, i: number) => ({ id: c.id ?? String(i), name: c.function?.name ?? c.name, args: argumentsObject(c.function?.arguments ?? c.arguments ?? {}) }));
    }
    if (!calls.length) {
      if (!text.trim()) throw new Error(`${provider} returned an empty response`);
      return text;
    }
    if (calls.length > 32) throw new Error("Model requested too many tools at once");
    const results: Array<{ call: Call; text: string }> = [];
    for (const call of calls) {
      signal.throwIfAborted();
      const tool = tools.find((t) => t.name === call.name);
      let result: string;
      if (!tool) result = JSON.stringify({ error: `Unknown tool: ${call.name}` });
      else {
        try { result = await invoke(tool, call.args); }
        catch (error) { signal.throwIfAborted(); result = JSON.stringify({ error: error instanceof Error ? error.message : String(error) }); }
      }
      results.push({ call, text: result.slice(0, 100_000) });
    }
    if (provider === "gemini") history.push({ role: "user", parts: results.map(({ call, text }) => ({ functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: { result: text } } })) });
    else if (provider === "claude") history.push({ role: "user", content: results.map(({ call, text }) => ({ type: "tool_result", tool_use_id: call.id, content: text })) });
    else for (const { call, text } of results) history.push({ role: "tool", tool_call_id: call.id, name: call.name, content: text });
  }
  throw new Error("Tool execution reached the 12-step limit. Review the completed actions before continuing.");
}
