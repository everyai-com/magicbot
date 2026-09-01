# Web-first context engine

## Decision

MagicTeams should not attach the same growing Markdown file to every bot. The hosted web app now uses a shared context contract with scoped records and bounded retrieval. A turn receives only its active task summary, relevant user/workspace/bot/task/room records, the active message branch, and optional user-managed bot notes.

## Web implementation (now)

- D1 stores durable `context_items` and compact `task_summaries`.
- Every hosted model path—Cloudflare AI, hosted Codex, and Claude—uses the same resolver.
- Retrieval is scope-filtered first, then relevance-ranked, and capped before prompt construction.
- Edited conversations follow `parentId` from the active leaf, so abandoned branches do not leak into prompts.
- Post-turn work runs through `ExecutionContext.waitUntil`; replies do not wait for indexing.
- Only explicit phrases such as “remember…” or “I prefer…” become durable cross-bot memory. Other turn content stays in the task summary.
- Legacy bot Markdown remains readable and is injected with a hard size cap while users migrate.
- `GET /api/bots/:botId/context` exposes the active task summary and visible scoped records for a future inspector UI.
- `DELETE /api/bots/:botId/context/:itemId` provides a user-controlled forget operation.
- Chat edits, room replies, manual routines, scheduled routines, and webhook-triggered routines all use the same resolver/update path.

## Permission-aware knowledge sources

- Bot profiles expose a hosted-only **Knowledge sources** card.
- Users can explicitly index text/code/JSON/CSV/XML/YAML files up to 2 MB.
- GitHub, email, Drive, Slack, and other connected services share the connector MCP ingestion path.
- Only connector tools whose names declare `GET`, `LIST`, `SEARCH`, `FETCH`, or `READ` are eligible. Arguments containing password, secret, token, API-key, authorization, or cookie fields are rejected.
- Source content is chunked in background work, tagged with its bot/task/user/room scope, and retrieved through the same bounded resolver.
- Each source records sync state, errors, chunk count, and last-sync time. Users can refresh or remove it; removal deletes its indexed chunks, not the original external data.
- The first release intentionally excludes binary PDF, Word, and spreadsheet parsing. Those formats should use dedicated extractors before being admitted to durable context.

## Electron and other runtimes (next)

Keep `ContextCandidate`, scope names, ranking, active-branch selection, and rendered prompt semantics identical. Replace only the storage adapter:

| Runtime | Storage adapter | Background work | Model adapter |
| --- | --- | --- | --- |
| Hosted web | Cloudflare D1 | `waitUntil` | Workers AI / hosted Codex / Claude |
| Electron (macOS, Windows, Linux) | local SQLite | worker thread or idle queue | existing local provider router |
| Mobile/companion | server context API with local cache | platform background task | hosted router |
| Self-hosted server | PostgreSQL or SQLite | durable job queue | configured providers |

Electron adoption phases:

1. Move the pure context contract into `shared/context` and add a SQLite repository implementing the same queries.
2. Import existing per-bot Markdown as `bot`-scoped, user-managed records; never duplicate it per task.
3. Route every desktop provider through the shared resolver before inference.
4. Add a context inspector with source, scope, edit, forget, and “remember for this task/bot/everywhere” controls.
5. Add optional embeddings behind the repository interface only after lexical retrieval metrics show a need. Graph relations can be a second-stage index; they should not be the source of truth.

## Guardrails and metrics

Track resolved character/token count, retrieval latency, selected scopes, cache hit rate, summary age, and user corrections. Never persist secrets or assistant guesses as memory. Apply expiry to temporary facts and provide deletion/export before enabling broader automatic extraction.
