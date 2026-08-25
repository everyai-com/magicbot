# MagicBots Cloudflare Computer

The primary hosted computer stack, built on the official preview
[`@cloudflare/computer`](https://github.com/cloudflare/computer) package. Each
bot gets a SQLite-backed Durable Object workspace plus a private Linux runtime.
The workspace is keyed by `botId`, so files survive container restarts and
remain isolated between bots.

Cloudflare currently marks this package preview-only. MagicBots pins the version
and keeps the existing web/service API small so upgrades stay contained here.

This runs in **your own** Cloudflare account.

## What it gives a bot (Tier 1 — ready)

| Route (POST) | Does |
|---|---|
| `/computer/:botId/exec` `{command}` | Run a shell command → `{stdout, stderr, exitCode}` |
| `/computer/:botId/run` `{code, language}` | Run LLM code in the interpreter (python/js/ts) |
| `/computer/:botId/writeFile` `{path, content}` | Write a file |
| `/computer/:botId/readFile` `{path}` | Read a file |
| `/computer/:botId/sleep` | Stop the Linux runtime; keep the workspace |
| `/computer/:botId/destroy` | Delete the runtime and durable workspace |

Every request needs `Authorization: Bearer <MAGICBOT_COMPUTER_TOKEN>`.

## Deploy

```sh
cd cf-computer
npm install
docker info                              # Docker required to build the image
wrangler secret put MAGICBOT_COMPUTER_TOKEN   # pick any strong string
wrangler deploy
```

Then in MagicBots' App Settings, set the cloud-computer endpoint to your
Worker URL and paste the same token. Bots with computer = cloud will use it.

Public port sharing and an interactive desktop are intentionally not advertised
on `workers.dev`. The default computer is a persistent, headless agent workspace.

## How it wires into the harness

The app mounts `server/cfcomputer.ts` as a direct MCP integration for the bot's
selected Claude or ACP engine. `server/index.ts` selects it for ordinary cloud
turns, scheduled routines, and webhooks. See `docs/aios-blueprint.md`.
