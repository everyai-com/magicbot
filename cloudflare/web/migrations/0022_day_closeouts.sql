PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS day_closeouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  wins_json TEXT NOT NULL DEFAULT '[]',
  lessons_json TEXT NOT NULL DEFAULT '[]',
  tomorrow_priorities_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  source_counts_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, date_key)
);

CREATE INDEX IF NOT EXISTS day_closeouts_recent ON day_closeouts(user_id, date_key DESC, updated_at DESC);
