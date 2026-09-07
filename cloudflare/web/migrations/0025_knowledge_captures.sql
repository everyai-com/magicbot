PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS knowledge_captures (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_url TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual','link','chat','file')),
  content TEXT NOT NULL,
  content_key TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','corrected','dismissed')),
  context_item_ids_json TEXT NOT NULL DEFAULT '[]',
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, content_key)
);

CREATE INDEX IF NOT EXISTS knowledge_captures_inbox ON knowledge_captures(user_id, status, created_at DESC);
