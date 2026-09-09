import { parseCustomTool } from "../../../shared/custom-tool.js";
import * as ultravox from "./ultravox-resources.js";
type Platform = (path: string, options: { method?: string; authorization?: string; body?: unknown }) => Promise<any>;
export async function platformResources(request: Request, path: string, authorization: string, key: string, platformJson: Platform): Promise<Response | null> {
  const method = request.method;
  const cfg = { ultravox: { apiKey: key } };
  const respond = (status: number, body: unknown) => Response.json(body, { status });
  let m: RegExpMatchArray | null;
  const agentMatch = path.match(/^\/api\/platform\/agents\/([^/]+)\/(?!demo-call)/);
  if (agentMatch) await platformJson("/api/agents/" + encodeURIComponent(agentMatch[1]), { authorization });

function platformRecordId(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const direct = record.id ?? record._id;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const webhook = record.webhook;
  if (webhook && typeof webhook === "object") {
    const nested = (webhook as Record<string, unknown>).id ?? (webhook as Record<string, unknown>)._id;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return "";
}

function platformRows(value: unknown, keys: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const rows = record[key];
    if (Array.isArray(rows)) {
      return rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
    }
  }
  return [];
}

async function syncPlatformWebhooks(agentId: string, scope: string, authorization: string | undefined): Promise<{ sync: unknown; syncError?: string }> {
  try {
    const sync = await platformJson(`/api/agents/${encodeURIComponent(scope === "global" ? "global" : agentId)}/sync-ultravox`, {
      method: "POST",
      authorization,
      body: {},
    });
    return { sync };
  } catch (error) {
    return { sync: null, syncError: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function readableTextFromHtml(html: string): string {
  const withoutNoise = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const withBreaks = withoutNoise
    .replace(/<\/(p|div|section|article|header|footer|main|aside|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const text = withBreaks
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'");
  return text
    .split(/\r?\n/)
    .map(normalizeWhitespace)
    .filter(Boolean)
    .join("\n")
    .slice(0, 120_000);
}

async function extractWebsiteText(url: string): Promise<string> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw Object.assign(new Error("Enter a valid URL, including https://"), { status: 400 });
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw Object.assign(new Error("Only http and https URLs can be added to knowledge base"), { status: 400 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(target, {
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "user-agent": "MagicTeamsKnowledgeBot/1.0",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw Object.assign(new Error(`Could not fetch URL (${response.status})`), { status: response.status });
    }
    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();
    const text = contentType.includes("html") ? readableTextFromHtml(raw) : normalizeWhitespace(raw).slice(0, 120_000);
    if (!text) throw Object.assign(new Error("No readable text was found at that URL"), { status: 422 });
    return text;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw Object.assign(new Error("URL fetch timed out"), { status: 408 });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

    // ── MagicTeams hosted voice resources ─────────────────────────────
    if (method === "GET" && path === "/api/platform/phone-configs") {
      
      const params = new URLSearchParams();
      params.set("activeOnly", "false");
      params.set("channel", "voice");
      return respond(200, {
        phoneConfigs: await platformJson(`/api/phone-configs?${params}`, { authorization }),
      });
    }
    if (method === "POST" && path === "/api/platform/phone-configs") {
      
      const body = await request.json() as Record<string, any>;
      const phoneConfig = await platformJson("/api/phone-configs", {
        method: "POST",
        authorization,
        body,
      });
      return respond(201, { phoneConfig });
    }
    m = path.match(/^\/api\/platform\/phone-configs\/([^/]+)$/);
    if (m && method === "PATCH") {
      
      const body = await request.json() as Record<string, any>;
      const phoneConfig = await platformJson(`/api/phone-configs/${encodeURIComponent(m[1])}`, {
        method: "PATCH",
        authorization,
        body,
      });
      return respond(200, { phoneConfig });
    }
    if (m && method === "DELETE") {
      
      const deleted = await platformJson(`/api/phone-configs/${encodeURIComponent(m[1])}`, {
        method: "DELETE",
        authorization,
      });
      return respond(200, { success: true, deleted });
    }
    m = path.match(/^\/api\/platform\/agents\/([^/]+)\/phone-number$/);
    if (m && method === "PATCH") {
      
      const body = await request.json() as Record<string, any>;
      const phoneNumberId = typeof body.phone_number_id === "string" && body.phone_number_id.trim()
        ? body.phone_number_id.trim()
        : null;
      const agent = await platformJson(`/api/agents/${encodeURIComponent(m[1])}`, {
        method: "PATCH",
        authorization,
        body: { phone_number_id: phoneNumberId },
      });
      return respond(200, { agent });
    }
    const crmRead = path.match(/^\/api\/platform\/crm\/campaigns(?:\/([^/]+)\/(contacts|outcomes))?$/);
    if (crmRead && method === "GET") {
      
      const remotePath = crmRead[1] ? `/api/${crmRead[2] === "contacts" ? "contacts" : "call-outcomes"}/by-campaign/${encodeURIComponent(crmRead[1])}` : "/api/campaigns";
      return respond(200, await platformJson(remotePath, { authorization }));
    }
    m = path.match(/^\/api\/platform\/agents\/([^/]+)\/custom-tools$/);
    if (m && ["POST", "PATCH", "DELETE"].includes(method)) {
      
      const body = await request.json() as Record<string, any>;
      try {
        const entry = typeof body.entry === "string" ? body.entry : "";
        const previousEntry = typeof body.previousEntry === "string" ? body.previousEntry : entry;
        const previous = parseCustomTool(previousEntry);
        const { timeout: _timeout, ...tool } = parseCustomTool(entry);
        const listed = await platformJson(`/api/knowledge/agent-tools?agent_id=${encodeURIComponent(m[1])}`, { authorization });
        const rows = Array.isArray(listed) ? listed : (listed as { tools?: unknown[]; data?: unknown[] }).tools ?? (listed as { data?: unknown[] }).data;
        if (!Array.isArray(rows)) throw new Error("Could not read existing tools; tool was not created.");
        const existing = rows.find((row: Record<string, unknown>) => row.name === previous.name) ?? rows.find((row: Record<string, unknown>) => row.name === tool.name);
        const collision = rows.find((row: Record<string, unknown>) => row.name === tool.name && row !== existing);
        if (collision) throw new Error("Another tool already uses this name.");
        if (method === "POST" && existing && (existing.http_url !== tool.http_url || existing.http_method !== tool.http_method)) throw new Error("A different tool already uses this name. Choose a unique name.");
        if (method === "PATCH" && existing) await platformJson(`/api/knowledge/agent-tools/${encodeURIComponent(platformRecordId(existing))}`, { method: "PATCH", authorization, body: tool });
        if (method === "DELETE" && existing) await platformJson(`/api/knowledge/agent-tools/${encodeURIComponent(platformRecordId(existing))}`, { method: "DELETE", authorization });
        if (!existing && method !== "DELETE") await platformJson("/api/knowledge/agent-tools", { method: "POST", authorization, body: { ...tool, agent_id: m[1], tool_type: "http", is_active: true } });
        if (method !== "DELETE") await platformJson(`/api/agents/${encodeURIComponent(m[1])}/sync-ultravox`, { method: "POST", authorization, body: {} });
        const result = await platformJson(`/api/agents/${encodeURIComponent(m[1])}`, { authorization }) as Record<string, unknown>;
        const agent = (result.agent ?? result.data ?? result) as Record<string, unknown>;
        const id = typeof agent.ultravox_agent_id === "string" ? agent.ultravox_agent_id : "";
        if (!id) throw new Error("Agent sync did not return an Ultravox agent ID.");
        const toolId = await ultravox.registerCustomTool(cfg, id, entry, method === "PATCH" ? previousEntry : undefined, method === "DELETE");
        return respond(201, { toolId, synced: true });
      } catch (error) {
        return respond(502, { error: `Tool sync failed: ${error instanceof Error ? error.message : String(error)}. Retry the same action to finish any partially saved changes.` });
      }
    }
    m = path.match(/^\/api\/platform\/agents\/([^/]+)\/call-forwarding$/);
    if (m && method === "GET") {
      
      const params = new URLSearchParams();
      params.set("agent_id", m[1]);
      const forwardingNumbers = await platformJson(`/api/call-forwarding?${params}`, { authorization });
      return respond(200, { forwardingNumbers });
    }
    if (m && method === "POST") {
      
      const body = await request.json() as Record<string, any>;
      const phoneNumber = typeof body.phone_number === "string" && body.phone_number.trim()
        ? body.phone_number.trim()
        : typeof body.phoneNumber === "string" && body.phoneNumber.trim()
          ? body.phoneNumber.trim()
          : "";
      if (!phoneNumber) return respond(400, { error: "forwarding phone number required" });
      const forwardingNumber = await platformJson("/api/call-forwarding", {
        method: "POST",
        authorization,
        body: {
          agent_id: m[1],
          phone_number: phoneNumber,
          label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : null,
          priority: typeof body.priority === "number" ? body.priority : undefined,
        },
      });
      let sync: unknown = null;
      let syncError = "";
      try {
        sync = await platformJson(`/api/agents/${encodeURIComponent(m[1])}/sync-ultravox`, {
          method: "POST",
          authorization,
          body: {},
        });
      } catch (error) {
        syncError = error instanceof Error ? error.message : String(error);
      }
      return respond(syncError ? 200 : 201, {
        forwardingNumber,
        sync,
        ...(syncError ? { syncError } : {}),
      });
    }
    m = path.match(/^\/api\/platform\/agents\/([^/]+)\/call-forwarding\/([^/]+)$/);
    if (m && method === "DELETE") {
      
      const deleted = await platformJson(`/api/call-forwarding/${encodeURIComponent(m[2])}`, {
        method: "DELETE",
        authorization,
      });
      let sync: unknown = null;
      let syncError = "";
      try {
        sync = await platformJson(`/api/agents/${encodeURIComponent(m[1])}/sync-ultravox`, {
          method: "POST",
          authorization,
          body: {},
        });
      } catch (error) {
        syncError = error instanceof Error ? error.message : String(error);
      }
      return respond(200, {
        success: true,
        deleted,
        sync,
        ...(syncError ? { syncError } : {}),
      });
    }
    if (method === "GET" && path === "/api/platform/calendar/integrations") {
      
      const integrations = await platformJson("/api/calendar/integrations", { authorization });
      return respond(200, { integrations });
    }
    m = path.match(/^\/api\/platform\/agents\/([^/]+)\/appointment-tools$/);
    if (m && method === "GET") {
      
      const params = new URLSearchParams();
      params.set("agent_id", m[1]);
      const appointmentTools = await platformJson(`/api/calendar/appointment-tools?${params}`, { authorization });
      return respond(200, { appointmentTools });
    }
    if (m && method === "POST") {
      
      const body = await request.json() as Record<string, any>;
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "";
      if (!name) return respond(400, { error: "appointment tool name required" });
      const appointmentTool = await platformJson("/api/calendar/appointment-tools", {
        method: "POST",
        authorization,
        body: {
          agent_id: m[1],
          calendar_integration_id: typeof body.calendar_integration_id === "string" && body.calendar_integration_id.trim()
            ? body.calendar_integration_id.trim()
            : null,
          name,
          provider: typeof body.provider === "string" && body.provider.trim() ? body.provider.trim() : "google_calendar",
          business_hours: body.business_hours && typeof body.business_hours === "object" ? body.business_hours : {},
          appointment_types: Array.isArray(body.appointment_types) ? body.appointment_types : [],
          is_active: body.is_active ?? true,
        },
      });
      let sync: unknown = null;
      let syncError = "";
      try {
        sync = await platformJson(`/api/agents/${encodeURIComponent(m[1])}/sync-ultravox`, {
          method: "POST",
          authorization,
          body: {},
        });
      } catch (error) {
        syncError = error instanceof Error ? error.message : String(error);
      }
      return respond(syncError ? 200 : 201, {
        appointmentTool,
        sync,
        ...(syncError ? { syncError } : {}),
      });
    }
    m = path.match(/^\/api\/platform\/agents\/([^/]+)\/appointment-tools\/([^/]+)$/);
    if (m && method === "PATCH") {
      
      const body = await request.json() as Record<string, any>;
      const patch: Record<string, unknown> = {};
      for (const key of ["calendar_integration_id", "name", "provider", "business_hours", "appointment_types", "is_active"]) {
        if (key in body) patch[key] = body[key];
      }
      const appointmentTool = await platformJson(`/api/calendar/appointment-tools/${encodeURIComponent(m[2])}`, {
        method: "PATCH",
        authorization,
        body: patch,
      });
      let sync: unknown = null;
      let syncError = "";
      try {
        sync = await platformJson(`/api/agents/${encodeURIComponent(m[1])}/sync-ultravox`, {
          method: "POST",
          authorization,
          body: {},
        });
      } catch (error) {
        syncError = error instanceof Error ? error.message : String(error);
      }
      return respond(200, {
        appointmentTool,
        sync,
        ...(syncError ? { syncError } : {}),
      });
    }
    if (m && method === "DELETE") {
      
      let deleted: unknown = null;
      let alreadyDeleted = false;
      try {
        deleted = await platformJson(`/api/calendar/appointment-tools/${encodeURIComponent(m[2])}`, {
          method: "DELETE",
          authorization,
        });
      } catch (error) {
        const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 0;
        const message = error instanceof Error ? error.message : String(error);
        if (status === 404 && /appointment_tools row not found/i.test(message)) {
          alreadyDeleted = true;
        } else {
          throw error;
        }
      }
      let sync: unknown = null;
      let syncError = "";
      try {
        sync = await platformJson(`/api/agents/${encodeURIComponent(m[1])}/sync-ultravox`, {
          method: "POST",
          authorization,
          body: {},
        });
      } catch (error) {
        syncError = error instanceof Error ? error.message : String(error);
      }
      return respond(200, {
        success: true,
        deleted,
        alreadyDeleted,
        sync,
        ...(syncError ? { syncError } : {}),
      });
    }
    m = path.match(/^\/api\/platform\/agents\/([^/]+)\/knowledge-base$/);
    if (m && method === "GET") {
      
      const params = new URLSearchParams();
      params.set("agent_id", m[1]);
      const items = await platformJson(`/api/knowledge/knowledge-base?${params}`, { authorization });
      return respond(200, { items });
    }
    if (m && method === "POST") {
      
      const body = await request.json() as Record<string, any>;
      const title = String(body.title ?? "").trim();
      if (!title) return respond(400, { error: "knowledge base name required" });
      const type = String(body.type ?? "text").trim() || "text";
      const websiteUrl = typeof body.website_url === "string" && body.website_url.trim() ? body.website_url.trim() : null;
      const suppliedContent = typeof body.content === "string" && body.content.trim() ? body.content.trim() : null;
      let extractedWebsiteContent: string | null = null;
      if (websiteUrl) {
        extractedWebsiteContent = await extractWebsiteText(websiteUrl);
      }
      const content = [suppliedContent, extractedWebsiteContent]
        .filter((part): part is string => Boolean(part?.trim()))
        .join("\n\n")
        .trim() || null;
      const payload = {
        agent_id: m[1],
        title,
        type,
        content,
        file_path: typeof body.file_path === "string" && body.file_path.trim() ? body.file_path : null,
        website_url: websiteUrl,
        processing_status: "completed",
      };
      const item = await platformJson("/api/knowledge/knowledge-base", {
        method: "POST",
        authorization,
        body: payload,
      });
      let ultravoxKnowledge: unknown = null;
      let ultravoxError = "";
      try {
        ultravoxKnowledge = await ultravox.createKnowledgeCorpus(cfg, {
          name: title,
          description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
          content: payload.content,
          fileName: payload.file_path || (websiteUrl ? `${new URL(websiteUrl).hostname}.txt` : `${title}.txt`),
          websiteUrl: payload.website_url,
        });
      } catch (error) {
        ultravoxError = error instanceof Error ? error.message : String(error);
      }
      let sync: unknown = null;
      let syncError = "";
      try {
        sync = await platformJson(`/api/agents/${encodeURIComponent(m[1])}/sync-ultravox`, {
          method: "POST",
          authorization,
          body: {},
        });
      } catch (error) {
        syncError = error instanceof Error ? error.message : String(error);
      }
      return respond(ultravoxError || syncError ? 200 : 201, {
        item,
        sync,
        ultravoxKnowledge,
        ultravoxCorpusCreated: Boolean(ultravoxKnowledge && !ultravoxError),
        ...(ultravoxError ? { ultravoxError } : {}),
        ...(syncError ? { syncError } : {}),
      });
    }
    m = path.match(/^\/api\/platform\/agents\/([^/]+)\/knowledge-base\/([^/]+)$/);
    if (m && method === "DELETE") {
      
      let body: Record<string, unknown> = {};
      try {
        body = await request.json() as Record<string, any>;
      } catch {
        body = {};
      }
      const corpusId = typeof body.ultravox_corpus_id === "string" ? body.ultravox_corpus_id.trim() : "";
      const deleted = await platformJson(`/api/knowledge/knowledge-base/${encodeURIComponent(m[2])}`, {
        method: "DELETE",
        authorization,
      });
      let ultravoxDeleted = false;
      let ultravoxError = "";
      if (corpusId) {
        try {
          await ultravox.deleteKnowledgeCorpus(cfg, corpusId);
          ultravoxDeleted = true;
        } catch (error) {
          ultravoxError = error instanceof Error ? error.message : String(error);
        }
      }
      let sync: unknown = null;
      try {
        sync = await platformJson(`/api/agents/${encodeURIComponent(m[1])}/sync-ultravox`, {
          method: "POST",
          authorization,
          body: {},
        });
      } catch (error) {
        return respond(200, {
          success: true,
          deleted,
          ultravoxDeleted,
          sync,
          ...(ultravoxError ? { ultravoxError } : {}),
          syncError: error instanceof Error ? error.message : String(error),
        });
      }
      return respond(200, {
        success: true,
        deleted,
        ultravoxDeleted,
        sync,
        ...(ultravoxError ? { ultravoxError } : {}),
      });
    }
    m = path.match(/^\/api\/platform\/agents\/([^/]+)\/webhooks$/);
    if (m && method === "GET") {
      
      const params = new URLSearchParams({ includeGlobal: "true", agent_id: m[1] });
      const listed = await platformJson(`/api/knowledge/webhooks?${params.toString()}`, { authorization });
      return respond(200, { webhooks: platformRows(listed, ["webhooks", "items", "results"]) });
    }
    m = path.match(/^\/api\/platform\/agents\/([^/]+)\/webhooks$/);
    if (m && method === "POST") {
      
      const body = await request.json() as Record<string, any>;
      const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : "";
      if (!url) return respond(400, { error: "webhook destination URL required" });
      const events = Array.isArray(body.events)
        ? body.events.map((event: unknown) => String(event).trim()).filter(Boolean)
        : ["call.ended"];
      const scope = typeof body.scope === "string" ? body.scope : "agent";
      const agentId = scope === "global" ? null : m[1];
      const webhook = await platformJson("/api/knowledge/webhooks", {
        method: "POST",
        authorization,
        body: {
          name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : url,
          url,
          agent_id: agentId,
          events: events.length ? events : ["call.ended"],
          secret: typeof body.secret === "string" && body.secret.trim() ? body.secret.trim() : null,
          is_active: body.is_active ?? true,
        },
      });
      const { sync, syncError } = await syncPlatformWebhooks(m[1], scope, authorization);
      return respond(syncError ? 200 : 201, {
        webhook,
        sync,
        ...(syncError ? { syncError } : {}),
      });
    }
    m = path.match(/^\/api\/platform\/agents\/([^/]+)\/webhooks\/([^/]+)$/);
    if (m && method === "PATCH") {
      const agentId = m[1];
      
      const body = await request.json() as Record<string, any>;
      const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : "";
      if (!url) return respond(400, { error: "webhook destination URL required" });
      const events = Array.isArray(body.events)
        ? body.events.map((event: unknown) => String(event).trim()).filter(Boolean)
        : ["call.ended"];
      const scope = typeof body.scope === "string" ? body.scope : "agent";
      let webhookId = decodeURIComponent(m[2]);
      if (webhookId === "by-url") {
        const previousUrl = typeof body.previous_url === "string" && body.previous_url.trim() ? body.previous_url.trim() : url;
        const previousScope = typeof body.previous_scope === "string" ? body.previous_scope : scope;
        const params = new URLSearchParams({ includeGlobal: "true", agent_id: agentId });
        const listed = await platformJson(`/api/knowledge/webhooks?${params.toString()}`, { authorization });
        const rows = platformRows(listed, ["webhooks", "items", "results"]);
        const match = rows.find((row) => {
          const rowUrl = typeof row.url === "string" ? row.url.trim() : "";
          const rowAgentId = typeof row.agent_id === "string"
            ? row.agent_id
            : typeof row.agentId === "string"
              ? row.agentId
              : "";
          const globalRow = !rowAgentId;
          return rowUrl === previousUrl && (previousScope === "global" ? globalRow : rowAgentId === agentId);
        });
        webhookId = platformRecordId(match);
        if (!webhookId) return respond(404, { error: "hosted webhook not found" });
      }
      const webhook = await platformJson(`/api/knowledge/webhooks/${encodeURIComponent(webhookId)}`, {
        method: "PATCH",
        authorization,
        body: {
          name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : url,
          url,
          agent_id: scope === "global" ? null : agentId,
          events: events.length ? events : ["call.ended"],
          secret: typeof body.secret === "string" && body.secret.trim() ? body.secret.trim() : null,
          is_active: body.is_active ?? true,
        },
      });
      const { sync, syncError } = await syncPlatformWebhooks(agentId, scope, authorization);
      return respond(200, {
        webhook,
        sync,
        ...(syncError ? { syncError } : {}),
      });
    }
    m = path.match(/^\/api\/platform\/agents\/([^/]+)\/webhooks\/([^/]+)$/);
    if (m && method === "DELETE") {
      const agentId = m[1];
      
      const body = await request.json() as Record<string, any>;
      const scope = typeof body.scope === "string" ? body.scope : "agent";
      let webhookId = decodeURIComponent(m[2]);
      if (webhookId === "by-url") {
        const urlToDelete = typeof body.url === "string" && body.url.trim() ? body.url.trim() : "";
        if (!urlToDelete) return respond(400, { error: "webhook URL required" });
        const params = new URLSearchParams({ includeGlobal: "true", agent_id: agentId });
        const listed = await platformJson(`/api/knowledge/webhooks?${params.toString()}`, { authorization });
        const rows = platformRows(listed, ["webhooks", "items", "results"]);
        const match = rows.find((row) => {
          const rowUrl = typeof row.url === "string" ? row.url.trim() : "";
          const rowAgentId = typeof row.agent_id === "string"
            ? row.agent_id
            : typeof row.agentId === "string"
              ? row.agentId
              : "";
          const globalRow = !rowAgentId;
          return rowUrl === urlToDelete && (scope === "global" ? globalRow : rowAgentId === agentId);
        });
        webhookId = platformRecordId(match);
        if (!webhookId) return respond(404, { error: "hosted webhook not found" });
      }
      const deleted = await platformJson(`/api/knowledge/webhooks/${encodeURIComponent(webhookId)}`, {
        method: "DELETE",
        authorization,
      });
      const { sync, syncError } = await syncPlatformWebhooks(agentId, scope, authorization);
      return respond(200, {
        deleted,
        sync,
        ...(syncError ? { syncError } : {}),
      });
    }

return null;
}
