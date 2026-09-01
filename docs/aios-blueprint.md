# MagicBots — AIOS Blueprint

MagicBots keeps OpenMausBot's **UI concept** (a Telegram-style roster where every
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
2. **Routines** ✅ — per-bot recurring scheduled tasks (`server/organs/routines.ts`).
   An in-harness scheduler tick fires due routines through `startTurn` (the same
   dispatch as a user message); REST CRUD + a UI section in ComputerPanel. Fills
   OpenMausBot's placeholder. Hosted: the tick becomes a Durable Object alarm,
   record shape unchanged.
3. **Cost receipt** ✅ — surface the `cost` already on `turn.completed` as a per-run
   receipt (outcome-per-credit), per AIOS token-economics direction.
4. **Governance gate** ✅ — a PreToolUse decision layer over the existing permission
   broker: sensitive actions require approval on unattended runs + an audit trail.
5. **Local-first connector data** ✅ — read-only inbox, calendar, CRM, and workspace
   queries can be stored as account-scoped snapshots, refreshed manually or on a
   bounded schedule, and retrieved through the shared context engine. Live actions
   remain behind the governance gate.
6. **Modules** ✅ — portable SKILL.md and versioned JSON packages install per bot, load only on explicit trigger matches, respect runtime capability availability, and remain bounded by the shared autonomy/tool-governance layer.
7. **Close day** ✅ — an account-level end-of-day ritual gathers completed priorities, task closeouts, and commitments into editable wins, lessons, and next priorities. One compact structured closeout becomes shared context for the next agent turn; raw chat history does not.
8. **7plan** ✅ — a weekly strategy ritual turns open priorities, recent daily lessons, task open loops, and commitments into bounded outcomes, focus areas, risks, deliberate tradeoffs, and five dated weekday plans. The latest plan is editable and shared with every bot as compact context.
9. **Decision journal + challenge** ✅ — structured choices preserve options, assumptions, the strongest opposing case, rationale, confidence, and review timing. A selected bot can red-team an exploration on demand; only decided or revisit records enter bounded shared context.
10. **Ingest + capture inbox** ✅ — pasted knowledge or safely fetched public HTTPS text retains title, source, and tags in a review inbox. Pending captures stay outside agent context; approval or correction creates bounded, user-verified workspace chunks with provenance and duplicate protection.
11. **Company context mount** ✅ — one structured account profile gives every hosted bot the same company identity, products, customers, strategy, differentiators, brand voice, verified facts, operating rules, and glossary. It is bounded shared context rather than a duplicated per-bot file.
12. **Specialist agent catalog** ✅ — 30 outcome-oriented roles across strategy, sales, finance/legal, engineering, communication, and personal bundles can be inspected and spawned from the responsive web library. Every bot receives a visible provider-neutral charter with deliverables and guardrails; portable JSON import/export preserves the role while tool recommendations never elevate permissions.
13. **Delegated work ledger** ✅ — hosted agents can receive outcome-based assignments with an explicit owner, bounded handoff context, expected output, lifecycle, retry path, and durable result. Delegates run as unattended work through the governance gate; every completed handoff becomes an attributable closed task on the receiving agent and an activity receipt in Today. This is the execution substrate for coordinator-driven automatic handoffs.
14. **Automatic coordinator handoffs** ✅ — coordinators receive a bounded roster of uniquely named peer agents and can create one explicit handoff per turn. A deterministic `/delegate Agent | outcome` command provides a reliable user path, while agent-generated control markers use the same durable ledger. Approval-gated peer communication waits in Today; approved or permitted work runs unattended, closes on the receiving agent, and is synthesized back into the coordinator's reply. A bot cannot claim that it delegated unless a real receipt was created, and unattended Codex work uses the interceptable hosted path so tool governance remains a hard gate.
15. **Multi-agent workflow orchestration** ✅ — the responsive Today builder chains up to eight specialist-owned outcomes into a durable dependency graph. Each ready step runs through the delegation ledger and receives only the shared goal plus completed prerequisite results; run and wall-time budgets bound execution. Workflows expose per-step ownership, progress, results, receipt linkage, stop-or-continue failure policy, cancellation, and branch-aware retry while preserving every receiving agent's closed task. The API accepts general DAGs; the mobile-first builder defaults to a clear sequential chain.
16. **Durable background workflow runtime** ✅ — starting a workflow returns immediately while atomically claimed agent steps continue without an open browser. One bounded step runs per invocation; the minute scheduler resumes the next dependency and reclaims interrupted 45-second leases. Receipts are linked to their workflow and step before model execution, recovered attempts are attributable, and aborted leases do not consume the run budget. The responsive ledger polls live while open and explicitly tells users they can leave safely.
17. **Coordinator completion briefs** ✅ — a successful multi-agent workflow remains running after its final specialist until a separate resumable coordinator stage produces one durable, decision-ready deliverable. The coordinator receives only the shared goal and bounded completed evidence, cannot use tools or delegate again, reconciles conflicts, preserves uncertainty, attributes important claims, records risks, and recommends the next action. Workflows without a coordinator receive a deterministic evidence rollup; the accessible mobile ledger distinguishes finalizing from completed and renders the final brief explicitly.
18. **Coordinator quality gates + bounded rework** ✅ — optional per-step acceptance criteria require a coordinator. Candidate work enters a durable reviewing state; only an explicit coordinator acceptance unlocks dependencies, while revision feedback returns to the same specialist as bounded context. Attempts are capped from one to three and consume the workflow run budget; exhaustion fails the branch. Coordinator reviews cannot use tools or delegate, and the mobile workflow ledger surfaces the criteria, attempt count, review state, and feedback.
19. **Scheduled + event-triggered workflows** ✅ — a workflow definition can run immediately, once at a local date and time, on selected weekdays, or from a signed HTTPS webhook. Triggers retain a reusable bounded template while every delivery creates a separate immutable workflow, step, review, and receipt history. The minute scheduler atomically claims due work; webhook delivery IDs are deduplicated, secrets are stored only as hashes, event payloads are size-bounded and explicitly marked untrusted, and triggers can be paused or resumed from the responsive workflow ledger.

## Cloud computer (Cloudflare) — `cf-computer/`

The hosted replacement for `box.ascii.dev`: a Worker + one Sandbox container per
bot (keyed by botId, disk persists across sleeps). Tier 1 (shell/code/files/
port-expose) is scaffolded and deployable in the user's own CF account; Tier 2
(the noVNC visual desktop) is documented, off by default — the only genuinely
custom infra, and it needs a wildcard-DNS custom domain for preview URLs. Wires
into the existing `integrations.computer` seam via a future `server/cfcomputer.ts`
sibling to `box.ts`; driver contract + UI unchanged.

## Target

**Mac-app-first** (Electron shell + local TS harness) — the simple path that keeps
subscriptions, and the AIOS blueprint's native shape. The organs live in the
target-agnostic TS harness, so wrapping the same harness in a Cloudflare Durable
Object + Container (for a hosted version with cloud computers) is a later
deployment phase, not a rewrite. Hosted-with-subscriptions requires Containers
(a Worker/DO alone can't run a CLI); hosted-with-API-keys would be simple but
violates the no-APIs rule — hence Mac-first.
