import { useEffect, useState } from 'react';
import { liveMinuteSeconds, activeMinuteCallStart, pendingMinuteUsage } from '@/lib/minute-balance';
import { api } from '@/state/store';

export function MinuteBalance() {
  const [unlimited, setUnlimited] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [pending, setPending] = useState({ seconds: 0, calls: 0 });
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const [balance, calls] = await Promise.all([api('/api/campaign-workspace/billing/balance'), api('/api/campaign-workspace/call-logs/with-agent-name')]);
        const logs = Array.isArray(calls) ? calls : [];
        if (alive) {
          setUnlimited(balance.unlimited === true);
          setStartedAt(activeMinuteCallStart(logs, Date.now()));
          setPending(pendingMinuteUsage(logs, Date.now()));
          setNow(Date.now());
        }
        if (alive) setSeconds(typeof balance.available_seconds === 'number' && Number.isFinite(balance.available_seconds) ? Math.max(0, balance.available_seconds) : null);
      } catch { if (alive) setSeconds(null); }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    window.addEventListener("minute-balance-changed", refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('campaign-workspace-changed', refresh);
    return () => { clearInterval(timer); window.removeEventListener("minute-balance-changed", refresh); alive = false; window.removeEventListener('focus', refresh); window.removeEventListener('campaign-workspace-changed', refresh); };
  }, []);
  const remaining = seconds === null ? null : liveMinuteSeconds(Math.max(0, seconds - pending.seconds), startedAt, now);
  const title = unlimited
    ? 'Unlimited minutes'
    : seconds === null
      ? 'Minute balance unavailable'
      : `${remaining} seconds remaining${startedAt === null ? "" : " (live estimate)"}${pending.seconds > 0 ? ` · includes ~${pending.seconds}s from ${pending.calls} recent call${pending.calls === 1 ? "" : "s"} not yet reflected in the platform balance` : ""}`;
  return <div className="flex justify-between px-3 py-2 text-sm" title={title}><span className="text-ink-secondary">Minutes Left</span><span>{unlimited ? 'Unlimited' : seconds === null ? '—' : `${Math.floor((remaining ?? 0) / 60)} min`}</span></div>;
}
