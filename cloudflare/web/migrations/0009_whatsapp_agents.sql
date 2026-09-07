PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS whatsapp_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'disconnected',
  account_jid TEXT,
  account_name TEXT,
  event_cursor INTEGER NOT NULL DEFAULT 0,
  default_bot_id TEXT,
  default_mode TEXT NOT NULL DEFAULT 'draft' CHECK (default_mode IN ('off','draft','autonomous')),
  history_synced_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jid TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  is_group INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, jid)
);
CREATE INDEX IF NOT EXISTS whatsapp_contacts_recent ON whatsapp_contacts(user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_chats (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jid TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  is_group INTEGER NOT NULL DEFAULT 0,
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,
  agent_mode TEXT NOT NULL DEFAULT 'inherit' CHECK (agent_mode IN ('inherit','off','draft','autonomous')),
  bot_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, jid)
);
CREATE INDEX IF NOT EXISTS whatsapp_chats_recent ON whatsapp_chats(user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  sender_jid TEXT NOT NULL,
  from_me INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL DEFAULT '',
  message_type TEXT NOT NULL DEFAULT 'unknown',
  source TEXT NOT NULL DEFAULT 'live',
  sent_at INTEGER NOT NULL,
  ingested_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, message_id)
);
CREATE INDEX IF NOT EXISTS whatsapp_messages_chat ON whatsapp_messages(user_id, chat_jid, sent_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_messages_sender ON whatsapp_messages(user_id, sender_jid, sent_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_relationships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_jid TEXT NOT NULL,
  inbound_count INTEGER NOT NULL DEFAULT 0,
  outbound_count INTEGER NOT NULL DEFAULT 0,
  first_interaction_at INTEGER,
  last_interaction_at INTEGER,
  relationship_score REAL NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, contact_jid)
);
CREATE INDEX IF NOT EXISTS whatsapp_relationships_score ON whatsapp_relationships(user_id, relationship_score DESC);

CREATE TABLE IF NOT EXISTS whatsapp_drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_jid TEXT NOT NULL,
  inbound_message_id TEXT,
  bot_id TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','sent','dismissed','failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS whatsapp_drafts_pending ON whatsapp_drafts(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_agent_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_jid TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  message_id TEXT,
  bot_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS whatsapp_agent_audit_recent ON whatsapp_agent_audit(user_id, created_at DESC);
