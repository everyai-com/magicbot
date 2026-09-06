// cfcomputer-proxy — a minimal MCP stdio server the claude CLI spawns
// (same pattern and dedicated-entry-file rationale as computer-proxy.ts).
// It gives the agent its bot's Cloudflare cloud computer (the cf-computer/
// Worker: one official @cloudflare/computer Workspace and Linux runtime per
// bot) as headless tools — shell, code, and durable files.
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
const image = (id: unknown, data: string, mimeType: string, caption: string) =>
  send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: caption }, { type: "image", data, mimeType }] } });

const TOOLS = [
  {
    name: "computer_exec",
    description:
      "Run a shell command on the bot's Cloudflare Computer. Its Workspace files survive Linux runtime restarts. Returns stdout/stderr/exit code. This computer is headless, so use CLI tools (curl, python, git…), not GUI apps.",
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
    name: "open_url",
    description: "Open an http(s) URL on this bot's screen in the team's shared cloud browser.",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "browser_state",
    description: "Read this bot's current browser title and URL.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_text",
    description: "Read the visible text from this bot's current browser page.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_snapshot",
    description: "List visible interactive elements on this bot's browser page with fresh refs for clicking and filling.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_click",
    description: "Click an element ref from the latest browser_snapshot.",
    inputSchema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
  },
  {
    name: "browser_fill",
    description: "Replace the text in a field ref from the latest browser_snapshot.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string" }, text: { type: "string" } },
      required: ["ref", "text"],
    },
  },
  {
    name: "browser_press",
    description: "Press a keyboard key or Playwright key chord on this bot's browser page.",
    inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  },
  {
    name: "screenshot",
    description: "Capture this bot's browser screen as a fresh JPEG.",
    inputSchema: { type: "object", properties: {} },
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
    // Accept the old Sandbox response as well as the current Workspace shape.
    const inner = out.content?.content ?? out.content;
    const content = typeof inner === "string" ? inner : JSON.stringify(inner);
    return text(id, content.slice(0, 100_000));
  }
  if (name === "open_url") {
    const out = await callWorker("browserOpen", { url: String(args.url ?? "") });
    return text(id, `Opened ${out.title || "Untitled"}: ${out.url}`);
  }
  if (name === "browser_state") {
    const out = await callWorker("browserState", {});
    return text(id, `${out.title || "Untitled"}: ${out.url || "about:blank"}`);
  }
  if (name === "browser_text") {
    const out = await callWorker("browserText", {});
    return text(id, `${out.title || "Untitled"}: ${out.url}\n${String(out.text ?? "")}`.slice(0, 100_000));
  }
  if (name === "browser_snapshot") {
    const out = await callWorker("browserSnapshot", {});
    const lines = (out.elements ?? []).map((element: any) =>
      `${element.ref} ${element.role || element.tag}${element.name ? ` "${element.name}"` : ""}`
    );
    return text(id, `${out.title || "Untitled"}: ${out.url}\n${lines.join("\n") || "No visible interactive elements."}`);
  }
  if (name === "browser_click") {
    const out = await callWorker("browserClick", { ref: String(args.ref ?? "") });
    return text(id, `${out.title || "Untitled"}: ${out.url}`);
  }
  if (name === "browser_fill") {
    const out = await callWorker("browserFill", { ref: String(args.ref ?? ""), text: String(args.text ?? "") });
    return text(id, `${out.title || "Untitled"}: ${out.url}`);
  }
  if (name === "browser_press") {
    const out = await callWorker("browserPress", { key: String(args.key ?? "Enter") });
    return text(id, `${out.title || "Untitled"}: ${out.url}`);
  }
  if (name === "screenshot") {
    const out = await callWorker("browserScreenshot", {});
    return image(id, String(out.image ?? ""), String(out.mimeType ?? "image/jpeg"), `${out.title || "Untitled"}: ${out.url}`);
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
