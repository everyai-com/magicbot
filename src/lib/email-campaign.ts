import { z } from "zod";
const contactSchema = z.record(z.string(), z.unknown());
const templateSchema = z.object({ to: z.string().default("<<email>>"), subject: z.string().min(1), body: z.string().min(1) });
const normalize = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

export function prepareEmailContacts(contacts: z.infer<typeof contactSchema>[], selected: number[], message: string) {
  const template = templateSchema.parse(JSON.parse(message));
  const placeholders = [...(template.to + "\n" + template.subject + "\n" + template.body).matchAll(/<<\s*([^<>]+?)\s*>>/g)].map((match) => match[1].trim());
  if (!selected.length) throw new Error("Select at least one contact.");
  const indexes = new Set(selected);
  if (selected.some((index) => !Number.isInteger(index) || index < 0 || index >= contacts.length)) throw new Error("The contact selection changed. Select your recipients again.");
  return contacts.map((contact, index) => {
    if (!indexes.has(index)) return contact;
    let rawMetadata = contact.metadata;
    const serialized = z.string().safeParse(rawMetadata);
    if (serialized.success) rawMetadata = JSON.parse(serialized.data);
    const metadata = contactSchema.safeParse(rawMetadata);
    const fields = { ...contact, ...(metadata.success ? metadata.data : {}) };
    const values = new Map(Object.entries(fields).map(([key, value]) => [normalize(key), value]));
    // Imported metadata takes precedence over stale canonical fields.
    const lookup = (aliases: string[]) => {
      for (const source of [metadata.success ? metadata.data : {}, fields]) {
        const entry = Object.entries(source).find(([key]) => aliases.includes(normalize(key)));
        if (entry) return entry[1];
      }
      return undefined;
    };
    const name = lookup(["name", "firstname", "fullname", "contactname"]);
    const email = lookup(["email", "emailaddress"]);
    const phone = lookup(["phone", "phonenumber", "mobile", "mobilenumber"]);
    const parsedEmail = z.string().trim().email().safeParse(email);
    if (!parsedEmail.success) throw new Error(`Contact ${index + 1} has no valid email. Edit the email or deselect this contact.`);
    for (const alias of ["name", "firstname", "fullname", "contactname"]) values.set(alias, name);
    for (const alias of ["email", "emailaddress"]) values.set(alias, parsedEmail.data);
    for (const alias of ["phone", "phonenumber", "mobile", "mobilenumber"]) values.set(alias, phone);
    fields.name = name ?? ""; fields.first_name = name ?? ""; fields.email = parsedEmail.data;
    for (const placeholder of placeholders) {
      const value = values.get(normalize(placeholder));
      const scalar = z.union([z.string(), z.number(), z.boolean()]).safeParse(value);
      if (!scalar.success || String(scalar.data).trim() === "") throw new Error(`Contact ${index + 1} is missing a value for <<${placeholder}>>. Edit the contact before starting.`);
      fields[placeholder] = String(scalar.data);
    }
    const recipient = template.to.replace(/<<\s*([^<>]+?)\s*>>/g, (_, key: string) => String(values.get(normalize(key)) ?? "")).trim();
    if (recipient.toLowerCase() !== parsedEmail.data.toLowerCase()) throw new Error("Set the template To field to <<email>> so each message goes to its contact’s email.");
    return fields;
  });
}
