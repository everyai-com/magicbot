# MagicBot — AIOS Blueprint

MagicBot keeps OpenMausBot's **UI concept** (a Telegram-style roster where every
chat is a real agent) and its clean **TS driver/event core**, but rebuilds the
*substance* on the AIOS blueprint. Decided 2026-08-12.

> **Updated 2026-08-24, after the upstream sync.** Between 2026-08-12 and the
> sync, upstream landed ~654 commits that include first-class implementations of
> organs 1 and 2. We deleted our `server/organs/` transplants rather than ship
> two competing memory/routine/delegation systems — see *Organ status* below for
> where each capability now lives. The parts upstream now covers are simply no
> longer ours to build.
>
> The **Target** also flipped in the same window: this fork is **web-first**, not
> Mac-app-first as originally written. See *Target* below — it changes which
> organ is on the critical path (`cf-computer/`), not what the organs are.

## What we keep vs. rebuild

| Layer | Source | Direction |
|---|---|---|
| React chat UI (sidebar, rooms/sections, chat view, model picker, approval cards) | OpenMausBot | **Keep** — the concept we're borrowing |
| TS driver SPI + canonical `RuntimeEvent` bus | OpenMausBot | **Keep** — good bones; adding a provider stays one file |
| Providers on the user's own subscriptions (claude/codex/pi/cursor/opencode CLIs) | Both | **Keep** — no API keys required |
| Memory, routines, peer delegation | OpenMausBot | **Adopt upstream** — it got there first and richer |
| Cloud computer on the user's own Cloudflare account | MagicBot | **Ours** — upstream has no equivalent |
| Cost receipts, governance gate, local-first connector data, modules | AIOS Desktop | **Still to transplant** |

## Organ status

1. **Memory** — *now upstream's.* Every bot keeps an editable `MEMORY.md` plus
   `memory/<topic>.md` files under its workspace, injected via
   `memorySystemPrompt()` in `server/index.ts` and editable from the UI. This is
   a strict superset of our `[REMEMBER: …]`-marker organ (inspectable and
   correctable by the user, topic-scoped, not a hidden JSON blob), so the organ
   was removed in the sync. Historical implementation: commit `4c6156b`.
2. **Routines** — *now upstream's.* `server/routines.ts` carries a richer record
   shape than ours did (`once` / `daily` with weekdays, and a `cloud` mode that
   runs the agent inside the bot's Box VM) plus its own UI. Our in-harness tick
   organ was removed in the sync. Historical implementation: commit `c9ab37b`.
3. **Delegation** — *now upstream's.* `server/delegations.ts` (async
   `delegate_bot` handoffs, drained on `turn.completed`) and
   `server/chief-of-staff.ts` (a section-scoped Chief with the team roster in
   its system prompt) supersede our `[DELEGATE: …]`-marker organ. Upstream's
   version adds visibility mirroring, an approval gate, and a depth cap our
   hop counter approximated. Historical implementation: commit `bac2b68`.
4. **Cost receipt** — surface the `cost` already on `turn.completed` as a per-run
   receipt (outcome-per-credit), per AIOS token-economics direction. *Open.*
5. **Governance gate** — a PreToolUse decision layer over the existing permission
   broker: sensitive actions require approval on unattended runs + an audit
   trail. *Partly upstream now* — see `server/auto-approve.ts` and
   `server/decision-log.ts`; the unattended-run policy is still open.
6. **Local-first connector data** — sync the few things users ask about (inbox,
   calendar) into local snapshots the agent reads instantly; actions stay live.
   *Open.*
7. **Modules** — the AIOS module/skill format so starter kits install into a bot.
   *Partly upstream now* — see `server/skills.ts` and the skills UI.

## Cloud computer (Cloudflare) — `cf-computer/`

The hosted replacement for `box.ascii.dev`: a Worker + one Sandbox container per
bot (keyed by botId, disk persists across sleeps). Tier 1 (shell/code/files/
port-expose) is deployed and verified in the user's own CF account; Tier 2
(the noVNC visual desktop) is documented, off by default — the only genuinely
custom infra, and it needs a wildcard-DNS custom domain for preview URLs.

This is the one organ upstream has no counterpart for. Upstream's cloud story is
Box (`server/box.ts`), a VPS over SSH (`server/vps.ts`), and a local container VM
(`server/container-computer.ts`); its only Cloudflare Worker is the Composio
broker. `server/cfcomputer.ts` is the harness client, sibling to `box.ts`, and
`GET /api/cfcomputer` + `POST /api/cfcomputer/test` confirm a deployment.

**Remaining wire:** route an agent's computer tools through cfcomputer by
mounting it at the `integrations.localComputer` seam in `server/index.ts`
(alongside `containerComputerMcp` and the VPS mount), so a configured Cloudflare
computer becomes a selectable destination rather than only a verifiable one.

## Target

**Web-first.** The hosted web app is the product; the Electron shell is a
secondary target that ships from the same tree. Reversed from the original
2026-08-12 entry, which called this Mac-app-first — that call is superseded.

The reasoning that pointed at Mac-first was: hosted-with-subscriptions needs
Containers, because a Worker or Durable Object alone cannot run a CLI, and
hosted-with-API-keys would violate the no-APIs rule. That constraint is real
and unchanged — but `cf-computer/` is the answer to it, which moves it from a
blocker to a dependency. Web-first therefore makes `cf-computer/` the
load-bearing piece of this blueprint rather than a side quest, and its
**Remaining wire** above (mounting cfcomputer at the `integrations.localComputer`
seam) becomes the critical path, not a nice-to-have.

What still holds from the original entry: the organs live in the
target-agnostic TS harness, so the harness runs unchanged whether it is hosted
behind a Durable Object or spawned by Electron. Web-first is a change of
priority, not a rewrite.

### What this means for the upstream sync

The 2026-08-24 sync inherited a lot of desktop weight — Windows and Linux
packaging workflows, `electron-builder.yml`, the iOS companion, native speech
and recorder helpers. None of it is on the web-first path, and all of it is
maintained upstream, so it costs nothing to carry and would cost real conflict
surface to strip on every future sync. It stays. Treat it as inherited, not as
roadmap.

Hosted web work in flight lives on `codex/upstream-openmaus-update` (hosted
chat, hosted engines on Cloudflare Computer, custom domain, browser login).
That branch merged an *older* upstream and dropped the MagicBot branding, so
reconciling it with this sync is its own task — see the sync PR for the
comparison.
