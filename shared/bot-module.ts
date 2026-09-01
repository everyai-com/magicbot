export const BOT_MODULE_CAPABILITIES = ["browser", "computer", "connected-app", "image", "whatsapp"] as const;
export type BotModuleCapability = (typeof BOT_MODULE_CAPABILITIES)[number];

export type BotModuleDefinition = {
  id: string; slug: string; name: string; version: string; description: string; instructions: string;
  triggerTerms: string[]; requiredCapabilities: BotModuleCapability[]; enabled: boolean;
};

function clean(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, limit) : "";
}

export function moduleSlug(value: unknown): string {
  return clean(value, 100).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

export function normalizeModuleTerms(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(raw.map((item) => clean(item, 80).toLowerCase()).filter(Boolean))].slice(0, 20);
}

export function normalizeModuleCapabilities(value: unknown): BotModuleCapability[] {
  const raw = Array.isArray(value) ? value : [];
  return [...new Set(raw.filter((item): item is BotModuleCapability =>
    typeof item === "string" && BOT_MODULE_CAPABILITIES.includes(item as BotModuleCapability)))].slice(0, BOT_MODULE_CAPABILITIES.length);
}

export function normalizeBotModuleInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Module data is invalid");
  const raw = value as Record<string, unknown>;
  const name = clean(raw.name, 100).replace(/\s+/g, " ");
  const slug = moduleSlug(raw.slug || name);
  const instructions = clean(raw.instructions, 30_000);
  const triggerTerms = normalizeModuleTerms(raw.triggerTerms);
  if (!name) throw new Error("Module name is required");
  if (!slug) throw new Error("Module name needs letters or numbers");
  if (!instructions) throw new Error("Module instructions are required");
  if (!triggerTerms.length) throw new Error("Add at least one trigger phrase");
  const version = clean(raw.version, 20) || "1.0.0";
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Module version must use x.y.z");
  return { slug, name, version, description: clean(raw.description, 500), instructions, triggerTerms,
    requiredCapabilities: normalizeModuleCapabilities(raw.requiredCapabilities) };
}

export function parseSkillMarkdown(value: unknown): { name: string; description: string; instructions: string } {
  const markdown = clean(value, 30_000);
  if (!markdown.startsWith("---\n")) throw new Error("SKILL.md needs YAML frontmatter");
  const end = markdown.indexOf("\n---", 4);
  if (end < 0) throw new Error("SKILL.md frontmatter is not closed");
  const frontmatter = markdown.slice(4, end).split("\n");
  const field = (key: string) => frontmatter.find((line) => line.trimStart().startsWith(`${key}:`))?.split(":").slice(1).join(":").trim().replace(/^['"]|['"]$/g, "") ?? "";
  const name = clean(field("name"), 100).replace(/\s+/g, " ");
  const description = clean(field("description"), 500).replace(/\s+/g, " ");
  const instructions = clean(markdown.slice(end + 4), 30_000);
  if (!name) throw new Error("SKILL.md frontmatter needs a name");
  if (!description) throw new Error("SKILL.md frontmatter needs a description");
  if (!instructions) throw new Error("SKILL.md needs instructions after its frontmatter");
  return { name, description, instructions };
}

export function selectBotModules(query: string, capabilities: Iterable<string>, modules: readonly BotModuleDefinition[]): BotModuleDefinition[] {
  const haystack = query.toLowerCase();
  const available = new Set(capabilities);
  return modules.filter((module) => module.enabled && module.requiredCapabilities.every((capability) => available.has(capability)) &&
    module.triggerTerms.some((term) => haystack.includes(term.toLowerCase()))).slice(0, 3);
}

export function renderBotModules(modules: readonly BotModuleDefinition[]): string {
  let remaining = 40_000;
  return modules.map((module) => {
    const instructions = module.instructions.replace(/<\/magicbot-module>/gi, "&lt;/magicbot-module>").slice(0, remaining);
    remaining -= instructions.length;
    return instructions ? `<magicbot-module id=${JSON.stringify(module.slug)} version=${JSON.stringify(module.version)}>\n${instructions}\n</magicbot-module>` : "";
  }).filter(Boolean).join("\n\n");
}
