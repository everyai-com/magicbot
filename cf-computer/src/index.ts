// MagicBot cloud computer — a Cloudflare Worker fronting one Sandbox container
// per bot. This is the hosted replacement for box.ascii.dev: the MagicBot
// harness calls these routes instead of the Box API, and the driver seam in
// the app stays identical (run a command, read/write files, expose a service).
//
// Auth: every request carries `Authorization: Bearer <MAGICBOT_COMPUTER_TOKEN>`
// (a Worker secret). One shared token for your own fleet; swap for per-user
// tokens when this goes multi-tenant.
//
// Deploy:
//   cd cf-computer && npm install
//   wrangler secret put MAGICBOT_COMPUTER_TOKEN
//   wrangler deploy
import { getSandbox, Sandbox } from "@cloudflare/sandbox";
export { Sandbox }; // required re-export for the container class

interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  MAGICBOT_COMPUTER_TOKEN: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const auth = req.headers.get("authorization") ?? "";
    if (!env.MAGICBOT_COMPUTER_TOKEN || auth !== `Bearer ${env.MAGICBOT_COMPUTER_TOKEN}`) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const url = new URL(req.url);
    // routes are /computer/:botId/<action>; botId is the sandbox key so a bot
    // always gets the same durable computer (disk persists across sleeps).
    const m = url.pathname.match(/^\/computer\/([\w-]+)\/(\w+)$/);
    if (!m) return json({ ok: false, error: "no route" }, 404);
    const [, botId, action] = m;
    const sandbox = getSandbox(env.Sandbox, botId);

    try {
      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

      switch (action) {
        case "exec": {
          const { command } = body as { command?: string };
          if (!command) return json({ ok: false, error: "command required" }, 400);
          const r = await sandbox.exec(command);
          return json({ ok: r.success, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode });
        }
        case "run": {
          const { code, language = "python" } = body as { code?: string; language?: string };
          if (!code) return json({ ok: false, error: "code required" }, 400);
          const r = await sandbox.runCode(code, { language: language as "python" | "javascript" | "typescript" });
          // logs carry print()/console output — results alone lose them
          return json({ ok: true, results: r.results, logs: r.logs, error: r.error ?? null });
        }
        case "writeFile": {
          const { path, content } = body as { path?: string; content?: string };
          if (!path || content === undefined) return json({ ok: false, error: "path + content required" }, 400);
          await sandbox.writeFile(path, content);
          return json({ ok: true });
        }
        case "readFile": {
          const { path } = body as { path?: string };
          if (!path) return json({ ok: false, error: "path required" }, 400);
          const file = await sandbox.readFile(path);
          return json({ ok: true, content: file });
        }
        case "expose": {
          const { port } = body as { port?: number };
          if (!port) return json({ ok: false, error: "port required" }, 400);
          // preview URLs are served under the Worker's own hostname; needs a
          // custom domain with wildcard DNS for real subdomains (not .workers.dev)
          const { url: previewUrl } = await sandbox.exposePort(port, { hostname: url.hostname });
          return json({ ok: true, url: previewUrl });
        }
        case "destroy": {
          await sandbox.destroy();
          return json({ ok: true });
        }
        default:
          return json({ ok: false, error: `unknown action: ${action}` }, 404);
      }
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  },
};
