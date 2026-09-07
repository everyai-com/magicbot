PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agent_workflows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  coordinator_bot_id TEXT,
  coordinator_bot_name TEXT NOT NULL DEFAULT 'You',
  status TEXT NOT NULL CHECK (status IN ('draft','running','paused','completed','failed','cancelled')),
  failure_policy TEXT NOT NULL CHECK (failure_policy IN ('stop','continue')),
  max_agent_runs INTEGER NOT NULL,
  max_duration_minutes INTEGER NOT NULL,
  runs_used INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_workflow_steps (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES agent_workflows(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  target_bot_id TEXT NOT NULL,
  target_bot_name TEXT NOT NULL,
  task TEXT NOT NULL,
  expected_output TEXT NOT NULL DEFAULT '',
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','skipped')),
  delegation_id TEXT,
  result TEXT,
  error TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_workflows_user_updated ON agent_workflows(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_workflow_steps_workflow ON agent_workflow_steps(workflow_id, position ASC);
ALTER TABLE agent_delegations ADD COLUMN workflow_id TEXT;
ALTER TABLE agent_delegations ADD COLUMN workflow_step_id TEXT;
