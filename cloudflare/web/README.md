# MagicBot Web

The hosted MagicBot entry point runs entirely on Cloudflare:

- Worker static assets serve the existing React interface.
- D1 stores accounts, sessions, bot tasks, rooms, memory, routines, webhooks, and isolated transcripts.
- R2 stores per-user image and file attachments.
- Workers AI powers hosted chat without exposing desktop CLI credentials.
- Workers AI also provides generated images, avatars, and Aura speech.
- A private service binding gives each bot a persistent, headless Cloudflare Sandbox computer.
- A private broker binding enables Composio OAuth and MCP tools when a user adds their own project key.
- A cron trigger runs due routines every minute.
- Secure HTTP-only cookies, same-origin mutation checks, and account/chat rate limits protect the public routes.

The web API also supports message branches and reactions, conversation search/export, community and GitHub team import, project scouting, inspector events, and public credentialed webhook ingress.

Deploy from the repository root:

```sh
pnpm web:migrate
pnpm web:deploy
```

Connected-app OAuth uses the private `cloudflare/composio-broker` Worker. Each user can add or remove a Composio project key from web settings. Keys are encrypted with AES-GCM under the `CREDENTIAL_KEY` Worker secret, are write-only to the browser, and remain isolated per account.

Native-only integrations—USB phone control, direct control of the visitor's macOS/Windows desktop, local VM management, and local CLI installation—remain desktop features. Their hosted equivalents are R2 files, browser speech input, Workers AI, community/GitHub team loading, and the isolated Cloudflare Sandbox computer.
