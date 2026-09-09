import { expect, it } from 'vitest';
import { liveMinuteSeconds } from './minute-balance';
it('counts elapsed seconds without rounding up or allowing negative balances', () => {
  expect(liveMinuteSeconds(300, null, 90000)).toBe(300);
  expect(liveMinuteSeconds(300, 1000, 91500)).toBe(210);
  expect(liveMinuteSeconds(30, 1000, 91000)).toBe(0);
  expect(liveMinuteSeconds(30, 1000, 0)).toBe(30);
});

import { activeMinuteCallStart } from './minute-balance';
it('counts only recent active uncharged calls', () => {
  expect(activeMinuteCallStart([{ status: 'connected', started_at: 1000 }], 61000)).toBe(1000);
  for (const extra of [{ ended_at: 2000 }, { billing_status: 'charged' }, { status: 'completed' }, { status: 'ringing', started_at: 1 }]) {
    expect(activeMinuteCallStart([{ status: 'connected', started_at: 1000, ...extra }], 200000)).toBeNull();
  }
});
