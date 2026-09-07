PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS company_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  products_json TEXT NOT NULL DEFAULT '[]',
  customers_json TEXT NOT NULL DEFAULT '[]',
  strategy TEXT NOT NULL DEFAULT '',
  differentiators_json TEXT NOT NULL DEFAULT '[]',
  brand_voice TEXT NOT NULL DEFAULT '',
  facts_json TEXT NOT NULL DEFAULT '[]',
  operating_rules_json TEXT NOT NULL DEFAULT '[]',
  glossary_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
