// AIOS organ #4 — the governance gate: a hard approval lock over sensitive
// actions, plus an append-only audit trail.
//
// Ported from AIOS Desktop's `governance.py` (PreToolUse hook) — the model,
// not the mechanics. There the lock is a Claude Code hook a bypassPermissions
// run cannot escape; here it is a decision layer the harness applies to every
// permission ask before the existing broker (server/permission-proxy.ts) ever
// shows an Allow/Deny card. The gap it closes: the broker turns risky actions
// into a card in chat, which works only when a human is watching. Routine-fired
// (organs/routines.ts) and delegation-fired (organs/delegation.ts) turns run
// with nobody there — a card either sits unanswered for 15 minutes or gets
// answered by nobody at all, and until now the CLI's own permission mode was
// the only thing standing between an unattended run and a sent email.
//
// The rules, in three lines:
//   • attended turns  → untouched; today's broker flow is the gate (we audit).
//   • unattended turns → sensitive actions are DENIED and HELD as a pending
//     approval; the agent is told to stop and not retry.
//   • an approval grants exactly one fingerprint, once, and the held turn is
//     re-run — still unattended, so anything ELSE it tries is gated again.
//
// Fail-closed: on an unattended run an action we cannot prove safe is treated
// as sensitive ("unknown"). A permission ask only reaches us because the CLI's
// own permission mode refused to auto-allow it, so "unrecognised" is already a
// suspicious signal — the safe default is to hold it for a human.
//
// Driver-agnostic: it hangs off the canonical `request.opened` event and the
// adapter's respondToRequest, so any driver with the request/approval seam is
// covered without a per-driver change.
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { DATA_DIR } from "../config.ts";

// ── action classes ───────────────────────────────────────────────────────
// The sensitive classes, tightest-first: a slug like STRIPE_CREATE_PAYMENT is
// payment, not "external_write", so classification order is load-bearing.
export type ActionClass =
  | "payment" // moves money
  | "credential" // reads secrets/keys/tokens
  | "delete" // destroys data (remote or local)
  | "destructive_shell" // shell that leaves this machine or can't be undone
  | "external_send" // sends/posts to another human or service
  | "external_write" // otherwise mutates an external service
  | "unknown" // could not be proven safe → gated on unattended runs
  | "safe"; // read-only / local work product

export interface ClassifiedAction {
  sensitive: boolean;
  actionClass: ActionClass;
  /** one human-readable line for the approval card + audit row */
  summary: string;
  /** stable id for "this exact action" — what an approval grants */
  fingerprint: string;
}

// Verb-bearing connector slugs (Composio/MCP): GMAIL_SEND_EMAIL,
// SLACK_SENDS_A_MESSAGE, GITHUB_DELETE_REPO. A verb match is a reliable
// "this changes the world" signal.
const SLUG_PAYMENT = /(PAY|PAYMENT|CHARGE|TRANSFER|REFUND|INVOICE|PAYOUT|SUBSCRIPTION|CHECKOUT)/i;
const SLUG_CREDENTIAL = /(SECRET|CREDENTIAL|PASSWORD|API_?KEY|ACCESS_?TOKEN|PRIVATE_?KEY)/i;
const SLUG_DELETE = /(DELETE|REMOVE|TRASH|DESTROY|PURGE|REVOKE|ARCHIVE)/i;
const SLUG_SEND = /(SEND|POST|PUBLISH|REPLY|EMAIL|MESSAGE|TWEET|INVITE|SHARE|BROADCAST|NOTIFY)/i;
const SLUG_WRITE =
  /(CREATE|UPDATE|EDIT|WRITE|UPLOAD|MERGE|CLOSE|MOVE|ASSIGN|SCHEDULE|CANCEL|ADD_|_ADD|SET_|IMPORT|INSERT|PATCH)/i;

// Shell. Local read-only work (ls/cat/grep, git status/diff/log, a script that
// just computes) stays out of the way; these are the lines you cannot un-cross.
const SHELL_PATTERNS: Array<[RegExp, ActionClass]> = [
  [/\b(stripe|paypal)\b/i, "payment"],
  [/\bcat\b[^|;&]*(\.env|\.pem|id_rsa|id_ed25519|credentials|\.npmrc|\.netrc|secrets?\.(json|ya?ml))/i, "credential"],
  [/\b(security\s+find-(generic|internet)-password|keychain)\b/i, "credential"],
  [/\bprintenv\b|\benv\s*\|/i, "credential"],
  [/\brm\s+-[a-zA-Z]*[rf]/i, "delete"],
  [/\b(dropdb|drop\s+(table|database))\b/i, "delete"],
  [/\bgit\s+(push|reset\s+--hard|clean\s+-[a-z]*f)/i, "destructive_shell"],
  [/\b(mkfs|fdisk|diskutil\s+erase|dd\s+if=)/i, "destructive_shell"],
  [/\bkill(all)?\s/i, "destructive_shell"],
  [/:\(\)\s*\{.*\}\s*;\s*:/, "destructive_shell"],
  [/\b(ssh|scp|rsync)\s/i, "destructive_shell"],
  [/\bsudo\s/i, "destructive_shell"],
  [/\bchmod\s+(-R\s+)?777\b/i, "destructive_shell"],
  [/\b(npm|pnpm|yarn)\s+publish\b/i, "external_send"],
  [/\bgh\s+(pr|issue|release|repo|gist)\s+(create|close|merge|delete|edit|comment)/i, "external_send"],
  [/\bcurl\b[^|;&]*(-X\s*(POST|PUT|DELETE|PATCH)|--data|\s-d\s|--upload-file|\s-T\s)/i, "external_send"],
  [/\bwget\b[^|;&]*(--post-data|--post-file|--method=(POST|PUT|DELETE))/i, "external_send"],
  [/\b(mail|sendmail|mutt|osascript[^|;&]*Mail)\b/i, "external_send"],
];

// Shell we can positively prove is read-only — the only way a Bash ask gets
// out of the fail-closed "unknown" bucket on an unattended run.
const SHELL_READONLY =
  /^\s*(ls|pwd|cat|head|tail|wc|grep|rg|find|which|echo|date|whoami|file|stat|du|df|tree|sed\s+-n|awk|jq|node\s+-v|python3?\s+-V|npm\s+(ls|view|outdated)|pnpm\s+(ls|why)|git\s+(status|diff|log|show|branch|remote\s+-v|rev-parse))\b/i;

// Tools that only read. Everything else that reaches the broker is unknown.
const READ_ONLY_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "NotebookRead",
  "WebSearch",
  "WebFetch",
  "TodoWrite",
  "Task",
]);

// Paths whose contents are credentials by construction.
const SECRET_PATH = /(\.env(\.|$)|\.pem$|id_rsa|id_ed25519|\/\.ssh\/|\/\.aws\/credentials|\.netrc|\.npmrc|credentials\.json|\.keychain)/i;

const SENSITIVE_CLASSES: ReadonlySet<ActionClass> = new Set<ActionClass>([
  "payment",
  "credential",
  "delete",
  "destructive_shell",
  "external_send",
  "external_write",
  "unknown",
]);

const fingerprint = (...parts: string[]) =>
  createHash("sha1").update(parts.filter(Boolean).join("|").replace(/\s+/g, " ")).digest("hex").slice(0, 16);

/** Pull the connector slug(s) out of a Composio/MCP execute call — the real
 *  operation lives inside the input (GMAIL_SEND_EMAIL), not in the wrapper. */
function connectorSlugs(input: Record<string, unknown>): string[] {
  const slugs: string[] = [];
  const one = (d: unknown) => {
    if (!d || typeof d !== "object") return;
    for (const key of ["tool_slug", "toolSlug", "tool_name", "toolName", "tool", "slug", "action", "arguments"]) {
      const v = (d as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim()) {
        slugs.push(v.trim());
        return;
      }
    }
  };
  one(input);
  for (const key of ["tools", "tool_calls", "toolCalls", "actions", "requests", "items"]) {
    const seq = input[key];
    if (Array.isArray(seq)) for (const item of seq) one(item);
  }
  return slugs;
}

function classifySlug(text: string): ActionClass {
  if (SLUG_PAYMENT.test(text)) return "payment";
  if (SLUG_CREDENTIAL.test(text)) return "credential";
  if (SLUG_DELETE.test(text)) return "delete";
  if (SLUG_SEND.test(text)) return "external_send";
  if (SLUG_WRITE.test(text)) return "external_write";
  return "safe";
}

/** Decide what a pending tool call is. `summary` is the broker's one-liner,
 *  used as a fallback when the driver gave us no structured input. */
export function classify(tool: string, input: unknown, summary?: string): ClassifiedAction {
  const name = tool || "tool";
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const line = (text: string) => text.replace(/\s+/g, " ").slice(0, 200);
  const done = (actionClass: ActionClass, text: string, ...fp: string[]): ClassifiedAction => ({
    sensitive: SENSITIVE_CLASSES.has(actionClass),
    actionClass,
    summary: line(text),
    fingerprint: fingerprint(name, ...fp),
  });

  // Connector / MCP actions — the external surface.
  if (name.startsWith("mcp__")) {
    const slugs = connectorSlugs(args);
    const label = slugs.length ? slugs.join(", ") : name.split("__").slice(-1)[0];
    const worst = [label, ...slugs].map(classifySlug).find((c) => c !== "safe");
    // an unrecognised connector verb is not proof of safety
    return done(worst ?? "unknown", `Connector action: ${label}`, label, ...slugs);
  }

  // Shell. `shell` is the codex driver's name for the same thing.
  if (name === "Bash" || name === "BashOutput" || name === "shell") {
    const raw = args.command ?? args.cmd ?? summary ?? "";
    const command = Array.isArray(raw) ? raw.join(" ") : String(raw);
    const hit = SHELL_PATTERNS.find(([re]) => re.test(command));
    if (hit) return done(hit[1], `Shell: ${command}`, command);
    if (SHELL_READONLY.test(command)) return done("safe", `Shell: ${command}`, command);
    return done("unknown", `Shell: ${command}`, command);
  }

  // File work. Reading a secret is credential access; writing is work product
  // unless it lands on something that holds keys.
  if (name === "Read" || name === "NotebookRead") {
    const path = String(args.file_path ?? args.notebook_path ?? summary ?? "");
    return SECRET_PATH.test(path)
      ? done("credential", `Read secrets file: ${path}`, path)
      : done("safe", `Read ${path}`, path);
  }
  if (name === "Write" || name === "Edit" || name === "MultiEdit" || name === "NotebookEdit" || name === "edit") {
    const path = String(args.file_path ?? args.notebook_path ?? summary ?? "");
    return SECRET_PATH.test(path)
      ? done("credential", `Write secrets file: ${path}`, path)
      : done("safe", `Write ${path}`, path);
  }

  if (READ_ONLY_TOOLS.has(name)) return done("safe", `${name}: ${summary ?? ""}`, summary ?? "");

  // Anything else that got far enough to need permission: fail closed.
  return done("unknown", `${name}: ${summary ?? ""}`, summary ?? "");
}

// ── the gate ─────────────────────────────────────────────────────────────
/** Who (or what) started the turn this action belongs to. */
export type Attendance = "attended" | "unattended";

export type Verdict =
  | "allow" // not sensitive, or a human is watching → normal broker flow
  | "approved" // held earlier, a human approved this exact action
  | "deny-queued"; // sensitive + nobody watching → held for approval

export interface GateDecision {
  verdict: Verdict;
  action: ClassifiedAction;
  attendance: Attendance;
  reason: string;
}

/** The whole policy, as a pure function — every branch is testable without a
 *  filesystem, a bot, or a running turn. */
export function decide(action: ClassifiedAction, attendance: Attendance, granted: boolean): GateDecision {
  if (!action.sensitive) return { verdict: "allow", action, attendance, reason: "not a sensitive action" };
  if (attendance === "attended") {
    return {
      verdict: "allow",
      action,
      attendance,
      reason: "a human is watching this turn — the approval card is the gate",
    };
  }
  if (granted) return { verdict: "approved", action, attendance, reason: "a human approved this exact action" };
  return {
    verdict: "deny-queued",
    action,
    attendance,
    reason: `${action.actionClass} action on an unattended run — held until a human approves it`,
  };
}

/** How the harness should answer the broker, or null to leave the ask alone.
 *  On an unattended run nobody is there to press a button, so the gate answers
 *  every ask itself — that is the whole point of forcing the request seam open
 *  on those turns. On an attended run it answers nothing: the card is the gate. */
export function autoAnswer(decision: GateDecision): "allow" | "deny" | null {
  if (decision.verdict === "deny-queued") return "deny";
  if (decision.attendance === "unattended") return "allow";
  return null;
}

/** What the agent is told when its action is held. Mirrors the AIOS deny
 *  reason: stop, do not retry, say what you wanted so it can be approved. */
export const heldNotice = (action: ClassifiedAction) =>
  `BLOCKED by the MagicBot governance gate: "${action.summary}" is a ${action.actionClass.replace(/_/g, " ")} action` +
  ` and this run is unattended, so it needs a human's approval. Do NOT retry it and do NOT work around it.` +
  ` Stop here, say exactly what you intended to do (recipient, content, amount) so the owner can approve the` +
  ` specific action, and finish anything else you can without it.`;

// ── pending approvals + one-time grants ──────────────────────────────────
export interface PendingApproval {
  id: string;
  botId: string;
  threadId: string;
  fingerprint: string;
  actionClass: ActionClass;
  tool: string;
  summary: string;
  /** the turn's prompt, re-dispatched when the human approves */
  prompt: string;
  at: number;
}

interface GovernanceState {
  pending: PendingApproval[];
  /** one-time grants, keyed by botId → fingerprints */
  grants: Record<string, string[]>;
}

const STATE_FILE = join(DATA_DIR, "governance.json");
const MAX_PENDING = 50;

function load(): GovernanceState {
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<GovernanceState>;
    return { pending: raw.pending ?? [], grants: raw.grants ?? {} };
  } catch {
    return { pending: [], grants: {} };
  }
}

function save(state: GovernanceState): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function pendingFor(botId: string): PendingApproval[] {
  return load().pending.filter((p) => p.botId === botId);
}

export function hold(item: Omit<PendingApproval, "id" | "at">): PendingApproval {
  const state = load();
  const at = Date.now();
  const existing = state.pending.find((p) => p.botId === item.botId && p.fingerprint === item.fingerprint);
  if (existing) return existing;
  const approval: PendingApproval = { ...item, id: `g_${at.toString(36)}_${item.fingerprint.slice(0, 6)}`, at };
  state.pending = [...state.pending, approval].slice(-MAX_PENDING);
  save(state);
  return approval;
}

/** Resolve a held approval. On approve the fingerprint becomes a one-time
 *  grant; the caller re-dispatches `prompt` so the action actually happens. */
export function resolve(id: string, approved: boolean): PendingApproval | null {
  const state = load();
  const approval = state.pending.find((p) => p.id === id);
  if (!approval) return null;
  state.pending = state.pending.filter((p) => p.id !== id);
  if (approved) {
    const fps = new Set(state.grants[approval.botId] ?? []);
    fps.add(approval.fingerprint);
    state.grants[approval.botId] = [...fps];
  }
  save(state);
  return approval;
}

/** Consume a grant for this exact action. One-time, like the AIOS original:
 *  approving a send approves that send, not every future send. */
export function consumeGrant(botId: string, fp: string): boolean {
  const state = load();
  const fps = state.grants[botId] ?? [];
  if (!fps.includes(fp)) return false;
  const left = fps.filter((f) => f !== fp);
  if (left.length) state.grants[botId] = left;
  else delete state.grants[botId];
  save(state);
  return true;
}

// ── attendance ledger ────────────────────────────────────────────────────
// Set when a turn is dispatched, read when one of its actions asks for
// permission. Routine- and delegation-fired turns are unattended; so is the
// re-run of an approved action (the grant covers that one action, nothing else).
export type TurnOrigin = "user" | "routine" | "delegation" | "approval";

const attendanceByThread = new Map<string, { attendance: Attendance; prompt: string }>();

export function beginTurn(threadId: string, origin: TurnOrigin, prompt: string): void {
  attendanceByThread.set(threadId, { attendance: origin === "user" ? "attended" : "unattended", prompt });
}

export function attendanceOf(threadId: string): Attendance {
  return attendanceByThread.get(threadId)?.attendance ?? "attended";
}

export function promptOf(threadId: string): string {
  return attendanceByThread.get(threadId)?.prompt ?? "";
}

export function endTurn(threadId: string): void {
  attendanceByThread.delete(threadId);
}

// ── audit trail (append-only, one NDJSON file per bot) ───────────────────
export interface AuditRow {
  at: string;
  botId: string;
  threadId: string;
  tool: string;
  actionClass: ActionClass;
  summary: string;
  fingerprint: string;
  attendance: Attendance;
  verdict: Verdict | "rejected";
  /** who or what decided: "gate" | "user" | "policy" */
  decidedBy: string;
  reason?: string;
}

export const auditFile = (botId: string) => join(DATA_DIR, `audit-${botId}.ndjson`);

/** Append one decision. Never throws: an audit failure must not take down the
 *  action it records (nor the gate's own deny path). */
export function audit(row: Omit<AuditRow, "at"> & { at?: string }): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(auditFile(row.botId), JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n");
  } catch {
    /* audit is a record, not a gate */
  }
}

/** The last `limit` audit rows for a bot, newest last. */
export function auditTrail(botId: string, limit = 200): AuditRow[] {
  try {
    return readFileSync(auditFile(botId), "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as AuditRow);
  } catch {
    return [];
  }
}

// ── the one call the harness makes ───────────────────────────────────────
export interface GateRequest {
  botId: string;
  threadId: string;
  tool: string;
  summary: string;
  /** the raw tool input when the driver carried it through */
  input?: unknown;
}

/** Classify + decide + audit, in one call, for a permission ask that just
 *  opened. The caller acts on `verdict`: allow → leave the broker alone,
 *  approved → answer "allow", deny-queued → answer "deny" and hold it. */
export function gate(req: GateRequest): GateDecision {
  const action = classify(req.tool, req.input, req.summary);
  const attendance = attendanceOf(req.threadId);
  const granted = action.sensitive && attendance === "unattended" && consumeGrant(req.botId, action.fingerprint);
  const decision = decide(action, attendance, granted);
  // Attended non-sensitive asks are ordinary traffic — the audit trail is for
  // decisions the gate had a say in, not a log of every tool call.
  if (action.sensitive) {
    audit({
      botId: req.botId,
      threadId: req.threadId,
      tool: req.tool,
      actionClass: action.actionClass,
      summary: action.summary,
      fingerprint: action.fingerprint,
      attendance,
      verdict: decision.verdict,
      decidedBy: decision.verdict === "approved" ? "user" : "gate",
      reason: decision.reason,
    });
  }
  return decision;
}
