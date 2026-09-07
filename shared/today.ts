export type TodayPriorityStatus = "open" | "done";

export interface TodayPriority {
  id: string;
  title: string;
  status: TodayPriorityStatus;
  rank: number;
  dueAt: number | null;
  source: "manual" | "profile" | "agent";
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export function normalizePriorityTitle(value: unknown): string {
  return typeof value === "string" ? value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, 240) : "";
}

export function normalizeDueAt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const dueAt = Number(value);
  return Number.isSafeInteger(dueAt) && dueAt > 0 ? dueAt : null;
}

export function priorityRow(row: {
  id: string; title: string; status: string; rank: number; due_at: number | null; source: string;
  created_at: number; updated_at: number; completed_at: number | null;
}): TodayPriority {
  return {
    id: row.id,
    title: normalizePriorityTitle(row.title),
    status: row.status === "done" ? "done" : "open",
    rank: Number.isFinite(row.rank) ? row.rank : 0,
    dueAt: row.due_at,
    source: row.source === "profile" || row.source === "agent" ? row.source : "manual",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}
