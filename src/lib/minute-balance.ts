export function liveMinuteSeconds(seconds: number, startedAt: number | null, now: number): number {
  return Math.max(0, seconds - (startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000))));
}

const UNSETTLED_BILLING = new Set(['pending', 'unbilled', 'unsettled', 'unpaid', 'initiated', 'processing', 'open']);
const SETTLED_BILLING = new Set(['charged', 'billed', 'settled', 'paid', 'free', 'waived']);

function billedSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === 'string') {
    const match = value.trim().match(/^([\d.]+)\s*s$/i);
    if (match && Number(match[1]) > 0) return Math.round(Number(match[1]));
  }
  return null;
}

function logStartMs(log: Record<string, unknown>): number {
  return new Date(log.started_at as string | number).getTime();
}

/** Usage the platform balance may not reflect yet: completed calls whose
 *  billing is explicitly unsettled, plus fresh completions (24h) with no
 *  billing signal at all. Bounded and disclosed — never silently double
 *  counted once the platform settles. */
export function pendingMinuteUsage(logs: Record<string, unknown>[], now: number): { seconds: number; calls: number } {
  let seconds = 0;
  let calls = 0;
  for (const log of logs) {
    const status = String(log.status ?? '').toLowerCase();
    if (!['completed', 'answered'].includes(status)) continue;
    const billed = billedSeconds(log.billed_seconds ?? log.billedDuration ?? log.duration);
    if (billed === null) continue;
    const start = logStartMs(log);
    if (!Number.isFinite(start) || start > now || now - start > 7 * 24 * 3600 * 1000) continue;
    const billing = String(log.billing_status ?? '').toLowerCase();
    if (billing && !UNSETTLED_BILLING.has(billing) && !SETTLED_BILLING.has(billing)) continue;
    if (billing && SETTLED_BILLING.has(billing)) continue;
    // No billing signal at all: only trust fresh completions, after
    // which the platform balance is assumed to include them.
    if (!billing && now - start > 24 * 3600 * 1000) continue;
    seconds += billed;
    calls += 1;
  }
  return { seconds, calls };
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
