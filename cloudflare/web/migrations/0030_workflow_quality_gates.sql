PRAGMA foreign_keys = OFF;

CREATE TABLE agent_workflow_steps_next (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES agent_workflows(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  target_bot_id TEXT NOT NULL,
  target_bot_name TEXT NOT NULL,
  task TEXT NOT NULL,
  expected_output TEXT NOT NULL DEFAULT '',
  acceptance_criteria TEXT NOT NULL DEFAULT '',
  max_attempts INTEGER NOT NULL DEFAULT 2,
  attempts INTEGER NOT NULL DEFAULT 0,
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('pending','running','reviewing','completed','failed','skipped')),
  delegation_id TEXT,
  result TEXT,
  review_feedback TEXT,
  error TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);

INSERT INTO agent_workflow_steps_next
  (id, workflow_id, user_id, position, target_bot_id, target_bot_name, task, expected_output, depends_on_json, status, delegation_id, result, error, started_at, completed_at, updated_at)
SELECT id, workflow_id, user_id, position, target_bot_id, target_bot_name, task, expected_output, depends_on_json, status, delegation_id, result, error, started_at, completed_at, updated_at
FROM agent_workflow_steps;

DROP TABLE agent_workflow_steps;
ALTER TABLE agent_workflow_steps_next RENAME TO agent_workflow_steps;
CREATE INDEX idx_agent_workflow_steps_workflow ON agent_workflow_steps(workflow_id, position ASC);

PRAGMA foreign_keys = ON;
