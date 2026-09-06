PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  source_key TEXT NOT NULL,
  person_type TEXT NOT NULL DEFAULT 'person' CHECK (person_type IN ('self','person','group','organization')),
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, source_key)
);
CREATE INDEX IF NOT EXISTS people_name ON people(user_id, display_name);

CREATE TABLE IF NOT EXISTS person_identities (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  display_value TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider, external_id)
);
CREATE INDEX IF NOT EXISTS person_identities_person ON person_identities(user_id, person_id);

CREATE TABLE IF NOT EXISTS relationship_edges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  to_person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'contact',
  label TEXT NOT NULL DEFAULT '',
  strength REAL NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0.7,
  inbound_count INTEGER NOT NULL DEFAULT 0,
  outbound_count INTEGER NOT NULL DEFAULT 0,
  first_interaction_at INTEGER,
  last_interaction_at INTEGER,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  user_verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, from_person_id, to_person_id, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS relationship_edges_person ON relationship_edges(user_id, from_person_id, strength DESC);
CREATE INDEX IF NOT EXISTS relationship_edges_target ON relationship_edges(user_id, to_person_id, strength DESC);

INSERT OR IGNORE INTO people (id, user_id, display_name, source_key, person_type, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), id, COALESCE(NULLIF(name, ''), 'You'), 'account:self', 'self', created_at, created_at FROM users;

INSERT OR IGNORE INTO people (id, user_id, display_name, source_key, person_type, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), c.user_id,
    COALESCE(NULLIF(c.display_name, ''), NULLIF(c.phone, ''), c.jid),
    'whatsapp:' || c.jid, CASE WHEN c.is_group = 1 THEN 'group' ELSE 'person' END,
    c.first_seen_at, c.last_seen_at FROM whatsapp_contacts c;

INSERT OR IGNORE INTO person_identities (user_id, person_id, provider, external_id, display_value, verified, created_at, updated_at)
  SELECT c.user_id, p.id, 'whatsapp', c.jid, COALESCE(NULLIF(c.phone, ''), c.jid), 1, c.first_seen_at, c.last_seen_at
  FROM whatsapp_contacts c JOIN people p ON p.user_id = c.user_id AND p.source_key = 'whatsapp:' || c.jid;

INSERT OR IGNORE INTO relationship_edges
  (id, user_id, from_person_id, to_person_id, relation_type, label, strength, confidence, inbound_count, outbound_count, first_interaction_at, last_interaction_at, source_type, source_id, user_verified, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), r.user_id, owner.id, contact.id, 'contact', '', r.relationship_score, 1,
    r.inbound_count, r.outbound_count, r.first_interaction_at, r.last_interaction_at,
    'whatsapp', r.contact_jid, 1, COALESCE(r.first_interaction_at, r.updated_at), r.updated_at
  FROM whatsapp_relationships r
  JOIN people owner ON owner.user_id = r.user_id AND owner.source_key = 'account:self'
  JOIN people contact ON contact.user_id = r.user_id AND contact.source_key = 'whatsapp:' || r.contact_jid;
