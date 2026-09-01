PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tool_approvals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_id TEXT,
  decision_id TEXT,
  connector TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  action TEXT NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('draft','external','sensitive','destructive')),
  arguments_json TEXT NOT NULL DEFAULT '{}',
  preview TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','executing','executed','dismissed','failed')),
  result_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tool_approvals_pending ON tool_approvals(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS tool_approvals_decision ON tool_approvals(user_id, decision_id);
