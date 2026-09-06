ALTER TABLE context_sources ADD COLUMN auto_sync INTEGER NOT NULL DEFAULT 0;
ALTER TABLE context_sources ADD COLUMN sync_interval_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE context_sources ADD COLUMN next_sync_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_context_sources_due_sync
  ON context_sources(auto_sync, next_sync_at)
  WHERE auto_sync = 1;
