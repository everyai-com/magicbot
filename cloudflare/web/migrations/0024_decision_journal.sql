PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS decision_journal (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_id TEXT,
  question TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]',
  assumptions_json TEXT NOT NULL DEFAULT '[]',
  counter_case TEXT NOT NULL DEFAULT '',
  choice TEXT NOT NULL DEFAULT '',
  rationale TEXT NOT NULL DEFAULT '',
  confidence INTEGER,
  review_at INTEGER,
  status TEXT NOT NULL DEFAULT 'exploring' CHECK (status IN ('exploring','decided','revisit','archived')),
  challenged_at INTEGER,
  decided_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS decision_journal_recent ON decision_journal(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS decision_journal_review ON decision_journal(user_id, review_at, status);
