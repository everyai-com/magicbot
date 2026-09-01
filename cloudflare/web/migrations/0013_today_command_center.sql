PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS today_priorities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  rank INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','profile','agent')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS today_priorities_user ON today_priorities(user_id, status, rank, updated_at DESC);

INSERT INTO today_priorities (id, user_id, title, status, rank, source, created_at, updated_at)
SELECT lower(hex(randomblob(16))), p.user_id, CAST(j.value AS TEXT), 'open', CAST(j.key AS INTEGER), 'profile', p.created_at, p.updated_at
FROM operating_profiles p, json_each(p.priorities_json) j
WHERE trim(CAST(j.value AS TEXT)) != ''
  AND NOT EXISTS (SELECT 1 FROM today_priorities t WHERE t.user_id = p.user_id AND lower(t.title) = lower(trim(CAST(j.value AS TEXT))));
