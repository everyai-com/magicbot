// Governance gate — classifier + decision tests.
//
//   node --test server/organs/governance.test.ts
//
// Node's built-in runner, no new dependency: the repo already runs .ts through
// node directly (`pnpm dev:server`), so type-stripping covers this too. Only
// the pure functions are exercised — classify() and decide() are the whole
// policy; everything else in the organ is storage around them.
import { test } from "node:test";
import assert from "node:assert/strict";

import { autoAnswer, classify, decide, heldNotice, type ActionClass } from "./governance.ts";

const classOf = (tool: string, input: unknown, summary?: string): ActionClass =>
  classify(tool, input, summary).actionClass;

test("connector sends and posts are external_send", () => {
  const bash = (slug: string) => classOf("mcp__composio__COMPOSIO_EXECUTE_TOOL", { tool_slug: slug });
  assert.equal(bash("GMAIL_SEND_EMAIL"), "external_send");
  assert.equal(bash("SLACK_SENDS_A_MESSAGE"), "external_send");
  assert.equal(bash("TWITTER_CREATION_OF_A_POST"), "external_send");
});

test("connector money verbs outrank the generic write verbs", () => {
  const money = classify("mcp__composio__COMPOSIO_EXECUTE_TOOL", { tool_slug: "STRIPE_CREATE_PAYMENT_INTENT" });
  assert.equal(money.actionClass, "payment");
  assert.equal(money.sensitive, true);
});

test("connector deletes and credential reads get their own class", () => {
  assert.equal(classOf("mcp__composio__COMPOSIO_EXECUTE_TOOL", { tool_slug: "GITHUB_DELETE_A_REPOSITORY" }), "delete");
  assert.equal(classOf("mcp__vault__READ_SECRET", {}), "credential");
});

test("a MULTI_EXECUTE batch is classified by its worst member", () => {
  const action = classify("mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL", {
    tools: [{ tool_slug: "GMAIL_GET_PROFILE" }, { tool_slug: "GMAIL_SEND_EMAIL" }],
  });
  assert.equal(action.actionClass, "external_send");
});

test("an unrecognised connector verb is gated, not waved through", () => {
  const action = classify("mcp__somebody__DO_THE_THING", {});
  assert.equal(action.actionClass, "unknown");
  assert.equal(action.sensitive, true);
});

test("destructive and outbound shell is caught", () => {
  assert.equal(classOf("Bash", { command: "rm -rf ~/Documents/old" }), "delete");
  assert.equal(classOf("Bash", { command: "git push --force origin main" }), "destructive_shell");
  assert.equal(classOf("Bash", { command: "sudo launchctl unload everything" }), "destructive_shell");
  assert.equal(classOf("Bash", { command: "scp report.pdf server:/tmp" }), "destructive_shell");
  assert.equal(classOf("Bash", { command: "curl -X POST https://api.example.com/send -d @body.json" }), "external_send");
  assert.equal(classOf("Bash", { command: "gh pr create --title x" }), "external_send");
  assert.equal(classOf("Bash", { command: "npm publish" }), "external_send");
  assert.equal(classOf("Bash", { command: "cat .env" }), "credential");
});

test("read-only shell is safe; anything else in a shell fails closed", () => {
  assert.equal(classOf("Bash", { command: "ls -la src" }), "safe");
  assert.equal(classOf("Bash", { command: "git status --short" }), "safe");
  assert.equal(classOf("Bash", { command: "rg TODO server" }), "safe");
  // not provably read-only → gated on unattended runs
  assert.equal(classOf("Bash", { command: "./deploy.sh --prod" }), "unknown");
});

test("the codex driver's tool names classify the same way", () => {
  assert.equal(classOf("shell", { command: ["rm", "-rf", "build"] }), "delete");
  assert.equal(classOf("shell", { command: ["ls"] }), "safe");
});

test("secret files are credential access, ordinary files are work product", () => {
  assert.equal(classOf("Read", { file_path: "/Users/x/project/.env" }), "credential");
  assert.equal(classOf("Read", { file_path: "/Users/x/.ssh/id_ed25519" }), "credential");
  assert.equal(classOf("Read", { file_path: "/Users/x/project/README.md" }), "safe");
  assert.equal(classOf("Write", { file_path: "/Users/x/project/src/app.ts" }), "safe");
  assert.equal(classOf("Write", { file_path: "/Users/x/project/.npmrc" }), "credential");
});

test("an unknown tool that needed permission fails closed", () => {
  assert.equal(classOf("SomeFutureTool", {}, "does something"), "unknown");
  assert.equal(classOf("WebSearch", { query: "weather" }), "safe");
});

test("the fingerprint is stable per action and differs across actions", () => {
  const a = classify("Bash", { command: "rm  -rf   build" });
  const b = classify("Bash", { command: "rm -rf build" });
  const c = classify("Bash", { command: "rm -rf dist" });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
});

test("the classifier falls back to the broker summary when input is missing", () => {
  assert.equal(classOf("Bash", undefined, "rm -rf /tmp/x"), "delete");
});

// ── the decision layer ───────────────────────────────────────────────────

const send = classify("mcp__composio__COMPOSIO_EXECUTE_TOOL", { tool_slug: "GMAIL_SEND_EMAIL" });
const list = classify("Bash", { command: "ls" });

test("attended turns are untouched — the existing broker card is the gate", () => {
  assert.equal(decide(send, "attended", false).verdict, "allow");
  assert.equal(decide(list, "attended", false).verdict, "allow");
});

test("unattended + sensitive is denied and held", () => {
  const decision = decide(send, "unattended", false);
  assert.equal(decision.verdict, "deny-queued");
  assert.match(decision.reason, /unattended/);
});

test("unattended + harmless still flows", () => {
  assert.equal(decide(list, "unattended", false).verdict, "allow");
});

test("a grant for this exact action lets it through", () => {
  assert.equal(decide(send, "unattended", true).verdict, "approved");
});

test("a grant means nothing when nothing was gated", () => {
  assert.equal(decide(list, "unattended", true).verdict, "allow");
});

test("the held notice tells the agent to stop rather than route around it", () => {
  const notice = heldNotice(send);
  assert.match(notice, /Do NOT retry/);
  assert.match(notice, /GMAIL_SEND_EMAIL/);
});

// ── who answers the broker ───────────────────────────────────────────────

test("attended asks are left for the human's card", () => {
  assert.equal(autoAnswer(decide(send, "attended", false)), null);
  assert.equal(autoAnswer(decide(list, "attended", false)), null);
});

test("unattended asks are always answered by the gate, never left to stall", () => {
  assert.equal(autoAnswer(decide(send, "unattended", false)), "deny");
  assert.equal(autoAnswer(decide(send, "unattended", true)), "allow");
  assert.equal(autoAnswer(decide(list, "unattended", false)), "allow");
});
