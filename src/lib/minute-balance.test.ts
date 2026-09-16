import { expect, it } from 'vitest';
import { liveMinuteSeconds } from './minute-balance';
it('counts elapsed seconds without rounding up or allowing negative balances', () => {
  expect(liveMinuteSeconds(300, null, 90000)).toBe(300);
  expect(liveMinuteSeconds(300, 1000, 91500)).toBe(210);
  expect(liveMinuteSeconds(30, 1000, 91000)).toBe(0);
  expect(liveMinuteSeconds(30, 1000, 0)).toBe(30);
});

import { activeMinuteCallStart, pendingMinuteUsage } from './minute-balance';
it('counts only recent active uncharged calls', () => {
  expect(activeMinuteCallStart([{ status: 'connected', started_at: 1000 }], 61000)).toBe(1000);
  for (const extra of [{ ended_at: 2000 }, { billing_status: 'charged' }, { status: 'completed' }, { status: 'ringing', started_at: 1 }]) {
    expect(activeMinuteCallStart([{ status: 'connected', started_at: 1000, ...extra }], 200000)).toBeNull();
  }
});
it('counts only unsettled completed usage as pending', () => {
  const now = Date.parse('2026-09-14T18:00:00Z');
  const fresh = new Date(now - 30 * 60 * 1000).toISOString();
  // Explicitly unsettled billing counts.
  expect(pendingMinuteUsage([{ status: 'completed', started_at: fresh, billed_seconds: 348, billing_status: 'pending' }], now))
    .toEqual({ seconds: 348, calls: 1 });
  // Settled billing never counts, even when fresh.
  expect(pendingMinuteUsage([{ status: 'completed', started_at: fresh, billed_seconds: 348, billing_status: 'charged' }], now))
    .toEqual({ seconds: 0, calls: 0 });
  // Unknown billing signals are ignored rather than double counted.
  expect(pendingMinuteUsage([{ status: 'completed', started_at: fresh, billed_seconds: 348, billing_status: 'mystery' }], now))
    .toEqual({ seconds: 0, calls: 0 });
  // No billing signal: only fresh completions count.
  expect(pendingMinuteUsage([{ status: 'completed', started_at: fresh, billed_seconds: 60 }], now))
    .toEqual({ seconds: 60, calls: 1 });
  expect(pendingMinuteUsage([{ status: 'completed', started_at: new Date(now - 30 * 3600 * 1000).toISOString(), billed_seconds: 60 }], now))
    .toEqual({ seconds: 0, calls: 0 });
  // Non-final statuses and unbilled rows never count.
  expect(pendingMinuteUsage([
    { status: 'initiated', started_at: fresh, billed_seconds: 60, billing_status: 'pending' },
    { status: 'completed', started_at: fresh, billing_status: 'pending' },
  ], now)).toEqual({ seconds: 0, calls: 0 });
});
