PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS context_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('user','workspace','project','room','bot','task')),
  scope_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.7,
  expires_at INTEGER,
  source_message_id TEXT,
  created_by TEXT NOT NULL DEFAULT 'extractor',
  user_verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS context_items_dedupe ON context_items(user_id, scope_type, scope_id, normalized_text);
CREATE INDEX IF NOT EXISTS context_items_scope ON context_items(user_id, scope_type, scope_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS context_items_expiry ON context_items(user_id, expires_at);

CREATE TABLE IF NOT EXISTS task_summaries (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  updated_through_message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, task_id)
);
CREATE INDEX IF NOT EXISTS task_summaries_bot ON task_summaries(user_id, bot_id, updated_at DESC);
