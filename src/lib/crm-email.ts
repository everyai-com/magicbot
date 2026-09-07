export interface EmailTemplate { to: string; subject: string; body: string }
export function gmailDraftUrl(template: EmailTemplate, contact: Record<string, unknown>): string {
  const missing = new Set<string>();
  const metadata = contact.metadata && typeof contact.metadata === "object" && !Array.isArray(contact.metadata) ? contact.metadata as Record<string, unknown> : {};
  const normalize = (key: string) => key.trim().toLowerCase().replace(/\s+/g, "_");
  const values = new Map(Object.entries({ ...contact, ...metadata, name: metadata.name ?? contact.name ?? contact.first_name, phone: contact.phone_number }).map(([key, value]) => [normalize(key), value]));
  const render = (text: string) => text.replace(/<<\s*([^<>]+?)\s*>>/g, (_, key: string) => {
    const value = values.get(normalize(key));
    if (value === undefined || value === null || value === "") { missing.add(key.trim()); return ""; }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") { missing.add(key.trim()); return ""; }
    return String(value);
  });
  const to = render(template.to).trim();
  const subject = render(template.subject);
  const body = render(template.body);
  if (missing.size) throw new Error(`Missing contact fields: ${[...missing].join(", ")}`);
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to)) throw new Error("The template must resolve to one valid recipient email.");
  const url = new URL("https://mail.google.com/mail/");
  url.search = new URLSearchParams({ view: "cm", fs: "1", to, su: subject, body }).toString();
  return url.href;
}
