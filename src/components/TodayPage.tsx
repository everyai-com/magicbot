import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Bot, Brain, CalendarClock, Check, CheckCircle2, ChevronRight, Circle, Clock3, Handshake, Loader2, MessageCircle, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import { api, useStore } from "@/state/store";
import type { TodayPriority } from "../../shared/today";
import { cn } from "@/lib/cn";
import { CloseDayDialog } from "@/components/CloseDayDialog";
import { WeeklyPlanDialog } from "@/components/WeeklyPlanDialog";
import { DecisionJournalDialog } from "@/components/DecisionJournalDialog";
import { KnowledgeCaptureDialog } from "@/components/KnowledgeCaptureDialog";
import { DelegationDialog } from "@/components/DelegationDialog";
import { WorkflowDialog } from "@/components/WorkflowDialog";

type Approval = { id: string; kind: "whatsapp-draft" | "tool-action" | "agent-delegation"; title: string; preview: string; risk: string; createdAt: number };
type Upcoming = { id: string; name: string; botId: string; botName: string; nextRunAt: number; runOn: string };
type AgentSummary = { id: string; name: string; title: string; busy: boolean; unread: boolean; color: string };
type ActivityItem = { id: string; kind: "routine" | "autonomy" | "whatsapp" | "delegation"; at: number; title: string; detail: string; status: string; botId?: string | null; botName?: string | null; threadId?: string | null };
type ContextObservation = { id: string; kind: "preference" | "relationship" | "profile" | "habit"; suggestedText: string; confidence: number; sourceBotName: string | null; createdAt: number };
type Commitment = { id: string; personId: string; personName: string; whatsappJid: string | null; direction: "mine" | "theirs"; kind: "promise" | "request" | "follow-up"; text: string; status: "suggested" | "open"; confidence: number; dueAt: number | null; sourceType: string; draftId: string | null; draftStatus: "pending" | "approved" | "sent" | "dismissed" | "failed" | null; createdAt: number };
type TodayData = {
  generatedAt: number;
  priorities: TodayPriority[];
  approvals: Approval[];
  whatsapp: { connected: boolean; unread_count: number; unread_chats: number; latest_message_at: number | null };
  upcoming: Upcoming[];
  agents: AgentSummary[];
  activity: ActivityItem[];
};

const panel = "rounded-2xl border border-hairline/40 bg-card p-4 sm:p-5";

function relativeTime(timestamp: number | null) {
  if (!timestamp) return "No recent activity";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
}

function nextTime(timestamp: number) {
  const date = new Date(timestamp);
  const today = date.toDateString() === new Date().toDateString();
  return `${today ? "Today" : date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function TodayPage() {
  const { dispatch } = useStore();
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [newPriority, setNewPriority] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [workingId, setWorkingId] = useState("");
  const [observations, setObservations] = useState<ContextObservation[]>([]);
  const [editingObservation, setEditingObservation] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [editingCommitment, setEditingCommitment] = useState<string | null>(null);
  const [commitmentText, setCommitmentText] = useState("");
  const [commitmentDue, setCommitmentDue] = useState("");

  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const [today, observed, commitmentData] = await Promise.all([
        api("/api/today") as Promise<TodayData>,
        api("/api/context/observations") as Promise<{ observations: ContextObservation[] }>,
        api("/api/commitments") as Promise<{ commitments: Commitment[] }>,
      ]);
      setData(today);
      setObservations(observed.observations);
      setCommitments(commitmentData.commitments);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load Today"); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const mutate = async (id: string, work: () => Promise<unknown>) => {
    setWorkingId(id);
    setError("");
    try { await work(); await load(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The action did not complete"); }
    finally { setWorkingId(""); }
  };

  const addPriority = async () => {
    const title = newPriority.trim();
    if (!title) return;
    const dueAt = dueDate ? new Date(`${dueDate}T23:59:00`).getTime() : null;
    await mutate("new", () => api("/api/today/priorities", { method: "POST", body: JSON.stringify({ title, dueAt }) }));
    setNewPriority("");
    setDueDate("");
  };

  const reviewObservation = async (observation: ContextObservation, action: "accept" | "correct" | "dismiss") => {
    await mutate(`observation:${observation.id}`, () => api(`/api/context/observations/${observation.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action, ...(action === "correct" ? { text: correction } : {}) }),
    }));
    setEditingObservation(null);
    setCorrection("");
  };

  const commitmentAction = async (commitment: Commitment, action: "accept" | "update" | "complete" | "dismiss") => {
    const dueAt = editingCommitment === commitment.id && commitmentDue ? new Date(`${commitmentDue}T23:59:00`).getTime() : commitment.dueAt;
    const text = editingCommitment === commitment.id ? commitmentText : commitment.text;
    await mutate(`commitment:${commitment.id}`, () => api(`/api/commitments/${commitment.id}`, {
      method: "PATCH", body: JSON.stringify({ action, text, dueAt }),
    }));
    setEditingCommitment(null); setCommitmentText(""); setCommitmentDue("");
  };

  const beginCommitmentEdit = (commitment: Commitment) => {
    setEditingCommitment(commitment.id); setCommitmentText(commitment.text);
    setCommitmentDue(commitment.dueAt ? new Date(commitment.dueAt).toISOString().slice(0, 10) : "");
  };

  const draftCommitment = async (commitment: Commitment) => {
    await mutate(`commitment:${commitment.id}`, () => api(`/api/commitments/${commitment.id}/draft`, { method: "POST" }));
  };

  const openPriorities = useMemo(() => data?.priorities.filter((priority) => priority.status === "open") ?? [], [data]);
  const donePriorities = useMemo(() => data?.priorities.filter((priority) => priority.status === "done") ?? [], [data]);
  const activeAgents = data?.agents.filter((agent) => agent.busy).length ?? 0;

  if (loading) return <main className="flex min-w-0 flex-1 items-center justify-center bg-app"><Loader2 className="animate-spin text-accent" size={22} /></main>;

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-app px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-14 sm:px-5 md:pt-5 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-accent"><Clock3 size={14} />Command center</div>
            <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-ink sm:text-[30px]">Today</h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-secondary">What needs you, what your agents are doing, and what is coming next.</p>
          </div>
          <div className="flex flex-wrap gap-2"><button onClick={() => void load(true)} disabled={refreshing} className="flex min-h-10 items-center gap-2 rounded-xl border border-hairline/40 bg-card px-3 text-[12.5px] text-ink-secondary hover:text-ink disabled:opacity-60"><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />Refresh</button><WorkflowDialog onChanged={() => void load(true)} /><DelegationDialog onChanged={() => void load(true)} /><KnowledgeCaptureDialog /><DecisionJournalDialog /><WeeklyPlanDialog /><CloseDayDialog onSaved={() => void load(true)} /></div>
        </header>

        {error && <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">{error}</div>}

        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3" aria-label="Today summary">
          {[
            { label: "Open priorities", value: openPriorities.length, icon: Circle },
            { label: "Needs review", value: (data?.approvals.length ?? 0) + observations.length + commitments.filter((item) => item.status === "suggested").length, icon: ShieldCheck },
            { label: "Unread WhatsApp", value: data?.whatsapp.unread_count ?? 0, icon: MessageCircle },
            { label: "Agents working", value: activeAgents, icon: Activity },
          ].map(({ label, value, icon: Icon }) => <div key={label} className="rounded-xl border border-hairline/40 bg-card p-3 sm:p-4"><Icon size={16} className="text-accent" /><div className="mt-3 text-[24px] font-semibold leading-none text-ink">{value}</div><div className="mt-1.5 text-[11.5px] text-ink-secondary">{label}</div></div>)}
        </section>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,.75fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <section className={panel}>
              <div className="flex items-center justify-between gap-3"><div><h2 className="text-[16px] font-semibold text-ink">Priorities</h2><p className="mt-0.5 text-[12px] text-ink-secondary">Actionable work for this account.</p></div><span className="text-[11px] text-ink-secondary">{donePriorities.length} done</span></div>
              <div className="mt-4 flex flex-col gap-2">
                {openPriorities.length === 0 && <div className="rounded-xl bg-inset px-4 py-5 text-center text-[13px] text-ink-secondary">Nothing is competing for attention. Add the next important outcome below.</div>}
                {openPriorities.map((priority) => <div key={priority.id} className="group flex min-w-0 items-start gap-3 rounded-xl bg-inset px-3 py-3">
                  <button aria-label={`Complete ${priority.title}`} disabled={workingId === priority.id} onClick={() => void mutate(priority.id, () => api(`/api/today/priorities/${priority.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) }))} className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-success/10 hover:text-success"><Circle size={18} /></button>
                  <div className="min-w-0 flex-1"><div className="break-words text-[13.5px] font-medium text-ink">{priority.title}</div>{priority.dueAt && <div className="mt-1 text-[11px] text-ink-secondary">Due {new Date(priority.dueAt).toLocaleDateString([], { month: "short", day: "numeric" })}</div>}</div>
                  <button aria-label={`Delete ${priority.title}`} disabled={workingId === priority.id} onClick={() => void mutate(priority.id, () => api(`/api/today/priorities/${priority.id}`, { method: "DELETE" }))} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary opacity-60 hover:bg-danger/10 hover:text-danger sm:opacity-0 sm:group-hover:opacity-100"><Trash2 size={14} /></button>
                </div>)}
              </div>
              <form className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]" onSubmit={(event) => { event.preventDefault(); void addPriority(); }}>
                <input value={newPriority} onChange={(event) => setNewPriority(event.target.value)} maxLength={240} placeholder="Add a priority…" aria-label="New priority" className="min-h-11 min-w-0 rounded-xl border border-hairline/40 bg-inset px-3 text-[13px] text-ink placeholder:text-ink-secondary focus:border-accent focus:outline-none" />
                <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="Priority due date" className="min-h-11 min-w-0 rounded-xl border border-hairline/40 bg-inset px-3 text-[12px] text-ink focus:border-accent focus:outline-none" />
                <button disabled={!newPriority.trim() || workingId === "new"} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[13px] font-medium text-white disabled:opacity-40">{workingId === "new" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} />}Add</button>
              </form>
              {donePriorities.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-[12px] text-ink-secondary">Completed priorities</summary><div className="mt-2 space-y-1">{donePriorities.slice(0, 10).map((priority) => <button key={priority.id} onClick={() => void mutate(priority.id, () => api(`/api/today/priorities/${priority.id}`, { method: "PATCH", body: JSON.stringify({ status: "open" }) }))} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[12.5px] text-ink-secondary hover:bg-inset"><CheckCircle2 size={15} className="text-success" /><span className="line-through">{priority.title}</span></button>)}</div></details>}
            </section>

            <section className={panel} aria-labelledby="context-review-title">
              <div className="flex items-center justify-between gap-3"><div><h2 id="context-review-title" className="text-[16px] font-semibold text-ink">Review learned context</h2><p className="mt-0.5 text-[12px] text-ink-secondary">Suggestions stay out of trusted memory until you confirm them.</p></div><Brain size={18} className="shrink-0 text-accent" /></div>
              <div className="mt-4 space-y-2">
                {observations.length === 0 && <div className="rounded-xl bg-inset px-4 py-5 text-center text-[13px] text-ink-secondary">No context waiting for review.</div>}
                {observations.map((observation) => {
                  const working = workingId === `observation:${observation.id}`;
                  const editing = editingObservation === observation.id;
                  return <article key={observation.id} className="rounded-xl border border-hairline/30 bg-inset p-3.5">
                    <div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-accent/10 px-2 py-1 text-[10.5px] font-medium capitalize text-accent">{observation.kind}</span><span className="text-[10.5px] text-ink-secondary">{observation.sourceBotName ? `${observation.sourceBotName} · ` : ""}{relativeTime(observation.createdAt)}</span></div>
                    {editing ? <textarea autoFocus value={correction} onChange={(event) => setCorrection(event.target.value)} aria-label={`Correct ${observation.suggestedText}`} maxLength={500} className="mt-3 min-h-24 w-full resize-y rounded-xl border border-accent/50 bg-card px-3 py-2.5 text-[13px] leading-relaxed text-ink focus:outline-none" /> : <p className="mt-2 break-words text-[13.5px] leading-relaxed text-ink">{observation.suggestedText}</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {editing ? <>
                        <button disabled={working || !correction.trim()} onClick={() => void reviewObservation(observation, "correct")} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12px] font-medium text-white disabled:opacity-40">{working ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}Save correction</button>
                        <button disabled={working} onClick={() => { setEditingObservation(null); setCorrection(""); }} className="min-h-10 rounded-lg px-3 text-[12px] text-ink-secondary hover:bg-raised">Cancel</button>
                      </> : <>
                        <button disabled={working} onClick={() => void reviewObservation(observation, "accept")} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-success/15 px-3 text-[12px] font-medium text-success hover:bg-success/20 disabled:opacity-50"><Check size={14} />Accept</button>
                        <button disabled={working} onClick={() => { setEditingObservation(observation.id); setCorrection(observation.suggestedText); }} className="flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-[12px] text-ink hover:bg-raised disabled:opacity-50"><Pencil size={13} />Correct</button>
                        <button disabled={working} onClick={() => void reviewObservation(observation, "dismiss")} className="flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-[12px] text-ink-secondary hover:bg-raised disabled:opacity-50"><X size={14} />Dismiss</button>
                      </>}
                    </div>
                  </article>;
                })}
              </div>
            </section>

            <section className={panel} aria-labelledby="commitment-title">
              <div className="flex items-center justify-between gap-3"><div><h2 id="commitment-title" className="text-[16px] font-semibold text-ink">Commitments &amp; follow-ups</h2><p className="mt-0.5 text-[12px] text-ink-secondary">Promises and requests detected in WhatsApp. Suggestions remain inactive until you confirm them.</p></div><Handshake size={18} className="shrink-0 text-accent" /></div>
              <div className="mt-4 space-y-2">
                {commitments.length === 0 && <div className="rounded-xl bg-inset px-4 py-5 text-center text-[13px] text-ink-secondary">No commitments or follow-ups waiting.</div>}
                {commitments.map((commitment) => {
                  const working = workingId === `commitment:${commitment.id}`;
                  const editing = editingCommitment === commitment.id;
                  return <article key={commitment.id} className="rounded-xl border border-hairline/30 bg-inset p-3.5">
                    <div className="flex flex-wrap items-center gap-2"><span className={cn("rounded-md px-2 py-1 text-[10.5px] font-medium", commitment.status === "suggested" ? "bg-warning/15 text-warning" : "bg-success/15 text-success")}>{commitment.status === "suggested" ? "Needs review" : "Tracked"}</span><span className="rounded-md bg-card px-2 py-1 text-[10.5px] capitalize text-ink-secondary">{commitment.direction === "mine" ? "You owe" : "They owe"}</span><span className="text-[10.5px] text-ink-secondary">{commitment.personName} · {relativeTime(commitment.createdAt)}</span></div>
                    {editing ? <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_160px]"><textarea autoFocus value={commitmentText} onChange={(event) => setCommitmentText(event.target.value)} aria-label={`Edit commitment for ${commitment.personName}`} maxLength={1000} className="min-h-24 resize-y rounded-xl border border-accent/50 bg-card px-3 py-2.5 text-[13px] leading-relaxed text-ink focus:outline-none" /><input type="date" value={commitmentDue} onChange={(event) => setCommitmentDue(event.target.value)} aria-label={`Due date for ${commitment.personName}`} className="min-h-11 rounded-xl border border-hairline/40 bg-card px-3 text-[12px] text-ink focus:border-accent focus:outline-none" /></div> : <><p className="mt-2 break-words text-[13.5px] leading-relaxed text-ink">{commitment.text}</p><div className="mt-1.5 text-[10.5px] text-ink-secondary">{commitment.dueAt ? `Suggested for ${new Date(commitment.dueAt).toLocaleDateString([], { month: "short", day: "numeric" })}` : "No due date"} · {commitment.kind.replaceAll("-", " ")}</div></>}
                    <div className="mt-3 flex flex-wrap gap-2">{editing ? <>
                      <button disabled={working || !commitmentText.trim()} onClick={() => void commitmentAction(commitment, commitment.status === "suggested" ? "accept" : "update")} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12px] font-medium text-white disabled:opacity-40">{working ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{commitment.status === "suggested" ? "Confirm & track" : "Save changes"}</button>
                      <button disabled={working} onClick={() => { setEditingCommitment(null); setCommitmentText(""); setCommitmentDue(""); }} className="min-h-10 rounded-lg px-3 text-[12px] text-ink-secondary hover:bg-raised">Cancel</button>
                    </> : commitment.status === "suggested" ? <>
                      <button disabled={working} onClick={() => void commitmentAction(commitment, "accept")} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-success/15 px-3 text-[12px] font-medium text-success hover:bg-success/20 disabled:opacity-50"><Check size={14} />Confirm &amp; track</button>
                      <button disabled={working} onClick={() => beginCommitmentEdit(commitment)} className="flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-[12px] text-ink hover:bg-raised"><Pencil size={13} />Edit first</button>
                      <button disabled={working} onClick={() => void commitmentAction(commitment, "dismiss")} className="flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-[12px] text-ink-secondary hover:bg-raised"><X size={14} />Dismiss</button>
                    </> : <>
                      <button disabled={working} onClick={() => void commitmentAction(commitment, "complete")} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-success/15 px-3 text-[12px] font-medium text-success hover:bg-success/20 disabled:opacity-50"><CheckCircle2 size={14} />Complete</button>
                      {commitment.whatsappJid && commitment.draftStatus === "pending" && <span className="flex min-h-10 items-center gap-1.5 rounded-lg bg-accent/10 px-3 text-[12px] font-medium text-accent"><ShieldCheck size={14} />Draft ready for approval</span>}
                      {commitment.whatsappJid && (!commitment.draftStatus || commitment.draftStatus === "dismissed" || commitment.draftStatus === "failed") && <button disabled={working} onClick={() => void draftCommitment(commitment)} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-accent/10 px-3 text-[12px] font-medium text-accent hover:bg-accent/15 disabled:opacity-50">{working ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}Draft WhatsApp</button>}
                      {commitment.whatsappJid && (commitment.draftStatus === "approved" || commitment.draftStatus === "sent") && <span className="flex min-h-10 items-center gap-1.5 rounded-lg bg-success/10 px-3 text-[12px] font-medium text-success"><CheckCircle2 size={14} />Follow-up approved</span>}
                      <button disabled={working} onClick={() => beginCommitmentEdit(commitment)} className="flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-[12px] text-ink hover:bg-raised"><Pencil size={13} />Edit</button>
                      <button disabled={working} onClick={() => void commitmentAction(commitment, "dismiss")} className="flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-[12px] text-ink-secondary hover:bg-raised"><X size={14} />Dismiss</button>
                    </>}</div>
                  </article>;
                })}
              </div>
            </section>

            <section className={panel}>
              <div className="flex items-center justify-between"><div><h2 className="text-[16px] font-semibold text-ink">Needs your approval</h2><p className="mt-0.5 text-[12px] text-ink-secondary">Sensitive actions and approval-gated agent handoffs remain held until you decide.</p></div><ShieldCheck size={18} className="text-accent" /></div>
              <div className="mt-4 space-y-2">
                {data?.approvals.length === 0 && <div className="rounded-xl bg-inset px-4 py-5 text-center text-[13px] text-ink-secondary">No pending approvals.</div>}
                {data?.approvals.map((approval) => {
                  const base = approval.kind === "whatsapp-draft" ? `/api/whatsapp/drafts/${approval.id}` : approval.kind === "agent-delegation" ? `/api/delegations/${approval.id}` : `/api/tool-approvals/${approval.id}`;
                  const dismissAction = approval.kind === "agent-delegation" ? "cancel" : "dismiss";
                  return <article key={approval.id} className="rounded-xl border border-hairline/30 bg-inset p-3.5"><div className="flex items-center justify-between gap-3"><h3 className="truncate text-[13.5px] font-medium text-ink">{approval.title}</h3><span className="shrink-0 text-[10.5px] text-ink-secondary">{relativeTime(approval.createdAt)}</span></div>{approval.kind !== "whatsapp-draft" && <span className={cn("mt-2 inline-flex rounded-md px-2 py-1 text-[10px] font-medium capitalize", approval.risk === "destructive" || approval.risk === "sensitive" ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning")}>{approval.risk}</span>}<p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink-secondary">{approval.preview}</p><div className="mt-3 flex flex-wrap gap-2"><button disabled={workingId === approval.id} onClick={() => void mutate(approval.id, () => api(`${base}/approve`, { method: "POST" }))} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-success/15 px-3 text-[12px] font-medium text-success hover:bg-success/20 disabled:opacity-50">{workingId === approval.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{approval.kind === "whatsapp-draft" ? "Approve & send" : "Approve & run"}</button><button disabled={workingId === approval.id} onClick={() => void mutate(approval.id, () => api(`${base}/${dismissAction}`, { method: "POST" }))} className="flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-[12px] text-ink-secondary hover:bg-raised disabled:opacity-50"><X size={14} />Dismiss</button></div></article>;
                })}
              </div>
            </section>

            <section className={panel}>
              <div className="flex items-center justify-between gap-3"><div><h2 className="text-[16px] font-semibold text-ink">Recent agent activity</h2><p className="mt-0.5 text-[12px] text-ink-secondary">Receipts from routines, autonomy decisions, and WhatsApp.</p></div><Activity size={18} className="text-accent" /></div>
              <div className="mt-3 divide-y divide-hairline/30">
                {data?.activity.length === 0 && <div className="py-5 text-center text-[13px] text-ink-secondary">No agent activity yet.</div>}
                {data?.activity.slice(0, 12).map((item) => <button key={item.id} disabled={!item.botId} onClick={() => item.botId && dispatch({ type: "select", id: item.botId })} className="flex w-full min-w-0 items-center gap-3 py-3 text-left disabled:cursor-default"><span className={cn("size-2 shrink-0 rounded-full", item.status === "failed" || item.status === "deny" ? "bg-danger" : item.status === "ask" ? "bg-warning" : "bg-success")} /><div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium capitalize text-ink">{item.title}</div><div className="mt-0.5 truncate text-[11.5px] text-ink-secondary">{item.botName ? `${item.botName} · ` : ""}{item.detail}</div></div><span className="shrink-0 text-[10.5px] text-ink-secondary">{relativeTime(item.at)}</span>{item.botId && <ChevronRight size={14} className="shrink-0 text-ink-secondary" />}</button>)}
              </div>
            </section>
          </div>

          <aside className="flex min-w-0 flex-col gap-4">
            <section className={panel}>
              <div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold text-ink">WhatsApp attention</h2><MessageCircle size={17} className="text-accent" /></div>
              <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-inset p-3"><div className="text-[22px] font-semibold text-ink">{data?.whatsapp.unread_count ?? 0}</div><div className="mt-1 text-[11px] text-ink-secondary">Unread messages</div></div><div className="rounded-xl bg-inset p-3"><div className="text-[22px] font-semibold text-ink">{data?.whatsapp.unread_chats ?? 0}</div><div className="mt-1 text-[11px] text-ink-secondary">Chats waiting</div></div></div>
              <div className="mt-3 flex items-center justify-between text-[11.5px] text-ink-secondary"><span>{data?.whatsapp.connected ? "Connected" : "Not connected"}</span><span>{relativeTime(data?.whatsapp.latest_message_at ?? null)}</span></div>
              <button onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "connections" })} className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-hairline/40 text-[12.5px] text-ink hover:bg-inset">Manage WhatsApp <ChevronRight size={14} /></button>
            </section>

            <section className={panel}>
              <div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold text-ink">Coming up</h2><CalendarClock size={17} className="text-accent" /></div>
              <div className="mt-3 space-y-2">{data?.upcoming.length === 0 ? <div className="rounded-xl bg-inset px-3 py-4 text-center text-[12.5px] text-ink-secondary">No enabled routines scheduled.</div> : data?.upcoming.slice(0, 6).map((routine) => <button key={routine.id} onClick={() => dispatch({ type: "showRoutines" })} className="flex w-full items-center gap-3 rounded-xl bg-inset p-3 text-left"><Clock3 size={15} className="shrink-0 text-accent" /><div className="min-w-0 flex-1"><div className="truncate text-[12.5px] font-medium text-ink">{routine.name}</div><div className="mt-0.5 truncate text-[10.5px] text-ink-secondary">{routine.botName} · {nextTime(routine.nextRunAt)}</div></div><ChevronRight size={14} className="text-ink-secondary" /></button>)}</div>
              <button onClick={() => dispatch({ type: "showRoutines" })} className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-hairline/40 text-[12.5px] text-ink hover:bg-inset">Open tasks &amp; routines <ChevronRight size={14} /></button>
            </section>

            <section className={panel}>
              <div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold text-ink">Your agents</h2><Bot size={17} className="text-accent" /></div>
              <div className="mt-3 space-y-1">{data?.agents.map((agent) => <button key={agent.id} onClick={() => dispatch({ type: "select", id: agent.id })} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 text-left hover:bg-inset"><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: agent.color }} /><div className="min-w-0 flex-1"><div className="truncate text-[12.5px] font-medium text-ink">{agent.name}</div><div className="truncate text-[10.5px] text-ink-secondary">{agent.busy ? "Working now" : agent.title || "Ready"}</div></div>{agent.unread && <span className="size-2 rounded-full bg-accent" />}<ChevronRight size={14} className="text-ink-secondary" /></button>)}</div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
