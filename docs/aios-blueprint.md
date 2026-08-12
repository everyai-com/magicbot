# MagicBot — AIOS Blueprint

MagicBot keeps OpenMausBot's **UI concept** (a Telegram-style roster where every
chat is a real agent) and its clean **TS driver/event core**, but rebuilds the
*substance* on the AIOS blueprint. Decided 2026-08-12.

## What we keep vs. rebuild

| Layer | Source | Direction |
|---|---|---|
| React chat UI (sidebar, chat view, model picker, approval cards) | OpenMausBot | **Keep** — the concept we're borrowing |
| TS driver SPI + canonical `RuntimeEvent` bus | OpenMausBot | **Keep** — good bones; adding a provider stays one file |
| Providers on the user's own subscriptions (claude/codex/pi CLIs) | Both | **Keep + extend** — no API keys; pi driver next |
| The "organs" below | AIOS Desktop | **Transplant** — this is the rebuild |

## AIOS organs (transplant order)

1. **Memory** ✅ — per-bot durable facts (`memory-<botId>.json`), injected into the
   system prompt every turn; the bot writes with `[REMEMBER: …]` markers the
   harness extracts + strips. Mirrors AIOS `AIOS_REMEMBER → store → injected block`.
   Driver-agnostic (`server/organs/memory.ts`).
2. **Cost receipt** — surface the `cost` already on `turn.completed` as a per-run
   receipt (outcome-per-credit), per AIOS token-economics direction.
3. **Governance gate** — a PreToolUse decision layer over the existing permission
   broker: sensitive actions require approval on unattended runs + an audit trail.
4. **Local-first connector data** — sync the few things users ask about (inbox,
   calendar) into local snapshots the agent reads instantly; actions stay live.
5. **Modules** — the AIOS module/skill format so starter kits install into a bot.

## Target

**Mac-app-first** (Electron shell + local TS harness) — the simple path that keeps
subscriptions, and the AIOS blueprint's native shape. The organs live in the
target-agnostic TS harness, so wrapping the same harness in a Cloudflare Durable
Object + Container (for a hosted version with cloud computers) is a later
deployment phase, not a rewrite. Hosted-with-subscriptions requires Containers
(a Worker/DO alone can't run a CLI); hosted-with-API-keys would be simple but
violates the no-APIs rule — hence Mac-first.
