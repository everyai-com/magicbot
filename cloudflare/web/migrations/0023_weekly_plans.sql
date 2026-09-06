PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS weekly_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_key TEXT NOT NULL,
  outcomes_json TEXT NOT NULL DEFAULT '[]',
  focus_areas_json TEXT NOT NULL DEFAULT '[]',
  risks_json TEXT NOT NULL DEFAULT '[]',
  not_to_do_json TEXT NOT NULL DEFAULT '[]',
  days_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  source_counts_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, week_key)
);

CREATE INDEX IF NOT EXISTS weekly_plans_recent ON weekly_plans(user_id, week_key DESC, updated_at DESC);
