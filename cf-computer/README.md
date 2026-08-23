# OpenMausBot Cloud Computer (Cloudflare)

The primary hosted computer stack: a Cloudflare Worker fronting one
**Sandbox container per bot**. Each bot gets a durable Linux computer — shell,
code execution, files, and HTTP service exposure — keyed by its `botId`, so the
same bot always returns to the same machine (disk persists across sleeps).

This runs in **your own** Cloudflare account.

## What it gives a bot (Tier 1 — ready)

| Route (POST) | Does |
|---|---|
| `/computer/:botId/exec` `{command}` | Run a shell command → `{stdout, stderr, exitCode}` |
| `/computer/:botId/run` `{code, language}` | Run LLM code in the interpreter (python/js/ts) |
| `/computer/:botId/writeFile` `{path, content}` | Write a file |
| `/computer/:botId/readFile` `{path}` | Read a file |
| `/computer/:botId/expose` `{port}` | Expose an HTTP service → preview URL |
| `/computer/:botId/destroy` | Free the container immediately |

Every request needs `Authorization: Bearer <MAGICBOT_COMPUTER_TOKEN>`.

## Deploy

```sh
cd cf-computer
npm install
docker info                              # Docker required to build the image
wrangler secret put MAGICBOT_COMPUTER_TOKEN   # pick any strong string
wrangler deploy
```

Then in OpenMausBot's App Settings, set the cloud-computer endpoint to your
Worker URL and paste the same token. Bots with computer = cloud will use it.

## Tier 2 — the visual desktop ("watch it work / take over")

To add an optional live desktop you can watch and take over:

1. Uncomment the Xvfb + x11vnc + noVNC block in the `Dockerfile`.
2. In `src/index.ts`, on first use start the desktop (`exec` xvfb-run + a
   window manager + x11vnc + websockify) and `exposePort(6080)`.
3. Hand that preview URL to the UI as the "Open desktop" link; feed periodic
   screenshots into the chat stream.

**Requirement:** preview URLs need a **custom domain with wildcard DNS**
(`*.yourdomain.com`) — `.workers.dev` does not serve preview subdomains. This
desktop layer is the only genuinely custom infra; Tier 1 needs none of it.

## How it wires into the harness

The app mounts `server/cfcomputer.ts` as a direct MCP integration for the bot's
selected Claude or ACP engine. `server/index.ts` selects it for ordinary cloud
turns, scheduled routines, and webhooks. See `docs/aios-blueprint.md`.
