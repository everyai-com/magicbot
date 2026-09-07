import { useEffect, useState } from "react";
import { Archive, CheckCircle2, Loader2, X } from "lucide-react";
import { api, useStore, type Bot } from "@/state/store";
import { COMPACT_BUBBLE } from "@/lib/compact-chip";
import { cn } from "@/lib/cn";

type ExistingCloseout = { id: string; outcome: string; decisions: string[]; openLoops: string[]; nextTaskId: string | null; createdAt: number };

const fieldClass = "w-full rounded-xl border border-hairline/40 bg-inset px-3 py-2.5 text-[13px] text-ink placeholder:text-ink-secondary focus:border-accent focus:outline-none";
const lines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);

export function SessionCloseButton({ bot, mobile = false }: { bot: Bot; mobile?: boolean }) {
  const { dispatch } = useStore();
  const task = bot.tasks?.find((item) => item.threadId === bot.threadId);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [existing, setExisting] = useState<ExistingCloseout | null>(null);
  const [suggested, setSuggested] = useState("");
  const [outcome, setOutcome] = useState("");
  const [decisions, setDecisions] = useState("");
  const [openLoops, setOpenLoops] = useState("");
  const [createNext, setCreateNext] = useState(true);
  const [nextTitle, setNextTitle] = useState(task ? `Continue: ${task.title}`.slice(0, 120) : "Next task");
  const [promoteOpenLoops, setPromoteOpenLoops] = useState(true);

  useEffect(() => {
    if (!open || !task) return;
    setLoading(true);
    setError("");
    void api(`/api/bots/${bot.id}/tasks/${task.threadId}/closeout`)
      .then((result: { closeout: ExistingCloseout | null; suggestedOutcome: string }) => {
        setExisting(result.closeout);
        setSuggested(result.suggestedOutcome ?? "");
        if (result.closeout) {
          setOutcome(result.closeout.outcome);
          setDecisions(result.closeout.decisions.join("\n"));
          setOpenLoops(result.closeout.openLoops.join("\n"));
        }
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load closeout"))
      .finally(() => setLoading(false));
  }, [open, bot.id, task]);

  if (!task) return null;
  if (task.closedAt && !open) return (
    <button onClick={() => setOpen(true)} title="View session closeout" aria-label="View session closeout" className={cn("flex items-center gap-1.5 text-success", mobile ? "size-11 justify-center rounded-xl" : `rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-[12px] ${COMPACT_BUBBLE}`)}>
      <CheckCircle2 size={mobile ? 18 : 13} /><span className={mobile ? "sr-only" : "@max-4xl/chathead:hidden"}>Closed</span>
    </button>
  );

  const closeSession = async () => {
    if (!outcome.trim()) { setError("Record the outcome before closing this task."); return; }
    setSaving(true);
    setError("");
    try {
      const result = await api(`/api/bots/${bot.id}/tasks/${task.threadId}/closeout`, {
        method: "POST",
        body: JSON.stringify({ outcome, decisions: lines(decisions), openLoops: lines(openLoops), createNext, nextTitle, promoteOpenLoops }),
      }) as { bot: Bot };
      dispatch({ type: "taskSwitched", bot: result.bot });
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not close this task");
    } finally { setSaving(false); }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} disabled={bot.busy} title={bot.busy ? "Let this turn finish first" : "Close session and carry work forward"} aria-label="Close session" className={cn("flex items-center text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40", mobile ? "size-11 justify-center rounded-xl" : `gap-1.5 rounded-full border border-hairline/40 px-2.5 py-1 text-[12px] ${COMPACT_BUBBLE}`)}>
        <Archive size={mobile ? 18 : 13} /><span className={mobile ? "sr-only" : "@max-4xl/chathead:hidden"}>Close</span>
      </button>
      {open && <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-5" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
        <section role="dialog" aria-modal="true" aria-labelledby="close-session-title" className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-hairline/50 bg-card shadow-2xl sm:rounded-2xl">
          <header className="flex items-start justify-between gap-3 border-b border-hairline/30 px-4 py-4 sm:px-5"><div><h2 id="close-session-title" className="text-[17px] font-semibold text-ink">{existing ? "Session closeout" : "Close this session"}</h2><p className="mt-0.5 text-[12px] text-ink-secondary">{task.title} · {bot.name}</p></div><button onClick={() => setOpen(false)} aria-label="Close" className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"><X size={18} /></button></header>
          <div className="overflow-y-auto px-4 py-4 sm:px-5">
            {loading ? <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-ink-secondary"><Loader2 size={16} className="animate-spin" />Loading closeout…</div> : <div className="space-y-4">
              <label className="block text-[12px] font-medium text-ink-secondary">Outcome
                <textarea rows={5} value={outcome} onChange={(event) => setOutcome(event.target.value)} readOnly={Boolean(existing)} placeholder="What was completed, learned, or delivered?" className={`${fieldClass} mt-1.5 resize-y`} />
              </label>
              {!existing && suggested && !outcome && <button onClick={() => setOutcome(suggested)} className="-mt-2 text-[11.5px] font-medium text-accent hover:underline">Use the task summary as a starting point</button>}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-[12px] font-medium text-ink-secondary">Decisions <span className="font-normal">· one per line</span><textarea rows={4} value={decisions} onChange={(event) => setDecisions(event.target.value)} readOnly={Boolean(existing)} placeholder={"Use D1 for persistence\nKeep approvals human-gated"} className={`${fieldClass} mt-1.5 resize-y`} /></label>
                <label className="block text-[12px] font-medium text-ink-secondary">Open loops <span className="font-normal">· one per line</span><textarea rows={4} value={openLoops} onChange={(event) => setOpenLoops(event.target.value)} readOnly={Boolean(existing)} placeholder={"Verify production analytics\nFollow up with design"} className={`${fieldClass} mt-1.5 resize-y`} /></label>
              </div>
              {existing ? <div className="rounded-xl border border-success/25 bg-success/10 px-4 py-3 text-[12.5px] text-success">Closed {new Date(existing.createdAt).toLocaleString()}{existing.nextTaskId ? " · Continued in a linked task" : ""}</div> : <div className="space-y-3 rounded-xl bg-inset p-3.5">
                <label className="flex min-h-10 cursor-pointer items-center gap-3 text-[13px] text-ink"><input type="checkbox" checked={createNext} onChange={(event) => setCreateNext(event.target.checked)} className="size-4 accent-[var(--color-accent)]" /><span>Start a clean task with this handoff</span></label>
                {createNext && <input value={nextTitle} onChange={(event) => setNextTitle(event.target.value)} maxLength={120} aria-label="Next task title" className={fieldClass} />}
                <label className="flex min-h-10 cursor-pointer items-center gap-3 text-[13px] text-ink"><input type="checkbox" checked={promoteOpenLoops} onChange={(event) => setPromoteOpenLoops(event.target.checked)} className="size-4 accent-[var(--color-accent)]" /><span>Add open loops to Today priorities</span></label>
              </div>}
              {error && <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}
            </div>}
          </div>
          {!existing && !loading && <footer className="flex flex-col-reverse gap-2 border-t border-hairline/30 px-4 py-3 sm:flex-row sm:justify-end sm:px-5"><button onClick={() => setOpen(false)} className="min-h-11 rounded-xl px-4 text-[13px] text-ink-secondary hover:bg-raised">Cancel</button><button onClick={() => void closeSession()} disabled={saving || !outcome.trim()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[13px] font-medium text-white disabled:opacity-40">{saving && <Loader2 size={14} className="animate-spin" />}{createNext ? "Close & continue" : "Close session"}</button></footer>}
        </section>
      </div>}
    </>
  );
}
