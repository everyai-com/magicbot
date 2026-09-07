import { afterEach, expect, it, vi } from "vitest";
import { completeWithTools } from "./api-tool-loop.ts";
import type { AnalysisApiConfig } from "./analysis-api.ts";
const tool = { name: "lookup", description: "Look up a value", parameters: { type: "object", properties: { key: { type: "string" } } }, execute: async () => "found" };
const cfg = (provider: AnalysisApiConfig["provider"]): AnalysisApiConfig => ({ provider, model: "test", language: "", cloudflareAccountId: "account", ollamaBaseUrl: "http://localhost:11434" });
afterEach(() => vi.unstubAllGlobals());
for (const provider of ["chatgpt", "grok", "deepseek", "nvidia", "mistral", "ollama", "cloudflare"] as const) {
  it(`${provider}: returns tool results to the model before the final response`, async () => {
    const initial = { content: "", tool_calls: [{ id: "call-1", function: { name: "lookup", arguments: provider === "ollama" ? { key: "x" } : '{"key":"x"}' } }] };
    const wrap = (message: unknown) => provider === "ollama" ? { message } : provider === "cloudflare" ? { result: message } : { choices: [{ message }] };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(wrap(initial))).mockResolvedValueOnce(Response.json(wrap({ content: "Found it" })));
    vi.stubGlobal("fetch", fetcher);
    const invoke = vi.fn(async () => "found");
    expect(await completeWithTools(cfg(provider), "test", [{ role: "user", content: "Find x" }], [tool], new AbortController().signal, invoke)).toBe("Found it");
    expect(invoke).toHaveBeenCalledWith(tool, { key: "x" });
    const messages = JSON.parse(fetcher.mock.calls[1][1].body).messages;
    expect(messages.at(-1)).toMatchObject({ role: "tool", content: "found" });
  });
}
it("preserves Gemini thought signatures and sends function responses", async () => {
  const content = { role: "model", parts: [{ functionCall: { name: "lookup", args: { key: "x" } }, thoughtSignature: "signature" }] };
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ candidates: [{ content }] })).mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: "Done" }] } }] }));
  vi.stubGlobal("fetch", fetcher);
  await completeWithTools(cfg("gemini"), "test", [{ role: "user", content: "Find x" }], [tool], new AbortController().signal, async () => "found");
  const history = JSON.parse(fetcher.mock.calls[1][1].body).contents;
  expect(history[1]).toEqual(content);
  expect(history[2].parts[0].functionResponse.response.result).toBe("found");
});
it("returns a tool failure to Claude without claiming success", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ content: [{ type: "tool_use", id: "call-1", name: "lookup", input: {} }] })).mockResolvedValueOnce(Response.json({ content: [{ type: "text", text: "Lookup failed" }] }));
  vi.stubGlobal("fetch", fetcher);
  await completeWithTools(cfg("claude"), "test", [{ role: "user", content: "Find x" }], [tool], new AbortController().signal, async () => { throw new Error("Unavailable"); });
  expect(JSON.parse(fetcher.mock.calls[1][1].body).messages.at(-1).content[0].content).toContain("Unavailable");
});
it("honors cancellation before making provider requests", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(completeWithTools(cfg("chatgpt"), "test", [], [tool], AbortSignal.abort(), async () => "")).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
