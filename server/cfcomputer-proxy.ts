// cfcomputer-proxy — a minimal MCP stdio server the claude CLI spawns
// (same pattern and dedicated-entry-file rationale as computer-proxy.ts).
// It gives the agent its bot's Cloudflare cloud computer (the cf-computer/
// Worker: one Sandbox container per bot) as headless tools — shell, code
// runs, files, and HTTP service exposure. No display: Tier 2 (the visual
// desktop) stays on Box until the noVNC image + wildcard domain land.
//
// stdout is the MCP channel — never console.log here.
const base = (process.env.OMB_CF_COMPUTER_URL ?? "").replace(/\/+$/, "");
const token = process.env.OMB_CF_COMPUTER_TOKEN ?? "";
const botId = process.env.OMB_CF_COMPUTER_BOT ?? "";

async function callWorker(action: string, body: unknown, timeoutMs = 120_000): Promise<any> {
  const res = await fetch(`${base}/computer/${botId}/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
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
      "Run a shell command on the bot's cloud computer (a persistent Linux container — its disk survives between turns). Returns stdout/stderr/exit code. No display: this computer is headless, so use CLI tools (curl, python, git…), not GUI apps.",
    inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
  {
    name: "run_code",
    description:
      "Run a snippet in the cloud computer's code interpreter and get its output. Prefer this over computer_exec for multi-line python/javascript/typescript.",
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
    description: "Write a file on the cloud computer (creates parent directories).",
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
      "Expose an HTTP service listening on a port of the cloud computer and get a public preview URL for it. Start the service first (e.g. with computer_exec, backgrounded).",
    inputSchema: { type: "object", properties: { port: { type: "number" } }, required: ["port"] },
  },
];

async function call(id: unknown, name: string, args: any) {
  if (name === "computer_exec") {
    const out = await callWorker("exec", { command: String(args.command ?? "").slice(0, 4000) });
    return text(
      id,
      `exit ${out.exitCode}\n${String(out.stdout ?? "").slice(-6000)}${out.stderr ? `\n[stderr]\n${String(out.stderr).slice(-2000)}` : ""}`,
    );
  }
  if (name === "run_code") {
    const out = await callWorker("run", {
      code: String(args.code ?? ""),
      language: typeof args.language === "string" ? args.language : "python",
    });
    const parts: string[] = [];
    const logs = out.logs ?? {};
    const stdout = Array.isArray(logs.stdout) ? logs.stdout.join("") : String(logs.stdout ?? "");
    const stderr = Array.isArray(logs.stderr) ? logs.stderr.join("") : String(logs.stderr ?? "");
    if (stdout.trim()) parts.push(stdout.trim());
    for (const r of out.results ?? []) {
      const t = typeof r === "string" ? r : (r?.text ?? "");
      if (String(t).trim()) parts.push(String(t).trim());
    }
    if (stderr.trim()) parts.push(`[stderr]\n${stderr.trim()}`);
    if (out.error) parts.push(`[error] ${typeof out.error === "string" ? out.error : JSON.stringify(out.error)}`);
    return text(id, (parts.join("\n") || "(ran with no output)").slice(-8000), Boolean(out.error));
  }
  if (name === "write_file") {
    const path = String(args.path ?? "");
    if (!path) return text(id, "write_file needs a path", true);
    await callWorker("writeFile", { path, content: String(args.content ?? "") });
    return text(id, `wrote ${path}`);
  }
  if (name === "read_file") {
    const path = String(args.path ?? "");
    if (!path) return text(id, "read_file needs a path", true);
    const out = await callWorker("readFile", { path });
    // the Worker relays the Sandbox SDK's readFile result verbatim, which
    // nests the text one level down ({content: {success, path, content}})
    const inner = out.content?.content ?? out.content;
    const content = typeof inner === "string" ? inner : JSON.stringify(inner);
    return text(id, content.slice(0, 100_000));
  }
  if (name === "expose_port") {
    const port = Math.round(Number(args.port));
    if (!Number.isFinite(port) || port < 1 || port > 65535) return text(id, "expose_port needs a port 1-65535", true);
    const out = await callWorker("expose", { port });
    return text(id, `service on port ${port} is public at ${out.url}`);
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
        serverInfo: { name: "magicbot-cf-computer", version: "1" },
      },
    });
  }
  if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
  if (msg.method === "tools/call") {
    try {
      return await call(msg.id, msg.params?.name, msg.params?.arguments ?? {});
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
