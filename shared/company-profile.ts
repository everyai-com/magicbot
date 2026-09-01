export interface CompanyGlossaryEntry { term: string; meaning: string }
export interface CompanyProfile {
  name: string; description: string; products: string[]; customers: string[]; strategy: string;
  differentiators: string[]; brandVoice: string; facts: string[]; operatingRules: string[]; glossary: CompanyGlossaryEntry[];
}
const clean = (value: unknown, limit: number) => typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, limit) : "";
const list = (value: unknown, limit = 20) => Array.isArray(value) ? [...new Set(value.map((item) => clean(item, 300)).filter(Boolean))].slice(0, limit) : [];
export function normalizeCompanyProfile(value: unknown): CompanyProfile {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const seen = new Set<string>();
  const glossary = Array.isArray(row.glossary) ? row.glossary.flatMap((item) => { const entry = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {}; const term = clean(entry.term, 100); const meaning = clean(entry.meaning, 500); const key = term.toLowerCase(); if (!term || !meaning || seen.has(key)) return []; seen.add(key); return [{ term, meaning }]; }).slice(0, 30) : [];
  return { name: clean(row.name, 160), description: clean(row.description, 2_000), products: list(row.products), customers: list(row.customers), strategy: clean(row.strategy, 3_000), differentiators: list(row.differentiators), brandVoice: clean(row.brandVoice, 2_000), facts: list(row.facts, 40), operatingRules: list(row.operatingRules, 30), glossary };
}
export function renderCompanyProfile(profile: CompanyProfile): string {
  const sections = [`Company context${profile.name ? ` — ${profile.name}` : ""}`];
  if (profile.description) sections.push(`Identity: ${profile.description}`);
  if (profile.products.length) sections.push(`Products and services:\n${profile.products.map((item) => `- ${item}`).join("\n")}`);
  if (profile.customers.length) sections.push(`Customers:\n${profile.customers.map((item) => `- ${item}`).join("\n")}`);
  if (profile.strategy) sections.push(`Current strategy: ${profile.strategy}`);
  if (profile.differentiators.length) sections.push(`Differentiators:\n${profile.differentiators.map((item) => `- ${item}`).join("\n")}`);
  if (profile.brandVoice) sections.push(`Brand voice: ${profile.brandVoice}`);
  if (profile.facts.length) sections.push(`Verified facts:\n${profile.facts.map((item) => `- ${item}`).join("\n")}`);
  if (profile.operatingRules.length) sections.push(`Operating rules:\n${profile.operatingRules.map((item) => `- ${item}`).join("\n")}`);
  if (profile.glossary.length) sections.push(`Glossary:\n${profile.glossary.map((item) => `- ${item.term}: ${item.meaning}`).join("\n")}`);
  return sections.length > 1 ? sections.join("\n\n").slice(0, 10_000) : "";
}
