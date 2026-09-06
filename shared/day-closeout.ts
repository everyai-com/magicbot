export interface DayCloseoutInput {
  dateKey: string;
  wins: string[];
  lessons: string[];
  tomorrowPriorities: string[];
  notes: string;
}

const cleanText = (value: unknown, limit: number) => typeof value === "string"
  ? value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, limit)
  : "";

const cleanList = (value: unknown, limit = 12) => Array.isArray(value)
  ? [...new Set(value.map((item) => cleanText(item, 300)).filter(Boolean))].slice(0, limit)
  : [];

export function normalizeDateKey(value: unknown): string {
  const text = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : "";
}

export function normalizeDayCloseout(value: unknown): DayCloseoutInput {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    dateKey: normalizeDateKey(record.dateKey),
    wins: cleanList(record.wins),
    lessons: cleanList(record.lessons),
    tomorrowPriorities: cleanList(record.tomorrowPriorities, 8),
    notes: cleanText(record.notes, 4_000),
  };
}

export function normalizeDayRange(start: unknown, end: unknown): { startAt: number; endAt: number } | null {
  const startAt = Number(start);
  const endAt = Number(end);
  const duration = endAt - startAt;
  if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt) || duration < 20 * 60 * 60_000 || duration > 28 * 60 * 60_000) return null;
  if (Math.abs(Date.now() - startAt) > 370 * 24 * 60 * 60_000) return null;
  return { startAt, endAt };
}

export function renderDayCloseout(input: DayCloseoutInput): string {
  const sections = [`End-of-day closeout (${input.dateKey})`];
  if (input.wins.length) sections.push(`Wins:\n${input.wins.map((item) => `- ${item}`).join("\n")}`);
  if (input.lessons.length) sections.push(`Lessons:\n${input.lessons.map((item) => `- ${item}`).join("\n")}`);
  if (input.tomorrowPriorities.length) sections.push(`Next priorities:\n${input.tomorrowPriorities.map((item) => `- ${item}`).join("\n")}`);
  if (input.notes) sections.push(`Notes:\n${input.notes}`);
  return sections.join("\n\n").slice(0, 6_000);
}
