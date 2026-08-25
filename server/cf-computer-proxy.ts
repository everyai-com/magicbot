// cf-computer-proxy — a minimal MCP stdio server the agent CLI spawns
// (same dedicated-entry-file pattern as computer-proxy.ts). It gives the
// agent its bot's MagicBot cloud computer: the per-bot Cloudflare Sandbox
// container behind the cf-computer/ Worker. Headless tier — shell, code,
// files, and exposed ports; no desktop/screenshot tools.
//
// stdout is the MCP channel — never console.log here.
const BASE = (process.env.MGB_CF_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.MGB_CF_TOKEN ?? "";
const BOT_ID = process.env.MGB_CF_BOT_ID ?? "";

async function call(action: string, body: unknown, timeoutMs = 120_000): Promise<any> {
  const res = await fetch(`${BASE}/computer/${BOT_ID}/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error ?? `cloud computer ${action} failed (${res.status})`);
  }
  return json;
}

const send = (obj: unknown) => process.stdout.write(JSON.stringify(obj) + "\n");
const text = (id: unknown, t: string, isError = false) =>
  send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) } });

const TOOLS = [
  {
    name: "computer_exec",
    description:
      "Run a shell command on the bot's cloud computer (a persistent Linux sandbox — its disk survives between turns). Returns stdout/stderr/exit code.",
    inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
  {
    name: "run_code",
    description:
      "Execute a code snippet on the cloud computer via its interpreter and get the results (rich outputs, no shell quoting hassles).",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string" },
        language: { type: "string", enum: ["python", "javascript", "typescript"], description: "default python" },
      },
      required: ["code"],
    },
  },
  {
    name: "write_file",
    description: "Write a text file on the cloud computer (parent directories created as needed).",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "read_file",
    description: "Read a text file from the cloud computer.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "expose_port",
    description:
      "Expose a port the cloud computer is listening on as a public preview URL — start the server first (e.g. with computer_exec, backgrounded), then expose it.",
    inputSchema: { type: "object", properties: { port: { type: "number" } }, required: ["port"] },
  },
];

async function toolCall(id: unknown, name: string, args: any) {
  if (name === "computer_exec") {
    const command = String(args.command ?? "").slice(0, 8000);
    if (!command) return text(id, "computer_exec needs a command", true);
    const out = await call("exec", { command });
    return text(
      id,
      `exit ${out.exitCode}\n${String(out.stdout ?? "").slice(-6000)}${out.stderr ? `\n[stderr]\n${String(out.stderr).slice(-2000)}` : ""}`,
      out.exitCode !== 0,
    );
  }
  if (name === "run_code") {
    const code = String(args.code ?? "");
    if (!code) return text(id, "run_code needs code", true);
    const out = await call("run", { code, language: args.language || "python" });
    const parts: string[] = [];
    const logs = out.logs ?? {};
    if (Array.isArray(logs.stdout) && logs.stdout.length) parts.push(logs.stdout.join("\n"));
    if (Array.isArray(logs.stderr) && logs.stderr.length) parts.push(`[stderr]\n${logs.stderr.join("\n")}`);
    if (Array.isArray(out.results) && out.results.length) parts.push(JSON.stringify(out.results, null, 2));
    if (out.error) parts.push(`[error]\n${typeof out.error === "string" ? out.error : JSON.stringify(out.error)}`);
    return text(id, parts.join("\n").slice(0, 8000) || "(no output)", Boolean(out.error));
  }
  if (name === "write_file") {
    const path = String(args.path ?? "");
    if (!path || typeof args.content !== "string") return text(id, "write_file needs path + content", true);
    await call("writeFile", { path, content: args.content });
    return text(id, `wrote ${args.content.length} chars to ${path}`);
  }
  if (name === "read_file") {
    const path = String(args.path ?? "");
    if (!path) return text(id, "read_file needs a path", true);
    const out = await call("readFile", { path });
    // the Worker relays the Sandbox SDK's file object; the text lives in
    // .content when it's an object, or is the value itself when a string
    const c = out.content;
    const body = typeof c === "string" ? c : typeof c?.content === "string" ? c.content : JSON.stringify(c);
    return text(id, body.slice(0, 100_000));
  }
  if (name === "expose_port") {
    const port = Math.round(Number(args.port));
    if (!Number.isFinite(port) || port <= 0) return text(id, "expose_port needs a numeric port", true);
    const out = await call("expose", { port });
    return text(id, `exposed port ${port} at ${out.url}`);
  }
  return text(id, `unknown tool ${name}`, true);
}

async function handle(msg: any) {
  if (msg.method === "initialize") {
    return send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "magicbot-cloud-computer", version: "1" },
      },
    });
  }
  if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
  if (msg.method === "tools/call") {
    try {
      return await toolCall(msg.id, msg.params?.name, msg.params?.arguments ?? {});
    } catch (e) {
      return text(msg.id, `cloud computer tool failed: ${(e as Error).message}`, true);
    }
  }
  if (String(msg.method ?? "").startsWith("notifications/")) return;
  if (msg.id != null) {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
  }
}

let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    try {
      void handle(JSON.parse(line));
    } catch {
      /* ignore malformed lines */
    }
  }
});
process.stdin.on("end", () => process.exit(0));
