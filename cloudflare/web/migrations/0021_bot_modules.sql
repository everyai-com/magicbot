CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL,
  trigger_terms_json TEXT NOT NULL DEFAULT '[]',
  required_capabilities_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'custom',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, slug)
);

CREATE TABLE IF NOT EXISTS bot_modules (
  user_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  installed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, bot_id, module_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE,
  FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bot_modules_enabled ON bot_modules(user_id, bot_id, enabled);
