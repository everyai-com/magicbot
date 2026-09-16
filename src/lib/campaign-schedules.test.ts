import { expect, it } from 'vitest';
import {
  cancelSchedule,
  defaultTimeZone,
  dueSchedules,
  expiredSchedules,
  formatCountdown,
  formatUtcOffset,
  markSchedule,
  pendingSchedules,
  previewSchedule,
  reclaimStaleFiring,
  saveSchedule,
  timeZones,
  tzOffsetMinutes,
  zonedTimeToMs,
} from './campaign-schedules';

it('lists real IANA zones with a sane default', () => {
  expect(timeZones()).toContain('Asia/Kolkata');
  expect(timeZones()).toContain('America/New_York');
  expect(typeof defaultTimeZone()).toBe('string');
});

it('converts wall time in a zone to the right instant', () => {
  // 2026-09-16 10:30 in Kolkata (UTC+5:30) == 05:00 UTC.
  expect(zonedTimeToMs('2026-09-16', '10:30', 'Asia/Kolkata')).toBe(Date.UTC(2026, 8, 16, 5, 0));
  // Winter New York (UTC-5): 09:00 == 14:00 UTC.
  expect(zonedTimeToMs('2026-01-15', '09:00', 'America/New_York')).toBe(Date.UTC(2026, 0, 15, 14, 0));
  // Summer New York (UTC-4): 09:00 == 13:00 UTC.
  expect(zonedTimeToMs('2026-07-15', '09:00', 'America/New_York')).toBe(Date.UTC(2026, 6, 15, 13, 0));
  expect(zonedTimeToMs('bad-date', '10:30', 'Asia/Kolkata')).toBeNull();
  expect(zonedTimeToMs('2026-09-16', '25:00', 'Asia/Kolkata')).toBeNull();
});

it('formats offsets and previews consistently', () => {
  expect(formatUtcOffset('Asia/Kolkata', Date.UTC(2026, 8, 16))).toBe('UTC+05:30');
  expect(formatUtcOffset('America/New_York', Date.UTC(2026, 0, 15))).toBe('UTC-05:00');
  const preview = previewSchedule(Date.UTC(2026, 8, 16, 5, 0), 'Asia/Kolkata', Date.UTC(2026, 8, 15, 5, 0));
  expect(preview.timezone).toBe('Asia/Kolkata');
  expect(preview.offset).toBe('UTC+05:30');
  expect(preview.utc).toContain('05:00');
  expect(preview.relative).toContain('1 day');
  expect(formatCountdown(Date.UTC(2026, 8, 16, 5, 0, 30), Date.UTC(2026, 8, 16, 5, 0))).toBe('in 30s');
});

it('picks due, pending and expired schedules by status and time', () => {
  const now = Date.now();
  const plan = {
    channel: 'voice' as const, campaignId: 'c1', campaignName: 'Test', agent: 'a', phone: 'p',
    template: '', templateMessage: '', audience: '', delay: 30, locking: true,
    contactIds: ['x'], selectedIndexes: [0], snapshotRows: [], preparedRows: null,
  };
  const base = { channel: 'voice' as const, campaignId: 'c1', campaignName: 'Test', timezone: 'Asia/Kolkata', plan };
  const due = saveSchedule({ ...base, atMs: now - 1000 });
  saveSchedule({ ...base, atMs: now + 60000 });
  const fired = saveSchedule({ ...base, atMs: now - 1000 });
  markSchedule(fired.id, { status: 'fired' });
  const old = saveSchedule({ ...base, atMs: now - 25 * 3600 * 1000 });
  expect(dueSchedules(now).map((row) => row.id)).toEqual([due.id]);
  expect(pendingSchedules().some((row) => row.id === old.id)).toBe(false);
  expect(expiredSchedules(now).map((row) => row.id)).toEqual([old.id]);
  markSchedule(old.id, { status: 'missed' });
  expect(expiredSchedules(now)).toHaveLength(0);
  cancelSchedule(due.id);
  expect(dueSchedules(now)).toHaveLength(0);
});

it('reclaims firing items stuck past the crash window', () => {
  const now = Date.now();
  const stuck = saveSchedule({
    channel: 'voice' as const, campaignId: 'c9', campaignName: 'Stuck',
    timezone: 'UTC', atMs: now - 1000,
    plan: {
      channel: 'voice', campaignId: 'c9', campaignName: 'Stuck', agent: 'a', phone: 'p',
      template: '', templateMessage: '', audience: '', delay: 30, locking: true,
      contactIds: ['x'], selectedIndexes: [0], snapshotRows: [], preparedRows: null,
    },
  });
  markSchedule(stuck.id, { status: 'firing', firedAt: now - 11 * 60 * 1000 });
  // A just-claimed item is left alone.
  const fresh = saveSchedule({
    channel: 'voice' as const, campaignId: 'c9', campaignName: 'Fresh',
    timezone: 'UTC', atMs: now - 1000,
    plan: {
      channel: 'voice', campaignId: 'c9', campaignName: 'Fresh', agent: 'a', phone: 'p',
      template: '', templateMessage: '', audience: '', delay: 30, locking: true,
      contactIds: ['x'], selectedIndexes: [0], snapshotRows: [], preparedRows: null,
    },
  });
  markSchedule(fresh.id, { status: 'firing', firedAt: now });
  expect(reclaimStaleFiring(now).map((row) => row.id)).toEqual([stuck.id]);
});

it('tzOffsetMinutes matches known offsets', () => {
  expect(tzOffsetMinutes('Asia/Kolkata', Date.UTC(2026, 8, 16))).toBe(330);
  expect(tzOffsetMinutes('UTC', Date.UTC(2026, 8, 16))).toBe(0);
});
