PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS autonomy_policies (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('account','bot','connector','contact','tool')),
  scope_key TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL CHECK (mode IN ('never','observe','draft','ask','act')),
  max_per_hour INTEGER CHECK (max_per_hour IS NULL OR (max_per_hour >= 0 AND max_per_hour <= 1000)),
  max_per_day INTEGER CHECK (max_per_day IS NULL OR (max_per_day >= 0 AND max_per_day <= 10000)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, scope_type, scope_key)
);
CREATE INDEX IF NOT EXISTS autonomy_policies_user ON autonomy_policies(user_id, scope_type, scope_key);

CREATE TABLE IF NOT EXISTS autonomy_decisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_id TEXT,
  connector TEXT NOT NULL DEFAULT '',
  subject_key TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('read','draft','external','sensitive','destructive')),
  verdict TEXT NOT NULL CHECK (verdict IN ('allow','draft','ask','deny')),
  reason TEXT NOT NULL,
  policy_id TEXT,
  policy_mode TEXT NOT NULL CHECK (policy_mode IN ('never','observe','draft','ask','act')),
  unattended INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS autonomy_decisions_recent ON autonomy_decisions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS autonomy_decisions_subject ON autonomy_decisions(user_id, connector, subject_key, created_at DESC);

INSERT OR IGNORE INTO autonomy_policies
  (id, user_id, scope_type, scope_key, mode, max_per_hour, max_per_day, created_at, updated_at)
SELECT
  lower(hex(randomblob(16))), user_id, 'connector', 'whatsapp',
  CASE default_mode WHEN 'autonomous' THEN 'act' WHEN 'off' THEN 'observe' ELSE 'draft' END,
  5, 30, created_at, updated_at
FROM whatsapp_connections;
