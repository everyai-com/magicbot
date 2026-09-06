export type UsageSource = "provider" | "estimated" | "unavailable";

export function estimateTextTokens(value: unknown): number {
  if (typeof value !== "string") return 0;
  const text = value.trim();
  if (!text) return 0;
  return Math.max(1, Math.ceil(new TextEncoder().encode(text).length / 4));
}

export function runDurationMs(startedAt?: number, finishedAt?: number): number | null {
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return null;
  return Math.max(0, Number(finishedAt) - Number(startedAt));
}

export function formatRunDuration(durationMs: number | null | undefined): string {
  if (!Number.isFinite(durationMs) || Number(durationMs) < 0) return "Not reported";
  const seconds = Math.round(Number(durationMs) / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}
