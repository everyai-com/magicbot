# MagicBot Web

The hosted MagicBot entry point runs entirely on Cloudflare:

- Worker static assets serve the existing React interface.
- D1 stores accounts, sessions, bot tasks, rooms, memory, routines, webhooks, and isolated transcripts.
- R2 stores per-user image and file attachments.
- Workers AI powers hosted chat without exposing desktop CLI credentials.
- A private service binding gives each bot a persistent, headless Cloudflare Sandbox computer.
- A cron trigger runs due routines every minute.
- Secure HTTP-only cookies, same-origin mutation checks, and account/chat rate limits protect the public routes.

The web API also supports message branches and reactions, conversation search/export, team import/export, inspector events, and public credentialed webhook ingress.

Deploy from the repository root:

```sh
pnpm web:migrate
pnpm web:deploy
```

Connected-app OAuth uses the `cloudflare/composio-broker` Worker. Deploy that Worker with a `COMPOSIO_API_KEY`, then restore its `CONNECTORS` service binding in `wrangler.jsonc` to enable live app connections. Without that external credential the web UI safely shows the curated catalog as unavailable.

Native-only integrations—USB phone control, a local macOS/Windows computer, local VM management, CLI installation, and local provider sessions—remain desktop features. The hosted equivalents are R2 files, browser speech input, Workers AI, and the isolated Cloudflare Sandbox computer.
