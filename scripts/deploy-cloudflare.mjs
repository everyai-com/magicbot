#!/usr/bin/env node
// One-command hosted deploy: provisions a private MagicBots stack (web app +
// Composio broker + cloud computer) on the deployer's own Cloudflare account.
//
//   pnpm deploy:cloud [--dry-run] [--skip-computer] [--yes]
//
// What it does, in order:
//   1. builds the web UI (dist/) if it is missing
//   2. creates/finds D1 + R2 resources, applies migrations
//   3. generates secrets it can (CREDENTIAL_KEY, computer token), prompts for
//      the ones only you have (Composio project key — optional)
//   4. deploys the three workers and prints your URL
//
// Per-account IDs live in gitignored wrangler.deploy.jsonc files next to the
// committed wrangler.jsonc sources, which stay untouched (they describe
// EveryAI's own production stack). Re-running reuses those files, so deploys
// are idempotent and never rotate secrets unless you ask.
//
// Needs: a Cloudflare account (free is fine, except the cloud computer needs
// a paid Workers plan for containers) and `wrangler login` completed first.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stdin as input, stdout as output } from "node:process";

const ROOT = new URL("..", import.meta.url).pathname;
const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  console.log("Usage: pnpm deploy:cloud [--dry-run] [--skip-computer] [--yes]");
  console.log("  --dry-run       print every command without running it");
  console.log("  --skip-computer deploy web + broker only (no paid containers)");
  console.log("  --yes           never prompt; generate what's missing, skip the rest");
  process.exit(0);
}
const DRY_RUN = args.has("--dry-run");
const SKIP_COMPUTER = args.has("--skip-computer");
const ASSUME_YES = args.has("--yes");

const BROKER_DIR = "cloudflare/composio-broker";
const WEB_DIR = "cloudflare/web";
const COMPUTER_DIR = "cf-computer";
const BROKER_NAME = "magicbot-composio";
const WEB_NAME = "magicbot-web";
const COMPUTER_NAME = "magicbot-cf-computer";
const R2_BUCKET = "magicbot-web-files";

let rl = null;
async function ask(question, fallback = "") {
  if (ASSUME_YES || DRY_RUN) return fallback;
  rl ??= createInterface({ input, output });
  const answer = await rl.question(question);
  return answer.trim() || fallback;
}

function sh(cmd, opts = {}) {
  if (DRY_RUN) {
    console.log(`  $ ${cmd}${opts.inputFile ? ` < ${opts.inputFile}` : ""}`);
    return Promise.resolve({ stdout: "", stderr: "", status: 0 });
  }
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, {
      cwd: ROOT,
      shell: "/bin/sh",
      stdio: [opts.inputFile ? "pipe" : "inherit", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
      if (opts.stream !== false) process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      if (opts.stream !== false) process.stderr.write(d);
    });
    if (opts.inputFile) {
      child.stdin.write(readFileSync(opts.inputFile));
      child.stdin.end();
    }
    child.on("error", reject);
    child.on("close", (status) => resolve({ stdout, stderr, status }));
  });
}

async function must(cmd, opts = {}) {
  const result = await sh(cmd, opts);
  if (result.status !== 0 && !DRY_RUN) {
    throw new Error(`command failed (${result.status}): ${cmd}\n${result.stderr.trim()}`);
  }
  return result;
}

async function wranglerAvailable() {
  const result = await sh("wrangler --version", { stream: false });
  return DRY_RUN || result.status === 0;
}

/** Find a D1 id by name, creating the database first when it is missing. */
async function ensureD1(name) {
  const list = async () => {
    const out = await sh("wrangler d1 list --json", { stream: false });
    if (DRY_RUN) return null;
    try {
      const dbs = JSON.parse(out.stdout || "[]");
      return dbs.find((db) => db.name === name)?.uuid ?? null;
    } catch {
      // older output: fall back to the human-readable table
      const line = out.stdout.split("\n").find((row) => row.includes(name));
      return line?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? null;
    }
  };
  let id = await list();
  if (id) {
    console.log(`  D1 ${name} exists (${id.slice(0, 8)}…)`);
    return id;
  }
  console.log(`  creating D1 database ${name}`);
  await must(`wrangler d1 create ${name}`);
  id = await list();
  if (!id && !DRY_RUN) throw new Error(`created ${name} but cannot find its id — run 'wrangler d1 list' and retry`);
  return id ?? "<database-id>";
}

async function ensureR2(name) {
  console.log(`  ensuring R2 bucket ${name}`);
  const result = await sh(`wrangler r2 bucket create ${name}`, { stream: false });
  if (!DRY_RUN && result.status !== 0 && !/already exists|exists/i.test(`${result.stdout}${result.stderr}`)) {
    throw new Error(`could not create R2 bucket ${name}:\n${result.stderr.trim() || result.stdout.trim()}`);
  }
}

async function secretExists(config, name) {
  if (DRY_RUN) return false;
  const out = await sh(`wrangler secret list --config ${config}`, { stream: false });
  return out.status === 0 && out.stdout.split("\n").some((line) => line.trim() === name);
}

/** Set a Worker secret from a temp file (never via argv or echo). */
async function putSecret(config, name, value) {
  if (DRY_RUN) {
    console.log(`  $ wrangler secret put ${name} --config ${config} < <generated>`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "mb-secret-"));
  const file = join(dir, "value");
  try {
    writeFileSync(file, value, { mode: 0o600 });
    await must(`wrangler secret put ${name} --config ${config}`, { inputFile: file });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Read the previous deploy config's IDs so re-runs reuse instead of recreate. */
function previousDeployValues(path) {
  try {
    const text = readFileSync(join(ROOT, path), "utf8");
    const ids = {};
    for (const match of text.matchAll(/"database_id":\s*"([^"]+)"/g)) ids.db = match[1];
    const namespaces = [...text.matchAll(/"namespace_id":\s*"([^"]+)"/g)].map((m) => m[1]);
    if (namespaces.length >= 2) ids.namespaces = namespaces;
    return ids;
  } catch {
    return {};
  }
}

const randomNamespace = () => String(100_000_000 + Math.floor(Math.random() * 899_999_999));

function writeBrokerConfig(path, dbId, namespaces) {
  // Keep in sync with cloudflare/composio-broker/wrangler.jsonc (minus the
  // account-specific IDs, which are filled in per deployer).
  const config = {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: BROKER_NAME,
    main: "src/index.ts",
    compatibility_date: "2026-08-18",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: true,
    vars: {
      COMPOSIO_API_BASE: "https://backend.composio.dev/api/v3.1",
      COMPOSIO_TOOLKIT_BASE: "https://backend.composio.dev/api/v3",
      REGISTRATION_MODE: "open",
    },
    d1_databases: [{ binding: "DB", database_name: BROKER_NAME, database_id: dbId, migrations_dir: "migrations" }],
    ratelimits: [
      { name: "REGISTRATION_LIMITER", namespace_id: namespaces[0], simple: { limit: 30, period: 60 } },
      { name: "SESSION_LIMITER", namespace_id: namespaces[1], simple: { limit: 120, period: 60 } },
    ],
    observability: { enabled: true, logs: { enabled: true, head_sampling_rate: 1 } },
  };
  writeFileSync(join(ROOT, path), `${JSON.stringify(config, null, 2)}\n`);
}

function writeWebConfig(path, dbId, withComputer) {
  // Keep in sync with cloudflare/web/wrangler.jsonc, minus EveryAI's routes
  // and email sender (deployers get a workers.dev URL and wire their own).
  const services = [
    { binding: "CONNECTORS", service: BROKER_NAME, entrypoint: "WebConnectors" },
    ...(withComputer ? [{ binding: "COMPUTER", service: COMPUTER_NAME, entrypoint: "WebComputer" }] : []),
  ];
  const config = {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: WEB_NAME,
    main: "src/index.ts",
    workers_dev: true,
    compatibility_date: "2026-08-01",
    compatibility_flags: ["nodejs_compat"],
    assets: { directory: "../../dist", binding: "ASSETS", run_worker_first: true, not_found_handling: "single-page-application" },
    ai: { binding: "AI" },
    r2_buckets: [{ binding: "FILES", bucket_name: R2_BUCKET }],
    services,
    triggers: { crons: ["* * * * *"] },
    d1_databases: [{ binding: "DB", database_name: WEB_NAME, database_id: dbId, migrations_dir: "migrations" }],
    observability: { enabled: true },
  };
  writeFileSync(join(ROOT, path), `${JSON.stringify(config, null, 2)}\n`);
}

async function main() {
  if (!existsSync(join(ROOT, "cloudflare/web/wrangler.jsonc"))) {
    throw new Error("run this from the magicbot repository root (pnpm deploy:cloud)");
  }
  if (!(await wranglerAvailable())) {
    throw new Error("wrangler is not installed — run 'pnpm install' first");
  }
  console.log("▸ checking Cloudflare auth");
  const whoami = await sh("wrangler whoami", { stream: false });
  if (!DRY_RUN && whoami.status !== 0) {
    throw new Error("not logged in — run 'wrangler login' first, then retry");
  }
  if (!DRY_RUN) console.log(`  ${whoami.stdout.trim().split("\n").at(-1)}`);

  if (!existsSync(join(ROOT, "dist/index.html"))) {
    console.log("▸ building the web UI");
    await must("pnpm build");
  } else {
    console.log("▸ web UI already built (dist/)");
  }

  // — broker: per-installation Composio sessions for desktop + web —
  console.log("▸ broker: database");
  const brokerConfig = `${BROKER_DIR}/wrangler.deploy.jsonc`;
  const brokerPrev = previousDeployValues(brokerConfig);
  const brokerDb = brokerPrev.db ?? (await ensureD1(BROKER_NAME));
  const namespaces = brokerPrev.namespaces ?? [randomNamespace(), randomNamespace()];
  if (!DRY_RUN) writeBrokerConfig(brokerConfig, brokerDb, namespaces);
  else console.log(`  write ${brokerConfig} (D1 ${brokerDb}, fresh rate-limit namespaces)`);
  console.log("▸ broker: migrations + deploy");
  await must(`wrangler d1 migrations apply ${BROKER_NAME} --remote --config ${brokerConfig}`);
  const brokerKey = await ask("  Composio project key for the broker (ak_…, optional — Enter to skip): ");
  if (brokerKey) {
    await putSecret(brokerConfig, "COMPOSIO_API_KEY", brokerKey);
  } else if (!(await secretExists(brokerConfig, "COMPOSIO_API_KEY"))) {
    console.log("  no broker key — users add their own Composio key in web settings instead");
  } else {
    console.log("  keeping the existing broker key");
  }
  await must(`wrangler deploy --config ${brokerConfig}`);

  // — computer: one container workspace per bot (paid Workers plan) —
  let withComputer = !SKIP_COMPUTER;
  if (withComputer && !DRY_RUN) {
    console.log("▸ computer: deploy (needs a paid Workers plan for containers)");
    const deployed = await sh(`wrangler deploy --config ${COMPUTER_DIR}/wrangler.jsonc`);
    if (deployed.status !== 0) {
      console.log("  computer deploy failed — continuing without bot computers");
      console.log("  (re-run without --skip-computer after upgrading your Workers plan)");
      withComputer = false;
    } else {
      const computerConfig = `${COMPUTER_DIR}/wrangler.jsonc`;
      if (!(await secretExists(computerConfig, "MAGICBOT_COMPUTER_TOKEN"))) {
        await putSecret(computerConfig, "MAGICBOT_COMPUTER_TOKEN", randomBytes(32).toString("base64url"));
        // secrets apply to future revisions — redeploy once so the token is live
        await must(`wrangler deploy --config ${computerConfig}`);
      } else {
        console.log("  keeping the existing computer token");
      }
    }
  } else if (DRY_RUN && !SKIP_COMPUTER) {
    console.log("▸ computer: deploy (needs a paid Workers plan for containers)");
    console.log(`  $ wrangler deploy --config ${COMPUTER_DIR}/wrangler.jsonc`);
    console.log("  $ wrangler secret put MAGICBOT_COMPUTER_TOKEN --config cf-computer/wrangler.jsonc < <generated>");
  } else {
    console.log("▸ computer: skipped (--skip-computer; bot computers stay disabled)");
  }

  // — web: the hosted app itself —
  console.log("▸ web: database + storage");
  const webConfig = `${WEB_DIR}/wrangler.deploy.jsonc`;
  const webPrev = previousDeployValues(webConfig);
  const webDb = webPrev.db ?? (await ensureD1(WEB_NAME));
  await ensureR2(R2_BUCKET);
  if (!DRY_RUN) writeWebConfig(webConfig, webDb, withComputer);
  else console.log(`  write ${webConfig} (D1 ${webDb}, R2 ${R2_BUCKET})`);
  console.log("▸ web: migrations + deploy");
  await must(`wrangler d1 migrations apply ${WEB_NAME} --remote --config ${webConfig}`);
  if (!(await secretExists(webConfig, "CREDENTIAL_KEY"))) {
    console.log("  generating the credential-encryption key");
    await putSecret(webConfig, "CREDENTIAL_KEY", randomBytes(32).toString("base64"));
  } else {
    console.log("  keeping the existing credential key (rotating it would lock stored app keys)");
  }
  await must(`wrangler deploy --config ${webConfig}`);

  console.log("");
  console.log("Done. Your app is live at the workers.dev URL printed above.");
  if (!withComputer) console.log("Bot computers are disabled (deploy with containers to enable them).");
  console.log("Password-reset email needs your own sender: see docs/cloudflare-deploy.md.");
}

try {
  await main();
} catch (error) {
  console.error(`\ndeploy failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  rl?.close();
}

