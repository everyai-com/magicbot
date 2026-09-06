PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS context_observations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('preference','relationship','profile','habit')),
  suggested_text TEXT NOT NULL,
  corrected_text TEXT,
  normalized_text TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','corrected','dismissed')),
  source_message_id TEXT,
  source_bot_id TEXT,
  source_task_id TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, normalized_text)
);

CREATE INDEX IF NOT EXISTS context_observations_inbox
  ON context_observations(user_id, status, created_at DESC);
