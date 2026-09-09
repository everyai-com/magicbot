import { chmodSync, closeSync, existsSync, openSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DATA_DIR } from "./config.ts";

const DB_FILE = () => join(DATA_DIR, "messages.db");

let handle: DatabaseSync | null = null;
let handlePath: string | null = null;

function open(): DatabaseSync {
  const file = DB_FILE();
  closeSync(openSync(file, "a", 0o600));
  try {
    chmodSync(file, 0o600);
  } catch {}
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS whatsapp_audiences (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS whatsapp_audience_contacts (
      audience_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (audience_id, contact_id),
      FOREIGN KEY (audience_id) REFERENCES whatsapp_audiences(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES whatsapp_contacts(id) ON DELETE CASCADE
    );
  `);
  return db;
}

function db(): DatabaseSync {
  if (handle && handlePath === DB_FILE() && existsSync(DB_FILE())) return handle;
  try {
    handle?.close();
  } catch {}
  handle = open();
  handlePath = DB_FILE();
  return handle;
}

export interface WhatsAppContact {
  id: string;
  name: string;
  phone: string;
  createdAt: number;
  updatedAt: number;
}

export interface WhatsAppAudience {
  id: string;
  name: string;
  description: string | null;
  contactIds: string[];
  contacts: WhatsAppContact[];
  createdAt: number;
  updatedAt: number;
}

export interface WhatsAppContactInput {
  id: string;
  name: string;
  phone: string;
}

function contactFromRow(row: {
  id: string;
  name: string;
  phone: string;
  created_at: number;
  updated_at: number;
}): WhatsAppContact {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listWhatsappContacts(): WhatsAppContact[] {
  const rows = db()
    .prepare("SELECT id, name, phone, created_at, updated_at FROM whatsapp_contacts ORDER BY created_at DESC")
    .all() as Array<{ id: string; name: string; phone: string; created_at: number; updated_at: number }>;
  return rows.map(contactFromRow);
}

export function upsertWhatsappContact(input: WhatsAppContactInput): WhatsAppContact {
  const now = Date.now();
  const database = db();
  const existing = database
    .prepare("SELECT id, name, phone, created_at, updated_at FROM whatsapp_contacts WHERE phone = ?")
    .get(input.phone) as { id: string; name: string; phone: string; created_at: number; updated_at: number } | undefined;

  if (existing) {
    database.prepare("UPDATE whatsapp_contacts SET name = ?, updated_at = ? WHERE id = ?").run(input.name, now, existing.id);
  } else {
    database
      .prepare("INSERT INTO whatsapp_contacts (id, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(input.id, input.name, input.phone, now, now);
  }

  const saved = database
    .prepare("SELECT id, name, phone, created_at, updated_at FROM whatsapp_contacts WHERE phone = ?")
    .get(input.phone) as { id: string; name: string; phone: string; created_at: number; updated_at: number } | undefined;
  if (!saved) throw new Error("contact was not saved");
  return contactFromRow(saved);
}

export function upsertWhatsappContacts(inputs: WhatsAppContactInput[]): WhatsAppContact[] {
  const saved: WhatsAppContact[] = [];
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const input of inputs) saved.push(upsertWhatsappContact(input));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return saved;
}

export function updateWhatsappContact(input: WhatsAppContactInput): WhatsAppContact {
  const database = db();
  const existing = database
    .prepare("SELECT id FROM whatsapp_contacts WHERE id = ?")
    .get(input.id) as { id: string } | undefined;
  if (!existing) throw new Error("contact not found");
  const duplicate = database
    .prepare("SELECT id FROM whatsapp_contacts WHERE phone = ? AND id != ?")
    .get(input.phone, input.id) as { id: string } | undefined;
  if (duplicate) throw new Error("phone number already exists");
  const now = Date.now();
  database.prepare("UPDATE whatsapp_contacts SET name = ?, phone = ?, updated_at = ? WHERE id = ?").run(input.name, input.phone, now, input.id);
  const saved = database
    .prepare("SELECT id, name, phone, created_at, updated_at FROM whatsapp_contacts WHERE id = ?")
    .get(input.id) as { id: string; name: string; phone: string; created_at: number; updated_at: number } | undefined;
  if (!saved) throw new Error("contact was not saved");
  return contactFromRow(saved);
}

export function deleteWhatsappContact(id: string): void {
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("DELETE FROM whatsapp_audience_contacts WHERE contact_id = ?").run(id);
    const result = database.prepare("DELETE FROM whatsapp_contacts WHERE id = ?").run(id);
    if (result.changes === 0) throw new Error("contact not found");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listWhatsappAudiences(): WhatsAppAudience[] {
  const database = db();
  const audienceRows = database
    .prepare("SELECT id, name, description, created_at, updated_at FROM whatsapp_audiences ORDER BY created_at DESC")
    .all() as Array<{ id: string; name: string; description: string | null; created_at: number; updated_at: number }>;
  const contactRows = database
    .prepare(
      "SELECT ac.audience_id, c.id, c.name, c.phone, c.created_at, c.updated_at " +
        "FROM whatsapp_audience_contacts ac " +
        "JOIN whatsapp_contacts c ON c.id = ac.contact_id " +
        "ORDER BY ac.created_at",
    )
    .all() as Array<{ audience_id: string; id: string; name: string; phone: string; created_at: number; updated_at: number }>;
  const byAudience = new Map<string, WhatsAppContact[]>();
  for (const row of contactRows) {
    const current = byAudience.get(row.audience_id) ?? [];
    current.push(contactFromRow(row));
    byAudience.set(row.audience_id, current);
  }
  return audienceRows.map((row) => {
    const contacts = byAudience.get(row.id) ?? [];
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      contactIds: contacts.map((contact) => contact.id),
      contacts,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export function createWhatsappAudience(input: {
  id: string;
  name: string;
  description: string | null;
  contacts: WhatsAppContactInput[];
  contactIds: string[];
}): WhatsAppAudience {
  const now = Date.now();
  const database = db();
  const upsertContact = database.prepare(
    "INSERT INTO whatsapp_contacts (id, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, updated_at = excluded.updated_at",
  );
  const contactByPhone = database.prepare(
    "SELECT id, name, phone, created_at, updated_at FROM whatsapp_contacts WHERE phone = ?",
  );
  const insertAudience = database.prepare(
    "INSERT INTO whatsapp_audiences (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  const insertLink = database.prepare(
    "INSERT OR IGNORE INTO whatsapp_audience_contacts (audience_id, contact_id, created_at) VALUES (?, ?, ?)",
  );
  const resolvedContactIds = new Set(input.contactIds);

  database.exec("BEGIN IMMEDIATE");
  try {
    insertAudience.run(input.id, input.name, input.description, now, now);
    for (const contact of input.contacts) {
      upsertContact.run(contact.id, contact.name, contact.phone, now, now);
      const saved = contactByPhone.get(contact.phone) as { id: string } | undefined;
      if (saved?.id) resolvedContactIds.add(saved.id);
    }
    for (const contactId of resolvedContactIds) insertLink.run(input.id, contactId, now);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  const audience = listWhatsappAudiences().find((item) => item.id === input.id);
  if (!audience) throw new Error("audience was not saved");
  return audience;
}

export function updateWhatsappAudience(input: {
  id: string;
  name?: string;
  description?: string | null;
  contacts: WhatsAppContactInput[];
  contactIds: string[];
}): WhatsAppAudience {
  const now = Date.now();
  const database = db();
  const existing = database
    .prepare("SELECT id, name, description FROM whatsapp_audiences WHERE id = ?")
    .get(input.id) as { id: string; name: string; description: string | null } | undefined;
  if (!existing) throw new Error("audience not found");

  const upsertContact = database.prepare(
    "INSERT INTO whatsapp_contacts (id, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, updated_at = excluded.updated_at",
  );
  const contactByPhone = database.prepare(
    "SELECT id, name, phone, created_at, updated_at FROM whatsapp_contacts WHERE phone = ?",
  );
  const updateAudience = database.prepare(
    "UPDATE whatsapp_audiences SET name = ?, description = ?, updated_at = ? WHERE id = ?",
  );
  const deleteLinks = database.prepare("DELETE FROM whatsapp_audience_contacts WHERE audience_id = ?");
  const insertLink = database.prepare(
    "INSERT OR IGNORE INTO whatsapp_audience_contacts (audience_id, contact_id, created_at) VALUES (?, ?, ?)",
  );
  const resolvedContactIds = new Set(input.contactIds);

  database.exec("BEGIN IMMEDIATE");
  try {
    updateAudience.run(input.name ?? existing.name, input.description ?? existing.description, now, input.id);
    for (const contact of input.contacts) {
      upsertContact.run(contact.id, contact.name, contact.phone, now, now);
      const saved = contactByPhone.get(contact.phone) as { id: string } | undefined;
      if (saved?.id) resolvedContactIds.add(saved.id);
    }
    deleteLinks.run(input.id);
    for (const contactId of resolvedContactIds) insertLink.run(input.id, contactId, now);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  const audience = listWhatsappAudiences().find((item) => item.id === input.id);
  if (!audience) throw new Error("audience was not saved");
  return audience;
}

export function deleteWhatsappAudience(id: string): void {
  const result = db().prepare("DELETE FROM whatsapp_audiences WHERE id = ?").run(id);
  if (result.changes === 0) throw new Error("audience not found");
}
