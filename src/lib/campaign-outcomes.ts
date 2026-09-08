type Row = Record<string, unknown>;
const id = (row: Row) => String(row.id ?? row._id ?? "");
const phone = (value: unknown) => String(value ?? "").replace(/\D/g, "");
export function matchOutcomeContact(outcome: Row, contacts: Row[]): Row | undefined {
  if (outcome.contact_id) return contacts.find((contact) => id(contact) === String(outcome.contact_id));
  const number = phone(outcome.phone_number);
  if (!number) return;
  const matches = contacts.filter((contact) => phone(contact.phone_number) === number);
  return matches.length === 1 ? matches[0] : undefined;
}
