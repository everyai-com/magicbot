PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agent_delegations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_bot_id TEXT,
  source_bot_name TEXT NOT NULL DEFAULT 'You',
  target_bot_id TEXT NOT NULL,
  target_bot_name TEXT NOT NULL,
  task TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  expected_output TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  result TEXT,
  error TEXT,
  target_thread_id TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_delegations_user_status
  ON agent_delegations(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_delegations_target
  ON agent_delegations(user_id, target_bot_id, updated_at DESC);
