import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Calendar, Check, ChevronDown, ChevronRight, ChevronUp, Flag, LayoutList, Loader2, MessageSquare, PanelLeftClose, Plus, RefreshCw, Send, SlidersHorizontal, Trash2, UserPlus, Users, X } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";

type Member = { id: string; name: string; email: string; role: string };
type Project = { id: string; name: string; description: string; color: string; created_at: number; updated_at: number };
type TaskStatus = "backlog" | "in_progress" | "review" | "done";
type Task = { id: string; project_id: string; title: string; description: string; status: TaskStatus; priority: "low" | "normal" | "high" | "urgent"; assignee_user_id: string | null; due_at: number | null; created_at: number; updated_at: number };
type Message = { id: string; project_id: string; task_id: string | null; user_id: string; user_name: string; body: string; created_at: number };
type Invitation = { id: string; email: string; role: string; created_at: number; expires_at: number; accepted_at: number | null };
type WorkData = { workspace: { id: string; name: string; role: string }; members: Member[]; projects: Project[]; tasks: Task[]; messages: Message[]; invites: Invitation[] };
type WorkTab = "chat" | "board" | "list";

const tabLabels: Record<WorkTab, string> = { chat: "Chat", board: "Board", list: "List" };
function loadTabOrder(): WorkTab[] {
  switch (localStorage.getItem("magicteams-work-tab-order")) {
    case "chat,list,board": return ["chat", "list", "board"];
    case "board,chat,list": return ["board", "chat", "list"];
    case "board,list,chat": return ["board", "list", "chat"];
    case "list,chat,board": return ["list", "chat", "board"];
    case "list,board,chat": return ["list", "board", "chat"];
    default: return ["chat", "board", "list"];
  }
}

const statuses: Array<{ id: TaskStatus; label: string }> = [
  { id: "backlog", label: "To do" }, { id: "in_progress", label: "In progress" }, { id: "review", label: "Review" }, { id: "done", label: "Done" },
];
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

function Avatar({ member, size = "size-7" }: { member?: Member; size?: string }) {
  return <span title={member?.name} className={cn("grid shrink-0 place-items-center rounded-lg bg-accent/12 text-[10px] font-semibold text-accent", size)}>{member ? initials(member.name) : "?"}</span>;
}

export function WorkPage() {
  const [data, setData] = useState<WorkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkTab>("chat");
  const [tabOrder, setTabOrder] = useState<WorkTab[]>(loadTabOrder);
  const [arrangingTabs, setArrangingTabs] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState("");
  const [message, setMessage] = useState("");
  const [dialog, setDialog] = useState<"project" | "invite" | null>(null);
  const [dialogValue, setDialogValue] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [saving, setSaving] = useState(false);

  const openDialog = (next: "project" | "invite") => {
    setDialog(next); setDialogValue(""); setInviteUrl(""); setDialogError("");
  };

  const manageInvite = async (invite: Invitation, action: "resend" | "cancel") => {
    if (!data || saving) return;
    if (action === "cancel" && !window.confirm(`Cancel the invitation for ${invite.email}? Its current link will stop working.`)) return;
    setSaving(true); setError("");
    try {
      if (action === "cancel") await api(`/api/work/invites/${encodeURIComponent(invite.id)}`, { method: "DELETE" });
      else { await api("/api/work/invites", { method: "POST", body: JSON.stringify({ workspaceId: data.workspace.id, email: invite.email }) }); setInviteUrl(invite.email); }
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : `Could not ${action} invitation`); }
    finally { setSaving(false); }
  };

  const load = useCallback(async () => {
    setError("");
    try {
      const preferred = new URLSearchParams(window.location.search).get("workspaceId") || localStorage.getItem("magicteams-workspace");
      const next = await api(`/api/work${preferred ? `?workspaceId=${encodeURIComponent(preferred)}` : ""}`) as WorkData;
      localStorage.setItem("magicteams-workspace", next.workspace.id);
      setData(next); setProjectId((current) => current && next.projects.some((p) => p.id === current) ? current : next.projects[0]?.id ?? null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load your workspace"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("invite");
    if (!token) return;
    api("/api/work/invites/accept", { method: "POST", body: JSON.stringify({ token }) })
      .then((result) => { localStorage.setItem("magicteams-workspace", result.workspaceId); history.replaceState({}, "", location.pathname); void load(); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not accept invitation"));
  }, [load]);

  const project = data?.projects.find((item) => item.id === projectId) ?? null;
  const tasks = useMemo(() => data?.tasks.filter((task) => task.project_id === projectId) ?? [], [data?.tasks, projectId]);
  const messages = useMemo(() => data?.messages.filter((item) => item.project_id === projectId) ?? [], [data?.messages, projectId]);
  const selectedTask = tasks.find((task) => task.id === taskId) ?? null;
  const member = (id: string | null) => data?.members.find((item) => item.id === id);
  const moveTab = (id: WorkTab, direction: -1 | 1) => {
    setTabOrder((current) => {
      const from = current.indexOf(id); const to = from + direction;
      if (to < 0 || to >= current.length) return current;
      const next = [...current]; [next[from], next[to]] = [next[to], next[from]];
      localStorage.setItem("magicteams-work-tab-order", next.join(","));
      return next;
    });
  };

  const createTask = async () => {
    if (!projectId || !newTask.trim()) return; setSaving(true);
    try { const result = await api("/api/work/tasks", { method: "POST", body: JSON.stringify({ projectId, title: newTask }) }); setData((current) => current ? { ...current, tasks: [result.task, ...current.tasks] } : current); setNewTask(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create task"); } finally { setSaving(false); }
  };
  const patchTask = async (id: string, patch: Record<string, unknown>) => {
    setData((current) => current ? { ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, ...patch, assignee_user_id: patch.assigneeUserId === undefined ? task.assignee_user_id : patch.assigneeUserId as string | null, due_at: patch.dueAt === undefined ? task.due_at : patch.dueAt as number | null } : task) } : current);
    try { await api(`/api/work/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update task"); void load(); }
  };
  const sendMessage = async (task: Task | null = null) => {
    if (!projectId || !message.trim()) return; setSaving(true);
    try { const result = await api("/api/work/messages", { method: "POST", body: JSON.stringify({ projectId, taskId: task?.id ?? null, body: message }) }); setData((current) => current ? { ...current, messages: [...current.messages, result.message] } : current); setMessage(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send message"); } finally { setSaving(false); }
  };
  const submitDialog = async () => {
    if (!data || !dialogValue.trim()) return; setSaving(true); setInviteUrl(""); setDialogError("");
    try {
      if (dialog === "project") { const result = await api("/api/work/projects", { method: "POST", body: JSON.stringify({ workspaceId: data.workspace.id, name: dialogValue }) }); setData({ ...data, projects: [result.project, ...data.projects] }); setProjectId(result.project.id); setDialog(null); setDialogValue(""); }
      else {
        const emails = [...new Set(dialogValue.split(/[\s,;]+/).map((value) => value.trim().toLowerCase()).filter(Boolean))];
        const invalid = emails.filter((email) => !/^\S+@\S+\.\S+$/.test(email));
        if (invalid.length) throw new Error(`Check ${invalid.slice(0, 2).join(", ")}${invalid.length > 2 ? " and other addresses" : ""}`);
        if (emails.length > 25) throw new Error("Send up to 25 invitations at a time");
        const results = await Promise.allSettled(emails.map((email) => api("/api/work/invites", { method: "POST", body: JSON.stringify({ workspaceId: data.workspace.id, email }) })));
        const sent = results.flatMap((result, index) => result.status === "fulfilled" ? [emails[index]] : []);
        const failed = results.flatMap((result, index) => result.status === "rejected" ? [emails[index]] : []);
        if (sent.length) setInviteUrl(sent.join(", "));
        if (failed.length) setDialogError(`${failed.length} invitation${failed.length === 1 ? "" : "s"} could not be sent: ${failed.join(", ")}`);
        if (!sent.length) throw results.find((result) => result.status === "rejected")?.reason ?? new Error("Invitations could not be sent");
        void load();
      }
    } catch (reason) { setDialogError(reason instanceof Error ? reason.message : "Could not save"); } finally { setSaving(false); }
  };

  if (loading) return <main className="flex min-w-0 flex-1 items-center justify-center bg-app text-ink-secondary"><Loader2 className="animate-spin" size={20} /></main>;
  if (!data) return <main className="flex min-w-0 flex-1 items-center justify-center bg-app p-6 text-center text-danger">{error}</main>;

  return <main className="flex min-w-0 flex-1 bg-app text-ink">
    <aside className={cn("w-60 shrink-0 border-r border-hairline/40 bg-sidebar p-3", selectedTask ? "hidden" : "hidden lg:block")}>
      <div className="flex items-center justify-between px-2 py-2"><div className="min-w-0"><div className="truncate text-[13px] font-semibold">{data.workspace.name}</div><div className="text-[10px] capitalize text-ink-secondary">{data.workspace.role} workspace</div></div><button onClick={() => openDialog("invite")} aria-label="Invite teammate" className="grid size-9 place-items-center rounded-lg hover:bg-raised"><UserPlus size={16} /></button></div>
      <div className="mt-4 flex items-center justify-between px-2 text-[10px] font-semibold uppercase tracking-[.1em] text-ink-secondary"><span>Projects</span><button onClick={() => openDialog("project")} className="grid size-7 place-items-center rounded-md hover:bg-raised" aria-label="New project"><Plus size={14} /></button></div>
      <div className="mt-1 space-y-0.5">{data.projects.map((item) => <button key={item.id} onClick={() => { setProjectId(item.id); setTaskId(null); }} className={cn("flex min-h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px]", item.id === projectId ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/60 hover:text-ink")}><span className="size-2.5 rounded-[3px]" style={{ background: item.color }} /><span className="truncate">{item.name}</span></button>)}</div>
      <button onClick={() => openDialog("invite")} className="mt-5 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink"><Users size={15} />{data.members.length} teammate{data.members.length === 1 ? "" : "s"}</button>
      {data.invites.length > 0 && <section className="mt-5 border-t border-hairline/35 px-2 pt-4"><div className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink-secondary">Recent invitations</div><div className="mt-2 space-y-3">{data.invites.slice(0, 5).map((invite) => { const status = invite.accepted_at ? "Accepted" : invite.expires_at <= Date.now() ? "Expired" : "Pending"; return <div key={invite.id} className="min-w-0"><div className="truncate text-[11px] text-ink" title={invite.email}>{invite.email}</div><div className={cn("mt-0.5 text-[10px]", status === "Accepted" ? "text-success" : status === "Expired" ? "text-danger" : "text-ink-secondary")}>{status} · {new Date(invite.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}</div>{!invite.accepted_at && <div className="mt-1 flex gap-1"><button disabled={saving} onClick={() => void manageInvite(invite, "resend")} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40"><RefreshCw size={10} />Resend</button><button disabled={saving} onClick={() => void manageInvite(invite, "cancel")} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-danger/80 hover:bg-danger/10 disabled:opacity-40"><Trash2 size={10} />Cancel</button></div>}</div>; })}</div></section>}
    </aside>

    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex min-h-16 items-center gap-3 border-b border-hairline/40 px-4 sm:px-6"><button onClick={() => setProjectId(null)} className="grid size-9 place-items-center rounded-lg hover:bg-raised lg:hidden"><ArrowLeft size={17} /></button><button onClick={() => window.dispatchEvent(new Event("magicteams-sidebar-toggle"))} className="hidden size-9 place-items-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink md:grid" aria-label="Minimize or expand bots sidebar" title="Minimize or expand bots"><PanelLeftClose size={16} /></button><div className="min-w-0 flex-1"><h1 className="truncate text-[17px] font-semibold tracking-[-.02em]">{project?.name ?? "Work"}</h1><p className="truncate text-[11px] text-ink-secondary">{project?.description || `${tasks.length} tasks · ${data.members.length} teammates`}</p></div><div className="flex -space-x-1.5">{data.members.slice(0, 4).map((item) => <Avatar key={item.id} member={item} />)}</div><button onClick={() => openDialog("invite")} className="hidden min-h-9 items-center gap-2 rounded-lg border border-hairline/50 px-3 text-[12px] hover:bg-raised sm:flex"><UserPlus size={14} />Invite</button></header>
      {!project ? <div className="grid flex-1 place-items-center p-6"><div className="max-w-sm text-center"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-raised text-accent"><LayoutList size={23} /></div><h2 className="mt-4 text-xl font-semibold">Create your first project</h2><p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">Keep ownership, deadlines, task conversations, and team decisions together.</p><button onClick={() => setDialog("project")} className="mt-5 rounded-xl bg-accent px-4 py-2.5 text-[13px] font-medium text-white">New project</button></div></div> : <>
        <nav className="relative flex items-center gap-1 border-b border-hairline/40 px-4 sm:px-6">{tabOrder.map((id) => <button key={id} onClick={() => setTab(id)} className={cn("relative min-h-11 px-3 text-[12px] font-medium text-ink-secondary", tab === id && "text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent")}>{tabLabels[id]}</button>)}<button onClick={() => setArrangingTabs((open) => !open)} aria-label="Arrange tabs" title="Arrange tabs" className={cn("ml-auto grid size-8 place-items-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink", arrangingTabs && "bg-raised text-ink")}><SlidersHorizontal size={14} /></button>{arrangingTabs && <div className="absolute right-4 top-10 z-40 w-56 rounded-xl border border-hairline/50 bg-card p-2 shadow-xl shadow-black/25"><div className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[.09em] text-ink-secondary">Arrange tabs</div>{tabOrder.map((id, index) => <div key={id} className="flex min-h-9 items-center gap-2 rounded-lg px-2 hover:bg-raised/50"><span className="flex-1 text-[12px]">{tabLabels[id]}</span><button disabled={index === 0} onClick={() => moveTab(id, -1)} aria-label={`Move ${tabLabels[id]} left`} className="grid size-7 place-items-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-25"><ChevronUp size={13} /></button><button disabled={index === tabOrder.length - 1} onClick={() => moveTab(id, 1)} aria-label={`Move ${tabLabels[id]} right`} className="grid size-7 place-items-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-25"><ChevronDown size={13} /></button></div>)}<button onClick={() => { const next: WorkTab[] = ["chat", "board", "list"]; setTabOrder(next); localStorage.removeItem("magicteams-work-tab-order"); }} className="mt-1 w-full rounded-lg px-2 py-2 text-left text-[11px] text-ink-secondary hover:bg-raised hover:text-ink">Reset to Chat first</button></div>}</nav>
        {error && <div className="mx-4 mt-3 flex items-center justify-between rounded-xl border border-danger/25 bg-danger/8 px-3 py-2 text-[12px] text-danger"><span>{error}</span><button onClick={() => setError("")}><X size={14} /></button></div>}
        {tab !== "chat" && <div className="flex gap-2 px-4 py-3 sm:px-6"><input value={newTask} onChange={(event) => setNewTask(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void createTask()} placeholder="Add a task and press Enter" className="min-h-10 min-w-0 flex-1 rounded-xl border border-hairline/50 bg-inset px-3 text-[13px] outline-none focus:border-accent" /><button disabled={!newTask.trim() || saving} onClick={() => void createTask()} className="grid size-10 place-items-center rounded-xl bg-accent text-white disabled:opacity-40"><Plus size={17} /></button></div>}
        {tab === "board" ? <div className="grid min-h-0 flex-1 auto-cols-[minmax(250px,1fr)] grid-flow-col gap-3 overflow-x-auto px-4 pb-5 sm:px-6">{statuses.map((status) => { const column = tasks.filter((task) => task.status === status.id); return <section key={status.id} className="min-w-[250px] rounded-2xl bg-inset/70 p-2"><div className="flex items-center justify-between px-2 py-1.5"><h2 className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-secondary">{status.label}</h2><span className="text-[11px] tabular-nums text-ink-secondary">{column.length}</span></div><div className="space-y-2">{column.map((task) => <button key={task.id} onClick={() => setTaskId(task.id)} className="group w-full rounded-xl bg-card p-3 text-left shadow-sm shadow-black/10 ring-1 ring-hairline/30 transition hover:-translate-y-0.5 hover:ring-accent/30"><div className="text-[13px] font-medium leading-snug">{task.title}</div><div className="mt-4 flex items-center gap-2"><span className={cn("text-[10px] capitalize", task.priority === "urgent" ? "text-danger" : task.priority === "high" ? "text-warning" : "text-ink-secondary")}><Flag size={11} className="mr-1 inline" />{task.priority}</span><span className="flex-1" />{task.due_at && <Calendar size={12} className="text-ink-secondary" />}<Avatar member={member(task.assignee_user_id)} size="size-6" /></div></button>)}</div></section>; })}</div>
        : tab === "list" ? <div className="min-h-0 flex-1 overflow-auto px-4 pb-6 sm:px-6"><div className="overflow-hidden rounded-2xl border border-hairline/40">{tasks.map((task) => <button key={task.id} onClick={() => setTaskId(task.id)} className="grid min-h-12 w-full grid-cols-[1fr_110px_36px_20px] items-center gap-3 border-b border-hairline/30 px-3 text-left last:border-0 hover:bg-raised/40"><span className="truncate text-[13px]">{task.title}</span><span className="text-[11px] text-ink-secondary">{statuses.find((s) => s.id === task.status)?.label}</span><Avatar member={member(task.assignee_user_id)} size="size-7" /><ChevronRight size={14} className="text-ink-secondary" /></button>)}</div></div>
        : <div className="flex min-h-0 flex-1 flex-col"><div className="border-b border-hairline/30 px-5 py-3"><div className="mx-auto flex max-w-3xl items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-accent/12 text-accent"><MessageSquare size={16} /></div><div><div className="text-[13px] font-semibold"># {project.name}</div><div className="text-[10.5px] text-ink-secondary">Project channel · {data.members.length} members</div></div><div className="ml-auto flex -space-x-1.5">{data.members.slice(0, 3).map((item) => <Avatar key={item.id} member={item} size="size-6" />)}</div></div></div><div className="min-h-0 flex-1 overflow-auto px-4 py-5 sm:px-6"><div className="mx-auto space-y-5 max-w-3xl">{messages.length === 0 && <div className="grid min-h-48 place-items-center text-center"><div><MessageSquare className="mx-auto text-ink-secondary" size={24} /><h3 className="mt-3 text-[14px] font-semibold">Start #{project.name}</h3><p className="mt-1 text-[12px] text-ink-secondary">Share updates, decisions, and questions with the project team.</p></div></div>}{messages.filter((item) => !item.task_id).map((item) => <div key={item.id} className="group flex gap-3 rounded-xl px-2 py-1.5 hover:bg-raised/35"><Avatar member={member(item.user_id)} size="size-8" /><div className="min-w-0"><div className="flex items-baseline gap-2"><span className="text-[12px] font-semibold">{item.user_name}</span><time className="text-[10px] text-ink-secondary">{new Date(item.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></div><p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-secondary">{item.body}</p></div></div>)}</div></div><div className="px-4 pb-4 sm:px-6"><div className="mx-auto max-w-3xl rounded-2xl border border-hairline/50 bg-card shadow-lg shadow-black/10 focus-within:border-accent/60"><textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={`Message #${project.name.toLowerCase().replaceAll(" ", "-")}`} className="max-h-36 min-h-14 w-full resize-none bg-transparent px-4 py-3 text-[13px] outline-none" /><div className="flex items-center border-t border-hairline/30 px-2 py-1.5"><span className="px-2 text-[10px] text-ink-secondary">Enter to send · Shift + Enter for a new line</span><button disabled={!message.trim() || saving} onClick={() => void sendMessage()} className="ml-auto grid size-8 place-items-center rounded-lg bg-accent text-white disabled:opacity-40"><Send size={13} /></button></div></div></div></div>}
      </>}
    </section>

    {selectedTask && <aside className="absolute inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l border-hairline/50 bg-card shadow-2xl shadow-black/30 sm:relative sm:z-auto"><header className="flex min-h-16 items-center justify-between border-b border-hairline/40 px-4"><span className="text-[11px] text-ink-secondary">Task details</span><button onClick={() => setTaskId(null)} className="grid size-9 place-items-center rounded-lg hover:bg-raised"><X size={16} /></button></header><div className="min-h-0 flex-1 overflow-auto p-5"><input value={selectedTask.title} onChange={(event) => setData((current) => current ? { ...current, tasks: current.tasks.map((task) => task.id === selectedTask.id ? { ...task, title: event.target.value } : task) } : current)} onBlur={() => void patchTask(selectedTask.id, { title: selectedTask.title })} className="w-full bg-transparent text-[20px] font-semibold tracking-[-.025em] outline-none" /><div className="mt-6 grid grid-cols-[92px_1fr] items-center gap-y-4 text-[12px]"><span className="text-ink-secondary">Status</span><select value={selectedTask.status} onChange={(event) => void patchTask(selectedTask.id, { status: event.target.value })} className="rounded-lg border border-hairline/40 bg-inset px-2.5 py-2 outline-none">{statuses.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select><span className="text-ink-secondary">Assignee</span><select value={selectedTask.assignee_user_id ?? ""} onChange={(event) => void patchTask(selectedTask.id, { assigneeUserId: event.target.value || null })} className="rounded-lg border border-hairline/40 bg-inset px-2.5 py-2 outline-none"><option value="">Unassigned</option>{data.members.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className="text-ink-secondary">Priority</span><select value={selectedTask.priority} onChange={(event) => void patchTask(selectedTask.id, { priority: event.target.value })} className="rounded-lg border border-hairline/40 bg-inset px-2.5 py-2 outline-none">{["low","normal","high","urgent"].map((item) => <option key={item}>{item}</option>)}</select></div><label className="mt-7 block text-[11px] font-medium text-ink-secondary">Description</label><textarea value={selectedTask.description} onChange={(event) => setData((current) => current ? { ...current, tasks: current.tasks.map((task) => task.id === selectedTask.id ? { ...task, description: event.target.value } : task) } : current)} onBlur={() => void patchTask(selectedTask.id, { description: selectedTask.description })} placeholder="Add context, links, or acceptance criteria…" className="mt-2 min-h-32 w-full resize-y rounded-xl bg-inset p-3 text-[13px] leading-relaxed outline-none focus:ring-1 focus:ring-accent" /><div className="mt-7 border-t border-hairline/40 pt-5"><h3 className="text-[12px] font-semibold">Task discussion</h3><div className="mt-4 space-y-4">{messages.filter((item) => item.task_id === selectedTask.id).map((item) => <div key={item.id} className="flex gap-2.5"><Avatar member={member(item.user_id)} size="size-7" /><div><span className="text-[11px] font-semibold">{item.user_name}</span><p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{item.body}</p></div></div>)}</div><div className="mt-4 flex gap-2"><input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void sendMessage(selectedTask)} placeholder="Write a comment…" className="min-h-10 min-w-0 flex-1 rounded-xl border border-hairline/50 bg-inset px-3 text-[12px] outline-none focus:border-accent" /><button onClick={() => void sendMessage(selectedTask)} className="grid size-10 place-items-center rounded-xl bg-accent text-white"><Send size={14} /></button></div></div></div></aside>}

    {dialog && <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4" onMouseDown={(event) => event.target === event.currentTarget && setDialog(null)}><section role="dialog" aria-modal="true" className="max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-hairline/50 bg-card p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-[17px] font-semibold">{dialog === "project" ? "New project" : "Invite teammates"}</h2><button onClick={() => setDialog(null)} className="grid size-9 place-items-center rounded-lg hover:bg-raised"><X size={16} /></button></div><p className="mt-1 text-[12px] text-ink-secondary">{dialog === "project" ? "Use one project per shared outcome or client." : "Each person gets an email to create an account and join this workspace."}</p>{dialogError && <div className="mt-4 rounded-xl border border-danger/25 bg-danger/8 px-3 py-2 text-[11px] text-danger">{dialogError}</div>}{inviteUrl ? <div className="mt-5 rounded-xl bg-inset p-4"><div className="flex items-center gap-2 text-[13px] font-medium text-success"><Check size={15} />Invitation{inviteUrl.includes(",") ? "s" : ""} sent</div><p className="mb-0 mt-2 text-left text-[11px] text-ink-secondary">{inviteUrl}</p><p className="mb-0 mt-2 text-left text-[11px] text-ink-secondary">They can create an account from the secure link. It expires in 7 days.</p><div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => { setDialogValue(""); setInviteUrl(""); setDialogError(""); }} className="min-h-10 rounded-xl border border-hairline/50 text-[12px] font-medium hover:bg-raised">Invite more</button><button onClick={() => setDialog(null)} className="min-h-10 rounded-xl bg-accent text-[12px] font-medium text-white">Done</button></div></div> : <><label className="mt-5 block text-[11px] font-medium text-ink-secondary">{dialog === "project" ? "Project name" : "Email addresses"}</label>{dialog === "invite" ? <textarea autoFocus value={dialogValue} onChange={(event) => setDialogValue(event.target.value)} placeholder={"alex@company.com, sam@company.com\nUp to 25 at a time"} className="mt-2 min-h-24 w-full resize-none rounded-xl border border-hairline/50 bg-inset px-3 py-2.5 text-[13px] outline-none focus:border-accent" /> : <input autoFocus value={dialogValue} onChange={(event) => setDialogValue(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void submitDialog()} type="text" placeholder="Website launch" className="mt-2 min-h-11 w-full rounded-xl border border-hairline/50 bg-inset px-3 text-[13px] outline-none focus:border-accent" />}<button disabled={saving || !dialogValue.trim()} onClick={() => void submitDialog()} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[13px] font-medium text-white disabled:opacity-40">{saving && <Loader2 size={14} className="animate-spin" />}{dialog === "project" ? "Create project" : "Send invitations"}</button></>}{dialog === "invite" && data.invites.some((invite) => !invite.accepted_at) && <section className="mt-5 border-t border-hairline/40 pt-4"><div className="text-[10px] font-semibold uppercase tracking-[.09em] text-ink-secondary">Pending invitations</div><div className="mt-2 space-y-2">{data.invites.filter((invite) => !invite.accepted_at).slice(0, 8).map((invite) => <div key={invite.id} className="flex items-center gap-2 rounded-xl bg-inset px-3 py-2"><div className="min-w-0 flex-1"><div className="truncate text-[11px]" title={invite.email}>{invite.email}</div><div className="text-[10px] text-ink-secondary">{invite.expires_at <= Date.now() ? "Expired" : "Pending"}</div></div><button disabled={saving} onClick={() => void manageInvite(invite, "resend")} aria-label={`Resend invitation to ${invite.email}`} className="grid size-8 place-items-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40"><RefreshCw size={13} /></button><button disabled={saving} onClick={() => void manageInvite(invite, "cancel")} aria-label={`Cancel invitation to ${invite.email}`} className="grid size-8 place-items-center rounded-lg text-danger/80 hover:bg-danger/10 disabled:opacity-40"><Trash2 size={13} /></button></div>)}</div></section>}</section></div>}
  </main>;
}
