// MagicBots Cloudflare Computer service.
//
// Each bot maps to one @cloudflare/computer Workspace Durable Object. The
// Workspace owns a durable SQLite-backed filesystem and lazily attaches a
// full Linux container for command execution. The WebComputer entrypoint is
// consumed through a private service binding by the hosted MagicBots Worker.
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import {
  type DurableObjectStorageLike,
  getWorkspace,
  type WorkspaceClient,
  type WorkspaceOptions,
  WorkspaceProxy,
  shellQuote,
  withWorkspace,
} from "@cloudflare/computer";
import {
  CloudflareContainerBackend,
  withWorkspaceContainer,
} from "@cloudflare/computer/backends/container";

// Keep the former class exported so deploying this upgrade does not delete
// existing Sandbox Durable Objects. New work is routed only to Computer.
export { Sandbox } from "@cloudflare/sandbox";
export { WorkspaceProxy };

interface Env {
  Computer: DurableObjectNamespace<Computer>;
  MAGICBOT_COMPUTER_TOKEN: string;
}

class ComputerBase extends withWorkspaceContainer(class extends DurableObject<Env> {}) {
  readonly backend = new CloudflareContainerBackend({
    container: () => this,
    workspace: { binding: "Computer", id: this.ctx.id.toString() },
    egress: { mode: "direct" },
  });
}

function workspaceOptions(self: InstanceType<typeof ComputerBase>): WorkspaceOptions {
  const { ctx } = self as unknown as { ctx: DurableObjectState };
  return {
    storage: ctx.storage as unknown as DurableObjectStorageLike,
    backends: [self.backend],
  };
}

/** One persistent Cloudflare Computer workspace per bot. */
export class Computer extends withWorkspace(ComputerBase, workspaceOptions) {
  override async fetch(request: Request): Promise<Response> {
    return this.backend.handleFetch(request);
  }

  async computerStatus() {
    // Read the container state directly from the Durable Object. Returning a
    // second RpcTarget from inside a DO RPC call can leave the outer service
    // binding waiting forever when the container is asleep.
    return {
      running: Boolean(this.ctx.container?.running),
      exit: null,
    };
  }

  async sleepComputer() {
    if (this.ctx.container?.running) await this.ctx.container.destroy();
  }

  async destroyComputer() {
    if (this.ctx.container?.running) await this.ctx.container.destroy();
    await this.ctx.storage.deleteAll();
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

function workspaceStub(env: Env, botId: string) {
  return env.Computer.get(env.Computer.idFromName(botId));
}

async function useWorkspace<T>(env: Env, botId: string, work: (ws: WorkspaceClient) => Promise<T>) {
  const stub = workspaceStub(env, botId);
  const ws = await getWorkspace(stub as unknown as Parameters<typeof getWorkspace>[0]);
  try {
    return await work(ws);
  } finally {
    ws[Symbol.dispose]();
  }
}

function durablePath(input: string): string {
  const normalized = input.trim().replaceAll("\\", "/");
  const relative = normalized.startsWith("/workspace/")
    ? normalized.slice("/workspace/".length)
    : normalized === "/workspace"
      ? ""
      : normalized.replace(/^\/+/, "");
  const segments = relative.split("/").filter(Boolean);
  if (segments.includes("..")) throw new Error("path cannot leave /workspace");
  return segments.length ? `/workspace/${segments.join("/")}` : "/workspace";
}

function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "/workspace" : path.slice(0, slash);
}

async function execComputer(env: Env, botId: string, command: string) {
  if (!command.trim()) throw new Error("command required");
  return useWorkspace(env, botId, async (ws) => {
    const handle = await ws.runtime.exec(command, {
      cwd: "/workspace",
      encoding: "utf8",
      timeoutMs: 120_000,
    });
    try {
      const result = await handle.result();
      return {
        ok: result.exitCode === 0,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exitCode: result.exitCode,
        runtime: "cloudflare-computer",
      };
    } finally {
      handle[Symbol.dispose]?.();
    }
  });
}

async function runComputer(
  env: Env,
  botId: string,
  code: string,
  language: "python" | "javascript" | "typescript" = "python",
) {
  if (!code) throw new Error("code required");
  return useWorkspace(env, botId, async (ws) => {
    const extension = language === "python" ? "py" : language === "typescript" ? "ts" : "mjs";
    const path = `/workspace/.magicbot/run-${crypto.randomUUID()}.${extension}`;
    await ws.fs.mkdir(parentPath(path), { recursive: true });
    await ws.fs.writeFile(path, code);
    const command = language === "python"
      ? `python3 '${path}'`
      : language === "typescript"
        ? `node --experimental-strip-types '${path}'`
        : `node '${path}'`;
    const handle = await ws.runtime.exec(command, {
      cwd: "/workspace",
      encoding: "utf8",
      timeoutMs: 120_000,
    });
    try {
      const result = await handle.result();
      return {
        ok: result.exitCode === 0,
        results: [],
        logs: { stdout: [result.stdout ?? ""], stderr: [result.stderr ?? ""] },
        error: result.exitCode === 0 ? null : `Process exited with code ${result.exitCode}`,
        exitCode: result.exitCode,
      };
    } finally {
      handle[Symbol.dispose]?.();
      await ws.fs.rm(path, { force: true }).catch(() => undefined);
    }
  });
}

async function writeComputerFile(env: Env, botId: string, inputPath: string, content: string) {
  const path = durablePath(inputPath);
  if (path === "/workspace") throw new Error("file path required");
  return useWorkspace(env, botId, async (ws) => {
    await ws.fs.mkdir(parentPath(path), { recursive: true });
    await ws.fs.writeFile(path, content);
    return { ok: true, path };
  });
}

async function readComputerFile(env: Env, botId: string, inputPath: string) {
  const path = durablePath(inputPath);
  return useWorkspace(env, botId, async (ws) => ({
    ok: true,
    path,
    content: await ws.fs.readFile(path, "utf8"),
  }));
}

async function destroyComputer(env: Env, botId: string) {
  const stub = workspaceStub(env, botId) as unknown as { destroyComputer(): Promise<void> };
  await stub.destroyComputer();
  return { ok: true };
}

async function sleepComputer(env: Env, botId: string) {
  const stub = workspaceStub(env, botId) as unknown as { sleepComputer(): Promise<void> };
  await stub.sleepComputer();
  return { ok: true };
}

type CodexEffort = "low" | "medium" | "high" | "xhigh";

function codexAuthFile(raw: string): string {
  if (!raw || raw.length > 64_000) throw new Error("Codex connection is invalid");
  const parsed = JSON.parse(raw) as {
    auth_mode?: unknown;
    tokens?: { access_token?: unknown; account_id?: unknown };
  };
  if (parsed.auth_mode !== "chatgpt" || typeof parsed.tokens?.access_token !== "string" || typeof parsed.tokens.account_id !== "string") {
    throw new Error("Codex connection is incomplete");
  }
  return raw;
}

async function runCodex(
  env: Env,
  botId: string,
  authJson: string,
  prompt: string,
  model: string,
  effort: CodexEffort = "medium",
) {
  const auth = codexAuthFile(authJson);
  if (!prompt.trim() || prompt.length > 120_000) throw new Error("Codex prompt is invalid");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(model)) throw new Error("Codex model is invalid");
  if (!["low", "medium", "high", "xhigh"].includes(effort)) throw new Error("Codex effort is invalid");

  return useWorkspace(env, botId, async (ws) => {
    const command = [
      "set -eu",
      'auth_dir="$(mktemp -d)"',
      'trap \'rm -rf "$auth_dir"\' EXIT',
      'export CODEX_HOME="$auth_dir/codex"',
      'mkdir -p "$CODEX_HOME"',
      "node -e 'const fs=require(\"fs\");fs.writeFileSync(process.env.CODEX_HOME+\"/auth.json\",process.env.MAGICBOT_CODEX_AUTH,{mode:0o600})'",
      "unset MAGICBOT_CODEX_AUTH",
      `codex exec --json --ephemeral --ignore-user-config --ignore-rules --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -C /workspace -m ${shellQuote(model)} -c ${shellQuote(`model_reasoning_effort=${effort}`)} -o \"$auth_dir/last-message\" - > \"$auth_dir/events.jsonl\"`,
      'cat "$auth_dir/last-message"',
    ].join("; ");
    const handle = await ws.runtime.exec(command, {
      cwd: "/workspace",
      encoding: "utf8",
      env: { MAGICBOT_CODEX_AUTH: auth },
      stdin: prompt,
      timeoutMs: 180_000,
    });
    try {
      const result = await handle.result();
      return {
        ok: result.exitCode === 0 && Boolean(result.stdout?.trim()),
        text: result.stdout?.trim() ?? "",
        stderr: result.stderr?.slice(-8_000) ?? "",
        exitCode: result.exitCode,
        runtime: "codex-cli-cloudflare-computer",
      };
    } finally {
      handle[Symbol.dispose]?.();
    }
  });
}

/** Private service-binding API used by the hosted web Worker. */
export class WebComputer extends WorkerEntrypoint<Env> {
  async status(botId: string) {
    const stub = workspaceStub(this.env, botId) as unknown as {
      computerStatus(): Promise<{ running: boolean; exit: unknown }>;
    };
    return stub.computerStatus();
  }

  exec(botId: string, command: string) {
    return execComputer(this.env, botId, command);
  }

  run(botId: string, code: string, language?: "python" | "javascript" | "typescript") {
    return runComputer(this.env, botId, code, language);
  }

  writeFile(botId: string, path: string, content: string) {
    return writeComputerFile(this.env, botId, path, content);
  }

  readFile(botId: string, path: string) {
    return readComputerFile(this.env, botId, path);
  }

  destroy(botId: string) {
    return destroyComputer(this.env, botId);
  }

  sleep(botId: string) {
    return sleepComputer(this.env, botId);
  }

  codex(botId: string, authJson: string, prompt: string, model: string, effort?: CodexEffort) {
    return runCodex(this.env, botId, authJson, prompt, model, effort);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const auth = request.headers.get("authorization") ?? "";
    if (!env.MAGICBOT_COMPUTER_TOKEN || auth !== `Bearer ${env.MAGICBOT_COMPUTER_TOKEN}`) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/computer\/([\w-]+)\/(\w+)$/);
    if (!match) return json({ ok: false, error: "no route" }, 404);
    const [, botId, action] = match;

    try {
      const body: Record<string, unknown> = request.method === "POST"
        ? await request.json<Record<string, unknown>>().catch(() => ({}))
        : {};
      switch (action) {
        case "status": {
          const stub = workspaceStub(env, botId) as unknown as {
            computerStatus(): Promise<{ running: boolean; exit: unknown }>;
          };
          const state = await stub.computerStatus();
          return json({ ok: true, ready: true, backend: "cloudflare-computer", ...state });
        }
        case "exec":
          return json(await execComputer(env, botId, String(body.command ?? "")));
        case "run":
          return json(await runComputer(
            env,
            botId,
            String(body.code ?? ""),
            (body.language === "javascript" || body.language === "typescript" ? body.language : "python"),
          ));
        case "writeFile":
          return json(await writeComputerFile(env, botId, String(body.path ?? ""), String(body.content ?? "")));
        case "readFile":
          return json(await readComputerFile(env, botId, String(body.path ?? "")));
        case "destroy":
          return json(await destroyComputer(env, botId));
        case "sleep":
          return json(await sleepComputer(env, botId));
        case "expose":
          return json({ ok: false, error: "Public port sharing is not available on workers.dev." }, 409);
        default:
          return json({ ok: false, error: `unknown action: ${action}` }, 404);
      }
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
