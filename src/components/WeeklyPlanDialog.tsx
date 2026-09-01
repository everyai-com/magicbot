import { useEffect, useMemo, useState } from "react";
import { CalendarRange, CheckCircle2, Loader2, Sparkles, X } from "lucide-react";
import { api } from "@/state/store";

type DayPlan = { dateKey: string; priorities: string[] };
type WeeklyPlan = { id: string; weekKey: string; outcomes: string[]; focusAreas: string[]; risks: string[]; notToDo: string[]; days: DayPlan[]; notes: string };
type WeeklyData = { existing: WeeklyPlan | null; suggestions: { outcomes: string[]; focusAreas: string[]; risks: string[]; days: DayPlan[] }; digest: { openPriorities: unknown[]; closeouts: unknown[]; sessions: unknown[]; commitments: unknown[] } };
const cleanLines = (value: string) => [...new Set(value.split("\n").map((item) => item.replace(/^[-*]\s*/, "").trim()).filter(Boolean))];
const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
function weekDates() { const today = new Date(); const monday = new Date(today); monday.setHours(0, 0, 0, 0); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7)); return Array.from({ length: 5 }, (_, index) => { const date = new Date(monday); date.setDate(monday.getDate() + index); return date; }); }

export function WeeklyPlanDialog() {
  const dates = useMemo(weekDates, []);
  const [open, setOpen] = useState(false); const [data, setData] = useState<WeeklyData | null>(null);
  const [outcomes, setOutcomes] = useState(""); const [focusAreas, setFocusAreas] = useState(""); const [risks, setRisks] = useState(""); const [notToDo, setNotToDo] = useState(""); const [notes, setNotes] = useState("");
  const [days, setDays] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return; let current = true; setBusy(true); setError("");
    const end = Date.now() + 1; const start = end - 7 * 24 * 60 * 60_000; const keys = dates.map(localDateKey);
    void api(`/api/weekly-plan?week=${keys[0]}&start=${start}&end=${end}&dates=${keys.join(",")}`, { cache: "no-store" }).then((result: WeeklyData) => {
      if (!current) return; setData(result); const plan = result.existing;
      setOutcomes((plan?.outcomes ?? result.suggestions.outcomes).join("\n")); setFocusAreas((plan?.focusAreas ?? result.suggestions.focusAreas).join("\n")); setRisks((plan?.risks ?? result.suggestions.risks).join("\n")); setNotToDo((plan?.notToDo ?? []).join("\n")); setNotes(plan?.notes ?? "");
      const sourceDays = plan?.days ?? result.suggestions.days; setDays(Object.fromEntries(keys.map((key) => [key, sourceDays.find((day) => day.dateKey === key)?.priorities.join("\n") ?? ""])));
    }).catch((reason) => current && setError(reason instanceof Error ? reason.message : "Could not prepare the weekly plan")).finally(() => current && setBusy(false));
    return () => { current = false; };
  }, [open, dates]);

  const evidenceCount = !data ? 0 : data.digest.openPriorities.length + data.digest.closeouts.length + data.digest.sessions.length + data.digest.commitments.length;
  const save = async () => {
    setBusy(true); setError("");
    try { await api("/api/weekly-plan", { method: "POST", body: JSON.stringify({ weekKey: localDateKey(dates[0]), outcomes: cleanLines(outcomes), focusAreas: cleanLines(focusAreas), risks: cleanLines(risks), notToDo: cleanLines(notToDo), days: dates.map((date) => ({ dateKey: localDateKey(date), priorities: cleanLines(days[localDateKey(date)] ?? "") })), notes }) }); setOpen(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the weekly plan"); } finally { setBusy(false); }
  };

  return <>
    <button onClick={() => setOpen(true)} className="flex min-h-10 items-center gap-2 rounded-xl border border-hairline/40 bg-card px-3.5 text-[12.5px] font-medium text-ink hover:bg-inset"><CalendarRange size={15} className="text-accent" />Plan week</button>
    {open && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="weekly-plan-title">
      <div className="flex max-h-[96dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-hairline/40 bg-card shadow-2xl sm:max-h-[90dvh] sm:rounded-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-hairline/30 px-4 py-4 sm:px-5"><div><div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[.14em] text-accent"><CalendarRange size={14} />7plan</div><h2 id="weekly-plan-title" className="mt-1 text-[20px] font-semibold text-ink">{data?.existing ? "Review this week" : "Plan the week"}</h2><p className="mt-1 text-[12px] text-ink-secondary">Choose outcomes first, then give each day a job.</p></div><button aria-label="Close weekly plan" onClick={() => setOpen(false)} className="flex size-10 shrink-0 items-center justify-center rounded-xl text-ink-secondary hover:bg-inset"><X size={18} /></button></header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {busy && !data ? <div className="flex min-h-56 items-center justify-center"><Loader2 className="animate-spin text-accent" size={22} /></div> : <div className="space-y-4">
            {error && <div role="alert" className="rounded-xl bg-danger/10 px-3 py-2.5 text-[12.5px] text-danger">{error}</div>}
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-inset px-3 py-2.5 text-[11.5px] text-ink-secondary"><Sparkles size={14} className="text-accent" />{evidenceCount} planning signal{evidenceCount === 1 ? "" : "s"} found from the last seven days. Everything remains editable.</div>
            <div className="grid gap-4 md:grid-cols-2"><label><span className="mb-1.5 block text-[12px] font-medium text-ink">Weekly outcomes</span><span className="mb-2 block text-[11px] text-ink-secondary">Up to five results—not activities.</span><textarea value={outcomes} onChange={(event) => setOutcomes(event.target.value)} placeholder="One outcome per line" className="min-h-40 w-full resize-y rounded-xl border border-hairline/40 bg-inset p-3 text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none" /></label><label><span className="mb-1.5 block text-[12px] font-medium text-ink">Focus areas</span><span className="mb-2 block text-[11px] text-ink-secondary">Themes your agents should protect.</span><textarea value={focusAreas} onChange={(event) => setFocusAreas(event.target.value)} placeholder="One focus area per line" className="min-h-40 w-full resize-y rounded-xl border border-hairline/40 bg-inset p-3 text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none" /></label></div>
            <section><h3 className="text-[13px] font-semibold text-ink">Daily plan</h3><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{dates.map((date) => { const key = localDateKey(date); return <label key={key} className="rounded-xl border border-hairline/35 bg-inset p-2.5"><span className="block text-[11.5px] font-medium text-ink">{date.toLocaleDateString([], { weekday: "short" })}</span><span className="text-[10px] text-ink-secondary">{date.toLocaleDateString([], { month: "short", day: "numeric" })}</span><textarea aria-label={`${date.toLocaleDateString([], { weekday: "long" })} priorities`} value={days[key] ?? ""} onChange={(event) => setDays((current) => ({ ...current, [key]: event.target.value }))} placeholder="Priorities" className="mt-2 min-h-28 w-full resize-y rounded-lg border border-hairline/30 bg-card p-2 text-[11.5px] leading-relaxed text-ink focus:border-accent focus:outline-none" /></label>; })}</div></section>
            <div className="grid gap-4 md:grid-cols-2"><label><span className="mb-1.5 block text-[12px] font-medium text-ink">Risks and watch-outs</span><textarea value={risks} onChange={(event) => setRisks(event.target.value)} placeholder="One risk per line" className="min-h-28 w-full resize-y rounded-xl border border-hairline/40 bg-inset p-3 text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none" /></label><label><span className="mb-1.5 block text-[12px] font-medium text-ink">Not doing this week</span><textarea value={notToDo} onChange={(event) => setNotToDo(event.target.value)} placeholder="One deliberate tradeoff per line" className="min-h-28 w-full resize-y rounded-xl border border-hairline/40 bg-inset p-3 text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none" /></label></div>
            <label className="block"><span className="mb-1.5 block text-[12px] font-medium text-ink">Notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={4000} placeholder="Context or constraints for the week…" className="min-h-24 w-full resize-y rounded-xl border border-hairline/40 bg-inset p-3 text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none" /></label>
          </div>}
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-hairline/30 px-4 py-3 sm:flex-row sm:justify-end sm:px-5"><button onClick={() => setOpen(false)} className="min-h-11 rounded-xl px-4 text-[12.5px] text-ink-secondary hover:bg-inset">Not now</button><button disabled={busy || !cleanLines(outcomes).length} onClick={() => void save()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-[12.5px] font-medium text-white disabled:opacity-40">{busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}{data?.existing ? "Update week" : "Save week"}</button></footer>
      </div>
    </div>}
  </>;
}
