PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS operating_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  roles_json TEXT NOT NULL DEFAULT '[]',
  working_style TEXT NOT NULL DEFAULT '',
  priorities_json TEXT NOT NULL DEFAULT '[]',
  communication_style TEXT NOT NULL DEFAULT '',
  boundaries_json TEXT NOT NULL DEFAULT '[]',
  timezone TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
