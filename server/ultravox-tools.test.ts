import { afterEach, expect, it, vi } from "vitest";
import { registerCustomTool } from "./ultravox.ts";
import type { AppConfig } from "./config.ts";
import { parseCustomTool } from "../shared/custom-tool.ts";
const cfg = { ultravox: { apiKey: "test-key" } } as AppConfig;
const entry = "Tool Name: magic_bots\nBase URL Pattern: https://example.com/webhook\nHTTP Method: POST\nTimeout: 20s\nParameters:\n- company (Dynamic, Body, String, required): Company name";
afterEach(() => vi.unstubAllGlobals());
it("creates a durable tool and assigns it without removing other agent tools", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ callTemplate: { systemPrompt: "Keep me", selectedTools: [{ toolName: "hangUp" }, { temporaryTool: { modelToolName: "magic_bots" } }] } }))
    .mockResolvedValueOnce(Response.json({ results: [] }))
    .mockResolvedValueOnce(Response.json({ toolId: "created" }))
    .mockResolvedValueOnce(Response.json({}));
  vi.stubGlobal("fetch", fetcher);
  expect(await registerCustomTool(cfg, "agent", entry)).toBe("created");
  const created = JSON.parse(fetcher.mock.calls[2][1].body);
  expect(created.definition.dynamicParameters[0]).toEqual({ name: "company", location: "PARAMETER_LOCATION_BODY", required: true, schema: { type: "string", description: "Company name" } });
  expect(JSON.parse(fetcher.mock.calls[3][1].body).callTemplate).toEqual({ systemPrompt: "Keep me", selectedTools: [{ toolName: "hangUp" }, { toolId: "created" }] });
});
it("reuses an existing tool on retry and surfaces an assignment failure", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ callTemplate: { selectedTools: [] } }))
    .mockResolvedValueOnce(Response.json({ results: [{ name: "magic_bots", toolId: "existing", definition: { description: "", timeout: "20s", http: { baseUrlPattern: "https://example.com/webhook", httpMethod: "POST" }, dynamicParameters: [] } }] }))
    .mockResolvedValueOnce(Response.json({ detail: "assignment rejected" }, { status: 400 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(registerCustomTool(cfg, "agent", entry.split("\nParameters:")[0])).rejects.toThrow("assignment rejected");
  expect(fetcher.mock.calls.filter((call) => call[1].method === "POST")).toHaveLength(0);
});
it("rejects incomplete static parameters rather than silently dropping them", () => {
  expect(() => parseCustomTool(entry.replace("Dynamic", "Static"))).toThrow("needs a value");
});
it("updates the existing durable tool when its name and endpoint change", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ callTemplate: { selectedTools: [{ toolId: "existing" }, { toolName: "hangUp" }] } }))
    .mockResolvedValueOnce(Response.json({ results: [{ name: "magic_bots", toolId: "existing", definition: { http: { baseUrlPattern: "https://example.com/webhook", httpMethod: "POST" } } }] }))
    .mockResolvedValueOnce(Response.json({ toolId: "existing" }))
    .mockResolvedValueOnce(Response.json({}));
  vi.stubGlobal("fetch", fetcher);
  await registerCustomTool(cfg, "agent", entry.replace("magic_bots", "updated_tool").replace("/webhook", "/new"), entry);
  expect(fetcher.mock.calls[2][0]).toContain("/tools/existing");
  expect(fetcher.mock.calls[2][1].method).toBe("PUT");
  expect(JSON.parse(fetcher.mock.calls[2][1].body).name).toBe("updated_tool");
  expect(fetcher.mock.calls.filter((call) => call[1].method === "POST")).toHaveLength(0);
});
it("detaches and deletes the selected tool while preserving other tools", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ callTemplate: { selectedTools: [{ toolId: "existing" }, { toolName: "hangUp" }] } }))
    .mockResolvedValueOnce(Response.json({ results: [{ name: "magic_bots", toolId: "existing", definition: { http: { baseUrlPattern: "https://example.com/webhook", httpMethod: "POST" } } }] }))
    .mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  await registerCustomTool(cfg, "agent", entry, undefined, true);
  expect(JSON.parse(fetcher.mock.calls[2][1].body).callTemplate.selectedTools).toEqual([{ toolName: "hangUp" }]);
  expect(fetcher.mock.calls[3][1].method).toBe("DELETE");
});
it("allows a deletion retry when the tool is already absent", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ callTemplate: { selectedTools: [] } }))
    .mockResolvedValueOnce(Response.json({ results: [] }))
    .mockResolvedValueOnce(Response.json({}));
  vi.stubGlobal("fetch", fetcher);
  await registerCustomTool(cfg, "agent", entry, undefined, true);
  expect(fetcher.mock.calls.filter((call) => call[1].method === "POST")).toHaveLength(0);
});
