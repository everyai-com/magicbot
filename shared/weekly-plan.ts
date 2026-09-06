export interface WeeklyDayPlan { dateKey: string; priorities: string[] }
export interface WeeklyPlanInput {
  weekKey: string;
  outcomes: string[];
  focusAreas: string[];
  risks: string[];
  notToDo: string[];
  days: WeeklyDayPlan[];
  notes: string;
}

const cleanText = (value: unknown, limit: number) => typeof value === "string"
  ? value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, limit)
  : "";
const cleanList = (value: unknown, limit: number) => Array.isArray(value)
  ? [...new Set(value.map((item) => cleanText(item, 300)).filter(Boolean))].slice(0, limit)
  : [];

export function normalizeWeekDate(value: unknown): string {
  const text = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : "";
}

export function normalizeWeeklyPlan(value: unknown): WeeklyPlanInput {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const seen = new Set<string>();
  const days = Array.isArray(record.days) ? record.days.flatMap((item) => {
    const day = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const dateKey = normalizeWeekDate(day.dateKey);
    if (!dateKey || seen.has(dateKey)) return [];
    seen.add(dateKey);
    return [{ dateKey, priorities: cleanList(day.priorities, 5) }];
  }).slice(0, 7) : [];
  return {
    weekKey: normalizeWeekDate(record.weekKey), outcomes: cleanList(record.outcomes, 5), focusAreas: cleanList(record.focusAreas, 8),
    risks: cleanList(record.risks, 8), notToDo: cleanList(record.notToDo, 8), days, notes: cleanText(record.notes, 4_000),
  };
}

export function normalizeWeekRange(start: unknown, end: unknown): { startAt: number; endAt: number } | null {
  const startAt = Number(start); const endAt = Number(end); const duration = endAt - startAt;
  if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt) || duration < 6 * 24 * 60 * 60_000 || duration > 8 * 24 * 60 * 60_000) return null;
  if (Math.abs(Date.now() - startAt) > 370 * 24 * 60 * 60_000) return null;
  return { startAt, endAt };
}

export function renderWeeklyPlan(plan: WeeklyPlanInput): string {
  const sections = [`Weekly plan (${plan.weekKey})`];
  if (plan.outcomes.length) sections.push(`Outcomes:\n${plan.outcomes.map((item) => `- ${item}`).join("\n")}`);
  if (plan.focusAreas.length) sections.push(`Focus areas:\n${plan.focusAreas.map((item) => `- ${item}`).join("\n")}`);
  if (plan.risks.length) sections.push(`Risks:\n${plan.risks.map((item) => `- ${item}`).join("\n")}`);
  if (plan.notToDo.length) sections.push(`Not doing:\n${plan.notToDo.map((item) => `- ${item}`).join("\n")}`);
  const days = plan.days.filter((day) => day.priorities.length).map((day) => `${day.dateKey}: ${day.priorities.join("; ")}`);
  if (days.length) sections.push(`Daily plan:\n${days.join("\n")}`);
  if (plan.notes) sections.push(`Notes:\n${plan.notes}`);
  return sections.join("\n\n").slice(0, 7_000);
}
