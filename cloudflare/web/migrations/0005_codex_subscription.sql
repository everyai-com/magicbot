CREATE TABLE IF NOT EXISTS codex_auth_pending (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  device_auth_id TEXT NOT NULL,
  user_code TEXT NOT NULL,
  verification_url TEXT NOT NULL,
  poll_interval INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_polled_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

