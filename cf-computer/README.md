# MagicBots Cloudflare Computer

The primary hosted computer stack, built on the official preview
[`@cloudflare/computer`](https://github.com/cloudflare/computer) package and
Cloudflare Browser Run. All bots share one SQLite-backed Durable Object
workspace, Linux runtime, browser profile, cookies, and signed-in sessions.
Each bot gets its own independently controlled browser page within that shared
profile, matching Grok Bot's shared-computer model.

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
| `/computer/:botId/browserOpen` `{url}` | Open a URL on the bot's browser page |
| `/computer/:botId/browserText` | Read visible page text |
| `/computer/:botId/browserSnapshot` | Read interactive elements and refs |
| `/computer/:botId/browserClick` `{ref}` | Click an element ref |
| `/computer/:botId/browserFill` `{ref,text}` | Fill an input ref |
| `/computer/:botId/browserScreenshot` | Capture the bot's browser page |
| `/computer/:botId/sleep` | Close that bot's browser page; keep shared state |
| `/computer/:botId/destroy` | Remove that bot's browser page; keep shared state |

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

Browser pages are controlled through Playwright and Browser Run. They share
authentication state but remain separate work surfaces; they are not security
boundaries. Passwords, 2FA, CAPTCHAs, payments, and identity checks should use
the application's human-takeover flow.

## How it wires into the harness

The app mounts `server/cfcomputer.ts` as a direct MCP integration for the bot's
selected Claude or ACP engine. `server/index.ts` selects it for ordinary cloud
turns, scheduled routines, and webhooks. See `docs/aios-blueprint.md`.
