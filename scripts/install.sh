#!/usr/bin/env bash
# MagicBots local installer — clone (if needed), install, and start.
# One line, from anywhere:
#   curl -fsSL https://raw.githubusercontent.com/everyai-com/magicbot/main/scripts/install.sh | bash
set -euo pipefail

REPO_URL="https://github.com/everyai-com/magicbot"
APP_PORT="5199"
API_PORT="8799"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing '$1' — install it and re-run (see https://github.com/everyai-com/magicbot#quick-start)"
}

# --- prerequisites -----------------------------------------------------------
need_cmd node
need_cmd git
need_cmd curl

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 24 ] 2>/dev/null || die "node 24+ is required (found $(node --version 2>/dev/null || echo none))"

if ! command -v pnpm >/dev/null 2>&1; then
  say "▸ installing pnpm via corepack…"
  corepack enable 2>/dev/null || die "corepack is unavailable — install pnpm from https://pnpm.io/installation"
  corepack prepare pnpm@10.33.0 --activate || die "could not activate pnpm"
fi

if ! command -v claude >/dev/null 2>&1 && ! command -v codex >/dev/null 2>&1 && ! command -v grok >/dev/null 2>&1; then
  say "⚠ no agent CLI found (claude, codex, or grok). Install and log in to at least one,"
  say "  otherwise bots will show as unavailable. Continuing anyway…"
fi

# --- source ------------------------------------------------------------------
if [ -f "package.json" ] && grep -q '"name": "magicbots"' package.json 2>/dev/null; then
  say "▸ already in the magicbot checkout — using it"
else
  if [ -d "magicbot" ]; then
    say "▸ reusing ./magicbot"
  else
    say "▸ cloning magicbot…"
    git clone --depth 1 "$REPO_URL" magicbot || die "clone failed"
  fi
  cd magicbot
fi

# --- install + start ---------------------------------------------------------
say "▸ installing dependencies (one-time)…"
pnpm install --prefer-frozen-lockfile

say ""
say "▸ starting MagicBots — harness :$API_PORT, app :$APP_PORT"
say "  open http://127.0.0.1:$APP_PORT — Ctrl-C stops everything"
say ""

trap 'kill 0 2>/dev/null' EXIT
pnpm dev:server &
SERVER_PID=$!
# wait for the harness before opening the UI against it
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1 && break
  kill -0 "$SERVER_PID" 2>/dev/null || die "the harness server exited — scroll up for the error"
  sleep 1
done
curl -fsS "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1 || die "the harness never came up on :$API_PORT"

pnpm dev -- --host 127.0.0.1 --port "$APP_PORT"
