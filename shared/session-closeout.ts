export interface SessionCloseoutInput {
  outcome: string;
  decisions: string[];
  openLoops: string[];
  createNext: boolean;
  nextTitle: string;
  promoteOpenLoops: boolean;
}

const cleanText = (value: unknown, limit: number) => typeof value === "string"
  ? value.replace(/\u0000/g, "").trim().slice(0, limit)
  : "";

const cleanList = (value: unknown) => Array.isArray(value)
  ? [...new Set(value.map((item) => cleanText(item, 300)).filter(Boolean))].slice(0, 20)
  : [];

export function normalizeSessionCloseout(value: unknown): SessionCloseoutInput {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    outcome: cleanText(record.outcome, 4_000),
    decisions: cleanList(record.decisions),
    openLoops: cleanList(record.openLoops),
    createNext: record.createNext !== false,
    nextTitle: cleanText(record.nextTitle, 120),
    promoteOpenLoops: record.promoteOpenLoops !== false,
  };
}

export function renderCarryForward(taskTitle: string, closeout: Pick<SessionCloseoutInput, "outcome" | "decisions" | "openLoops">): string {
  const sections = [`Previous task: ${cleanText(taskTitle, 120)}`, `Outcome:\n${closeout.outcome}`];
  if (closeout.decisions.length) sections.push(`Decisions:\n${closeout.decisions.map((item) => `- ${item}`).join("\n")}`);
  if (closeout.openLoops.length) sections.push(`Open loops:\n${closeout.openLoops.map((item) => `- ${item}`).join("\n")}`);
  return sections.join("\n\n").slice(0, 6_000);
}
