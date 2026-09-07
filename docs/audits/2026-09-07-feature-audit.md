# MagicTeams feature audit — 7 September 2026

## Verdict

The application is not verified as fully working. Several settings are persistence-only, and hosted call behavior cannot be established from the local repository alone. This audit reviews the current working tree, including changes already present before the audit. Passing unit tests below do not certify live provider behavior.

## Feature findings

| Feature | Finding | Evidence |
|---|---|---|
| Knowledge base | Partial implementation. Local routes save hosted knowledge and create an Ultravox corpus, but the returned corpus ID is only recorded in local profile metadata. No code here sends that ID to the hosted agent or registers its retrieval tool. The remote sync implementation is outside this repository. | `server/index.ts` knowledge-base POST; `server/ultravox.ts:createKnowledgeCorpus`; `SettingsPanel.tsx:addKnowledge` |
| Knowledge documents | TXT, MD and DOCX extraction exists. PDF and other formats have no extractor. Previously unsupported files could be saved as names with no document content. The UI now rejects unreadable/unsupported files before sending the create request. | `SettingsPanel.tsx:prepareKnowledgeFile`, `addKnowledge` |
| Call forwarding | Hosted create/delete/list and agent sync requests exist. Local-only bots store text without executing transfers. The UI now displays sync errors returned after successful hosted mutations. Actual transfer execution requires a hosted test call. | `SettingsPanel.tsx:addForwardingNumber`; `server/index.ts` call-forwarding routes |
| Appointment tools | Hosted CRUD and sync requests exist; local-only configuration is text. No live availability, booking, cancellation or calendar write was performed. Save/delete sync errors are now shown. | `SettingsPanel.tsx:addAppointmentTool`; `server/index.ts` appointment-tools routes |
| Custom tools | Incomplete. The wizard appends a formatted string to `agentConfig.customTools`. No consumer in the server registers an executable HTTP tool, schemas or call-agent tool definition from that field. | `SettingsPanel.tsx:createCustomTool`; repository references to `customTools` |
| Custom CRM | Incomplete. Provider selection and email templates are stored in `agentConfig.customCrm`. No server consumer executes CRM writes or emails from this field. | `SettingsPanel.tsx:addCustomCrmProvider`, `saveEmailTemplate`; repository references to `customCrm` |
| Connected API tool calling | Incomplete for `analysis-api`. This driver sends text completion requests and reads text responses. It declares no MCP/agent-tool capability, sends no tools, and has no tool-result execution loop. Other CLI drivers have separate tool implementations. | `server/drivers/analysis-api.ts:complete`, `AnalysisApiDriver` |
| Integrations | Catalog and connected-account code exists; focused connector tests pass. Prior loading fix adds catalog timeout/retry and removes the account-status wait. The broker's separate suite has a failing authorization fixture that needs investigation. | `PluginsPanel.tsx`; `server/composio.ts`; broker test log |
| Incoming task webhooks | Local implementation and focused tests pass, including authentication, deduplication, verification, malformed requests, rotation and limits. Public ingress and real provider deliveries were not exercised. | `server/webhooks.test.ts`; `server/webhook-ingress.test.ts` |
| Call-event webhooks | Hosted CRUD and sync routes exist. Real call-event delivery, payloads and remote retry behavior are not verified. This is separate from incoming task webhooks. | `server/index.ts` platform agent webhooks routes |
| Call configuration | Model, temperature and first speaker are saved locally but not consumed by the call request path. Demo-call UI sends voice/duration, but the primary hosted branch forwards only `agent_id`; those overrides reach only the direct fallback. | `CallView.tsx` demo-call POST; `server/index.ts` demo-call handler |
| Hosted web parity | The Cloudflare web handler does not implement the local platform forwarding, knowledge and appointment route set. Demo-call routes are present. Deploying the same UI against that handler requires route parity work. | `cloudflare/web/src/index.ts` |
| Routines | Focused local scheduler tests pass. Production scheduling depends on deployment and configured execution providers. | `server/routines.test.ts` |
| App startup/build | Local health responds; frontend and backend type checks and production build pass. Some HTTP smoke assertions fail; full results recorded below. | audit logs |

## Fixes made in this audit

`src/components/SettingsPanel.tsx` was changed for feature behavior: unreadable knowledge uploads fail explicitly; hosted forwarding and appointment create/update/delete responses surface `syncError`. The credential-name masking list in `electron/diagnostics.mjs` was also brought into parity with the server after the regression test identified missing provider names. These fixes do not implement the missing tools, CRM execution or remote retrieval linkage.

## Validation and limits

- Focused features: 54 tests passed across 8 files.
- Type checking passed before and after the fixes.
- Production build passed (large bundle warning).
- Updater: 15 tests passed. Desktop viewer: 5 tests passed.
- Packaged server: started without node_modules; all 9 spawned proxy paths resolved.
- Lint failed with extensive repository-wide anti-slop violations (2,179 matching error lines); this is not a clean lint baseline.
- Broker: 6 tests passed, 1 failed: authorization test fixture lacks `SESSION_LIMITER` when it reaches `ensureSession`. The deployment config does declare that binding, so this failure alone does not prove a production outage.
- Broad suite on Node 24: 156 test files collected, 154 passed and 2 failed; 1,572 tests passed, 1 failed and 15 skipped. The failure was diagnostics credential-name parity (subsequently fixed and retested). `server/unattended.test.ts` failed its startup hook because its test server did not become ready. Seven slower server suites were excluded from this broad run; it is not a full-suite pass.
- Separately, the HTTP suite produced 35 passing and 5 failing test results before it was stopped after repeated slow operations/timeouts. Failures: starter greeting assumption; Chief-of-Staff election timeout; project team import timeout; additive team import timeout; fork/unavailable-provider assertion (200 versus expected 404). No complete HTTP-suite verdict is claimed.
- The original combined `pnpm test` run was interrupted, so its global test-count floor was not completed. Focused and broad counts overlap and must not be added together.
- Final diagnostics retest: all 32 tests passed after the masking-list fix.

Tests use temporary app data. No real calls, messages, CRM writes, bookings, webhook deliveries or provider connection changes were initiated. The available browser session requires sign-in for authenticated feature testing. The repository does not contain the hosted voice API's implementation, so remote sync and execution cannot be certified by this audit.

## Required follow-up work

1. Implement executable custom-tool and CRM registration, with mocked contract tests and controlled live verification.
2. Link knowledge corpora to the hosted call agent and verify retrieval with a known test fact.
3. Carry call settings through the hosted API contract and add local/Cloudflare route parity.
4. Reconcile failing tests and lint, then verify transfers, appointment lifecycle and call-event webhooks on a designated test agent.
