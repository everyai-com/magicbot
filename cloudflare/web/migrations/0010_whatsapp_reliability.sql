PRAGMA foreign_keys = ON;

ALTER TABLE whatsapp_contacts ADD COLUMN raw_jid TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN raw_chat_jid TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN raw_sender_jid TEXT;
ALTER TABLE whatsapp_drafts ADD COLUMN command_id TEXT;

ALTER TABLE whatsapp_relationships ADD COLUMN last_inbound_at INTEGER;
ALTER TABLE whatsapp_relationships ADD COLUMN last_outbound_at INTEGER;
ALTER TABLE whatsapp_relationships ADD COLUMN average_reply_ms REAL;
ALTER TABLE whatsapp_relationships ADD COLUMN reply_samples INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_draft_once_per_inbound
  ON whatsapp_drafts(user_id, inbound_message_id)
  WHERE inbound_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_draft_command
  ON whatsapp_drafts(user_id, command_id)
  WHERE command_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS whatsapp_identity_aliases (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alias_jid TEXT NOT NULL,
  canonical_jid TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, alias_jid)
);
CREATE INDEX IF NOT EXISTS whatsapp_identity_canonical
  ON whatsapp_identity_aliases(user_id, canonical_jid);
