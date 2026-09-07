PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS session_closeouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_title TEXT NOT NULL,
  outcome TEXT NOT NULL,
  decisions_json TEXT NOT NULL DEFAULT '[]',
  open_loops_json TEXT NOT NULL DEFAULT '[]',
  next_task_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, bot_id, task_id)
);
CREATE INDEX IF NOT EXISTS session_closeouts_recent ON session_closeouts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS session_closeouts_next ON session_closeouts(user_id, next_task_id);
