PRAGMA foreign_keys = ON;

ALTER TABLE whatsapp_drafts ADD COLUMN commitment_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_draft_once_per_commitment
  ON whatsapp_drafts(user_id, commitment_id)
  WHERE commitment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS whatsapp_drafts_commitment
  ON whatsapp_drafts(user_id, commitment_id, status);
