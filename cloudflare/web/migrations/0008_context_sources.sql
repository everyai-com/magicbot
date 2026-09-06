PRAGMA foreign_keys = ON;

ALTER TABLE context_items ADD COLUMN source_id TEXT;
CREATE INDEX IF NOT EXISTS context_items_source ON context_items(user_id, source_id);

CREATE TABLE IF NOT EXISTS context_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('attachment','github','email','connector')),
  label TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('user','workspace','project','room','bot','task')),
  scope_id TEXT NOT NULL,
  connector_service TEXT,
  connector_tool TEXT,
  config TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ready',
  item_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS context_sources_user ON context_sources(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS context_sources_scope ON context_sources(user_id, scope_type, scope_id);
