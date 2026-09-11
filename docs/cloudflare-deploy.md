# Hosted MagicBots on your own Cloudflare account

One command provisions a private MagicBots stack — web app, Composio broker,
and cloud computer — on your Cloudflare account. No Cloudflare dashboard
clicking, no hand-written IDs.

```sh
git clone https://github.com/everyai-com/magicbot && cd magicbot
pnpm install
wrangler login
pnpm deploy:cloud
```

Re-running later is safe: it reuses what exists and only fills in what is
missing. To update, `git pull` and run it again.

## Options

```sh
pnpm deploy:cloud -- --dry-run        # print every command without running it
pnpm deploy:cloud -- --skip-computer  # web + broker only (no paid plan needed)
pnpm deploy:cloud -- --yes            # never prompt; generate what's missing
```

## What it creates

| Resource | Name | Notes |
|---|---|---|
| Worker | `magicbot-web` | The app, on a `workers.dev` URL |
| Worker | `magicbot-composio` | Per-installation Composio sessions |
| Worker + container | `magicbot-cf-computer` | One Linux workspace per bot |
| D1 | `magicbot-web`, `magicbot-composio` | Accounts, transcripts, sessions |
| R2 | `magicbot-web-files` | Image and file attachments |
| Secrets | `CREDENTIAL_KEY`, `MAGICBOT_COMPUTER_TOKEN` | Generated; kept on re-runs |
| Secret | `COMPOSIO_API_KEY` (broker) | Optional — prompted, or users add their own key in web settings |

Per-account IDs go into gitignored `wrangler.deploy.jsonc` files. The
committed `wrangler.jsonc` files describe EveryAI's own production stack and
are never modified.

## Cost

Web + broker + D1 + R2 fit comfortably in Cloudflare's free tier for personal
use. Two things cost money:

- **Cloud computer** — containers require a paid Workers plan. Use
  `--skip-computer` to deploy without it; computer features report as
  unavailable until you re-run on a paid plan.
- **Workers AI** — hosted chat runs on Workers AI and bills per request.
  Desktop chat (local CLIs) is unaffected.

## After the deploy

- **Custom domain** — add a `routes` entry to your `wrangler.deploy.jsonc`
  (or attach the domain in the dashboard) and re-run.
- **Password-reset email** — the deploy omits the email binding. To enable
  resets, verify a sender address (Email Routing → Email Workers) and add a
  `send_email` binding plus your sender to the web deploy config.
- **Locking registration** — the broker ships with `REGISTRATION_MODE: open`.
  Set it to `closed` in the broker deploy config and re-run to stop issuing
  new installation tokens.
- **Tear down** — `wrangler delete`, `wrangler d1 delete`, and
  `wrangler r2 bucket delete` per resource, or delete the workers from the
  dashboard.

## Manual path

If you prefer each step by hand: `pnpm build`, then for each worker create
the D1/R2 resources above, apply that worker's `migrations/` with
`wrangler d1 migrations apply <name> --remote`, set the secrets from the
table, and `wrangler deploy`. The deploy script is that checklist, automated.
