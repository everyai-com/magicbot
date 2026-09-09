export function liveMinuteSeconds(seconds: number, startedAt: number | null, now: number): number {
  return Math.max(0, seconds - (startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000))));
}

export function activeMinuteCallStart(logs: Record<string, unknown>[], now: number): number | null {
  for (const log of logs) {
    const status = String(log.status ?? '').toLowerCase();
    if (log.ended_at || log.billing_status === 'charged' || !['initiated', 'ringing', 'in_progress', 'in-progress', 'active', 'connected'].includes(status)) continue;
    const start = new Date(log.started_at as string | number).getTime();
    const ceiling = ['initiated', 'ringing'].includes(status) ? 120000 : 7200000;
    if (Number.isFinite(start) && start <= now && now - start <= ceiling) return start;
  }
  return null;
}
