PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agent_workflow_triggers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('once','daily','webhook')),
  enabled INTEGER NOT NULL DEFAULT 1,
  template_json TEXT NOT NULL,
  schedule_json TEXT NOT NULL,
  next_run_at INTEGER,
  endpoint_id TEXT UNIQUE,
  secret_hash TEXT,
  last_workflow_id TEXT,
  last_triggered_at INTEGER,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_workflow_triggers_due
  ON agent_workflow_triggers(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_agent_workflow_triggers_user
  ON agent_workflow_triggers(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_workflow_trigger_deliveries (
  id TEXT PRIMARY KEY,
  trigger_id TEXT NOT NULL REFERENCES agent_workflow_triggers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  workflow_id TEXT,
  received_at INTEGER NOT NULL,
  UNIQUE(trigger_id, delivery_id)
);

ALTER TABLE agent_workflows ADD COLUMN trigger_id TEXT;
ALTER TABLE agent_workflows ADD COLUMN trigger_source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE agent_workflows ADD COLUMN trigger_event TEXT;
