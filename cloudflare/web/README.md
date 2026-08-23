# MagicBot Web

The hosted MagicBot entry point runs entirely on Cloudflare:

- Worker static assets serve the existing React interface.
- D1 stores accounts, sessions, and isolated bot transcripts.
- Workers AI powers hosted chat without exposing desktop CLI credentials.
- Secure HTTP-only cookies, same-origin mutation checks, and account/chat rate limits protect the public routes.

Deploy from the repository root:

```sh
pnpm web:migrate
pnpm web:deploy
```

The hosted product intentionally does not expose desktop-only features such as local files, native computer control, CLI installation, or local provider sessions. Those continue to run in the desktop app. New hosted capabilities should be backed by a per-user Cloudflare resource rather than sharing the desktop harness data directory.
