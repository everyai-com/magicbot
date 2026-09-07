import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, MoonStar, Sparkles, X } from "lucide-react";
import { api } from "@/state/store";

type Closeout = { id: string; dateKey: string; wins: string[]; lessons: string[]; tomorrowPriorities: string[]; notes: string; updatedAt: number };
type Digest = { completedPriorities: Array<{ id: string; title: string }>; sessions: Array<{ id: string; taskTitle: string; outcome: string; decisions: string[]; openLoops: string[] }>; completedCommitments: Array<{ id: string; text: string; personName: string }> };
type CloseDayData = { existing: Closeout | null; suggestions: { wins: string[]; tomorrowPriorities: string[] }; digest: Digest };

const lines = (value: string) => [...new Set(value.split("\n").map((item) => item.replace(/^[-*]\s*/, "").trim()).filter(Boolean))];
const dateKey = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
const dayRange = () => { const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1); return { start: start.getTime(), end: end.getTime() }; };

export function CloseDayDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CloseDayData | null>(null);
  const [wins, setWins] = useState("");
  const [lessons, setLessons] = useState("");
  const [tomorrow, setTomorrow] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let current = true;
    const range = dayRange();
    setBusy(true); setError("");
    void api(`/api/day-closeout?date=${dateKey()}&start=${range.start}&end=${range.end}`, { cache: "no-store" }).then((result: CloseDayData) => {
      if (!current) return;
      setData(result);
      const source = result.existing;
      setWins((source?.wins ?? result.suggestions.wins).join("\n"));
      setLessons((source?.lessons ?? []).join("\n"));
      setTomorrow((source?.tomorrowPriorities ?? result.suggestions.tomorrowPriorities).join("\n"));
      setNotes(source?.notes ?? "");
    }).catch((reason) => current && setError(reason instanceof Error ? reason.message : "Could not prepare the closeout")).finally(() => current && setBusy(false));
    return () => { current = false; };
  }, [open]);

  const activityCount = useMemo(() => !data ? 0 : data.digest.completedPriorities.length + data.digest.sessions.length + data.digest.completedCommitments.length, [data]);
  const save = async () => {
    setBusy(true); setError("");
    try {
      await api("/api/day-closeout", { method: "POST", body: JSON.stringify({ dateKey: dateKey(), wins: lines(wins), lessons: lines(lessons), tomorrowPriorities: lines(tomorrow), notes }) });
      setOpen(false); onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not close the day"); }
    finally { setBusy(false); }
  };

  return <>
    <button onClick={() => setOpen(true)} className="flex min-h-10 items-center gap-2 rounded-xl bg-accent px-3.5 text-[12.5px] font-medium text-white"><MoonStar size={15} />Close day</button>
    {open && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="close-day-title">
      <div className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-hairline/40 bg-card shadow-2xl sm:max-h-[88dvh] sm:rounded-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-hairline/30 px-4 py-4 sm:px-5">
          <div><div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-accent"><MoonStar size={14} />Daily ritual</div><h2 id="close-day-title" className="mt-1 text-[20px] font-semibold text-ink">{data?.existing ? "Review today’s closeout" : "Close the day"}</h2><p className="mt-1 text-[12px] text-ink-secondary">Keep the signal. Carry only what tomorrow needs.</p></div>
          <button aria-label="Close day dialog" onClick={() => setOpen(false)} className="flex size-10 shrink-0 items-center justify-center rounded-xl text-ink-secondary hover:bg-inset"><X size={18} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {busy && !data ? <div className="flex min-h-48 items-center justify-center"><Loader2 className="animate-spin text-accent" size={22} /></div> : <div className="space-y-4">
            {error && <div role="alert" className="rounded-xl bg-danger/10 px-3 py-2.5 text-[12.5px] text-danger">{error}</div>}
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-inset px-3 py-2.5 text-[11.5px] text-ink-secondary"><Sparkles size={14} className="text-accent" /><span>{activityCount} completed item{activityCount === 1 ? "" : "s"} found today.</span><span>Suggestions are editable.</span></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block"><span className="mb-1.5 block text-[12px] font-medium text-ink">Wins</span><textarea value={wins} onChange={(event) => setWins(event.target.value)} placeholder="One win per line" className="min-h-36 w-full resize-y rounded-xl border border-hairline/40 bg-inset p-3 text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none" /></label>
              <label className="block"><span className="mb-1.5 block text-[12px] font-medium text-ink">Lessons</span><textarea value={lessons} onChange={(event) => setLessons(event.target.value)} placeholder="What should change next time?" className="min-h-36 w-full resize-y rounded-xl border border-hairline/40 bg-inset p-3 text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none" /></label>
            </div>
            <label className="block"><span className="mb-1.5 block text-[12px] font-medium text-ink">Tomorrow’s priorities</span><span className="mb-2 block text-[11px] text-ink-secondary">These become open priorities automatically; duplicates are skipped.</span><textarea value={tomorrow} onChange={(event) => setTomorrow(event.target.value)} placeholder="One priority per line" className="min-h-28 w-full resize-y rounded-xl border border-hairline/40 bg-inset p-3 text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none" /></label>
            <label className="block"><span className="mb-1.5 block text-[12px] font-medium text-ink">Anything else worth carrying?</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={4000} placeholder="Context, energy, risks, or a reminder for your agents…" className="min-h-24 w-full resize-y rounded-xl border border-hairline/40 bg-inset p-3 text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none" /></label>
            {data && data.digest.sessions.length > 0 && <details className="rounded-xl border border-hairline/30 bg-inset p-3"><summary className="cursor-pointer text-[12px] font-medium text-ink">Task closeouts used as suggestions ({data.digest.sessions.length})</summary><div className="mt-2 space-y-2">{data.digest.sessions.map((session) => <div key={session.id} className="text-[11.5px] leading-relaxed text-ink-secondary"><span className="font-medium text-ink">{session.taskTitle}</span> — {session.outcome}</div>)}</div></details>}
          </div>}
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-hairline/30 px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <button onClick={() => setOpen(false)} className="min-h-11 rounded-xl px-4 text-[12.5px] text-ink-secondary hover:bg-inset">Not now</button>
          <button disabled={busy || (!lines(wins).length && !lines(lessons).length && !lines(tomorrow).length && !notes.trim())} onClick={() => void save()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-[12.5px] font-medium text-white disabled:opacity-40">{busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}{data?.existing ? "Update closeout" : "Close today"}</button>
        </footer>
      </div>
    </div>}
  </>;
}
