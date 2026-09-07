PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS relationship_commitments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('mine','theirs')),
  kind TEXT NOT NULL CHECK (kind IN ('promise','request','follow-up')),
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','open','done','dismissed')),
  confidence REAL NOT NULL DEFAULT 0.7,
  due_at INTEGER,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_message_id TEXT,
  user_verified INTEGER NOT NULL DEFAULT 0,
  reviewed_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS relationship_commitments_inbox
  ON relationship_commitments(user_id, status, due_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS relationship_commitments_person
  ON relationship_commitments(user_id, person_id, status, updated_at DESC);
