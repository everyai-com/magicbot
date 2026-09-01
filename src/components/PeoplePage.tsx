import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, Edit3, Loader2, MessageCircle, Network, RefreshCw, Search, UserRound, Users, X } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";

type PersonIdentity = { provider: string; value: string };
type Person = { id: string; displayName: string; personType: "self" | "person" | "group" | "organization"; notes: string; sourceKey: string; updatedAt: number; identities: PersonIdentity[] };
type Relationship = { id: string; fromPersonId: string; toPersonId: string; relationType: string; label: string; strength: number; confidence: number; inboundCount: number; outboundCount: number; firstInteractionAt: number | null; lastInteractionAt: number | null; sourceType: string; sourceId: string; userVerified: boolean; updatedAt: number };
type PeopleGraph = { generatedAt: number; people: Person[]; edges: Relationship[] };

const panel = "rounded-2xl border border-hairline/40 bg-card";
const shortIdentity = (identity: PersonIdentity) => identity.provider === "whatsapp" && /^\d+$/.test(identity.value) ? `+${identity.value}` : identity.value;
const relative = (timestamp: number | null) => {
  if (!timestamp) return "No messages yet";
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric", year: new Date(timestamp).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

function RelationshipMap({ people, edges, selectedId, onSelect }: { people: Person[]; edges: Relationship[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const self = people.find((person) => person.personType === "self");
  const byId = new Map(people.map((person) => [person.id, person]));
  const visible = edges.filter((edge) => byId.has(edge.toPersonId)).slice(0, 10);
  if (!self || visible.length === 0) return <div className="flex min-h-52 items-center justify-center rounded-xl bg-inset px-6 text-center text-[13px] text-ink-secondary">Connect WhatsApp or approve a relationship observation to build your map.</div>;
  const positions = visible.map((edge, index) => {
    const angle = (Math.PI * 2 * index) / visible.length - Math.PI / 2;
    const radiusX = visible.length < 5 ? 105 : 135;
    const radiusY = visible.length < 5 ? 76 : 96;
    return { edge, person: byId.get(edge.toPersonId)!, x: 190 + Math.cos(angle) * radiusX, y: 140 + Math.sin(angle) * radiusY };
  });
  return <div className="overflow-hidden rounded-xl bg-inset" aria-label="Relationship map">
    <svg viewBox="0 0 380 280" className="min-h-[240px] w-full sm:min-h-[280px]" role="img" aria-label={`${visible.length} strongest relationships around you`}>
      {positions.map(({ edge, x, y }) => <line key={edge.id} x1="190" y1="140" x2={x} y2={y} stroke="currentColor" className="text-accent/30" strokeWidth={Math.max(1.5, Math.min(7, edge.strength / 14))} />)}
      <circle cx="190" cy="140" r="31" className="fill-accent" />
      <text x="190" y="144" textAnchor="middle" className="fill-white text-[12px] font-semibold">You</text>
      {positions.map(({ edge, person, x, y }) => <g key={person.id} role="button" tabIndex={0} aria-label={`${person.displayName}, ${edge.label || edge.relationType}`} onClick={() => onSelect(person.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(person.id); }} className="cursor-pointer outline-none">
        <circle cx={x} cy={y} r={selectedId === person.id ? 29 : 26} className={selectedId === person.id ? "fill-accent/25 stroke-accent" : "fill-card stroke-hairline"} strokeWidth="2" />
        <text x={x} y={y - 2} textAnchor="middle" className="fill-ink text-[9px] font-semibold">{person.displayName.slice(0, 12)}</text>
        <text x={x} y={y + 11} textAnchor="middle" className="fill-ink-secondary text-[8px]">{(edge.label || edge.relationType).slice(0, 14)}</text>
      </g>)}
    </svg>
  </div>;
}

export function PeoplePage() {
  const [graph, setGraph] = useState<PeopleGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [relationshipLabel, setRelationshipLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const next = await api("/api/people/graph") as PeopleGraph;
      setGraph(next);
      setSelectedId((current) => current && next.people.some((person) => person.id === current) ? current : next.edges[0]?.toPersonId ?? next.people.find((person) => person.personType !== "self")?.id ?? null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load people"); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const peopleById = useMemo(() => new Map((graph?.people ?? []).map((person) => [person.id, person])), [graph]);
  const edgeByPerson = useMemo(() => new Map((graph?.edges ?? []).map((edge) => [edge.toPersonId, edge])), [graph]);
  const contacts = useMemo(() => (graph?.people ?? []).filter((person) => person.personType !== "self" && `${person.displayName} ${person.identities.map((identity) => identity.value).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => (edgeByPerson.get(b.id)?.strength ?? 0) - (edgeByPerson.get(a.id)?.strength ?? 0)), [graph, query, edgeByPerson]);
  const selected = selectedId ? peopleById.get(selectedId) ?? null : null;
  const selectedEdge = selectedId ? edgeByPerson.get(selectedId) ?? null : null;

  const startEditing = () => {
    if (!selected) return;
    setName(selected.displayName); setNotes(selected.notes); setRelationshipLabel(selectedEdge?.label || selectedEdge?.relationType.replaceAll("-", " ") || ""); setEditing(true);
  };
  const save = async () => {
    if (!selected || !name.trim()) return;
    setSaving(true); setError("");
    try {
      await api(`/api/people/${selected.id}`, { method: "PATCH", body: JSON.stringify({ displayName: name, notes }) });
      if (selectedEdge && relationshipLabel.trim() !== (selectedEdge.label || selectedEdge.relationType.replaceAll("-", " "))) {
        await api(`/api/people/relationships/${selectedEdge.id}`, { method: "PATCH", body: JSON.stringify({ relationType: relationshipLabel, label: relationshipLabel }) });
      }
      setEditing(false); await load(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save person"); }
    finally { setSaving(false); }
  };

  if (loading) return <main className="flex min-w-0 flex-1 items-center justify-center bg-app"><Loader2 size={22} className="animate-spin text-accent" /></main>;
  const totalMessages = (graph?.edges ?? []).reduce((sum, edge) => sum + edge.inboundCount + edge.outboundCount, 0);
  return <main className="min-w-0 flex-1 overflow-y-auto bg-app px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-14 sm:px-5 md:pt-5 lg:px-8">
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-accent"><Network size={14} />Relationship intelligence</div><h1 className="mt-1 text-[26px] font-semibold tracking-tight text-ink sm:text-[30px]">People</h1><p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-secondary">Who you know, how you are connected, and the interaction history your agents may use.</p></div><button onClick={() => void load(true)} disabled={refreshing} className="flex min-h-10 items-center gap-2 rounded-xl border border-hairline/40 bg-card px-3 text-[12.5px] text-ink-secondary hover:text-ink disabled:opacity-60"><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />Refresh</button></header>
      {error && <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">{error}</div>}
      <section className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="People summary">{[
        [contacts.length, "People", Users], [(graph?.edges ?? []).length, "Relationships", Network], [totalMessages, "Messages mapped", MessageCircle],
      ].map(([value, label, Icon]) => { const SummaryIcon = Icon as typeof Users; return <div key={String(label)} className="rounded-xl border border-hairline/40 bg-card p-3 sm:p-4"><SummaryIcon size={16} className="text-accent" /><div className="mt-3 text-[22px] font-semibold leading-none text-ink sm:text-[24px]">{Number(value).toLocaleString()}</div><div className="mt-1.5 text-[10.5px] text-ink-secondary sm:text-[11.5px]">{String(label)}</div></div>; })}</section>
      <section className={cn(panel, "p-3 sm:p-5")}><div className="mb-3 flex items-center justify-between"><div><h2 className="text-[16px] font-semibold text-ink">Relationship map</h2><p className="mt-0.5 text-[12px] text-ink-secondary">Your ten strongest current connections. Line weight reflects interaction strength.</p></div><Network size={18} className="text-accent" /></div><RelationshipMap people={graph?.people ?? []} edges={graph?.edges ?? []} selectedId={selectedId} onSelect={setSelectedId} /></section>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,.8fr)_minmax(0,1.2fr)]">
        <section className={cn(panel, "min-w-0 overflow-hidden")}><div className="border-b border-hairline/30 p-3.5"><label className="flex min-h-11 items-center gap-2 rounded-xl bg-inset px-3"><Search size={15} className="text-ink-secondary" /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search people" placeholder="Search people or numbers" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-secondary" /></label></div><div className="max-h-[620px] overflow-y-auto p-2">{contacts.length === 0 ? <div className="px-4 py-8 text-center text-[13px] text-ink-secondary">No people match this search.</div> : contacts.map((person) => { const edge = edgeByPerson.get(person.id); return <button key={person.id} onClick={() => { setSelectedId(person.id); setEditing(false); }} className={cn("flex min-h-16 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left", selectedId === person.id ? "bg-accent/10" : "hover:bg-inset")}><span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-raised text-accent">{person.personType === "group" ? <Users size={17} /> : <UserRound size={17} />}</span><span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-medium text-ink">{person.displayName}</span><span className="mt-0.5 block truncate text-[11px] capitalize text-ink-secondary">{edge?.label || edge?.relationType.replaceAll("-", " ") || person.personType} · {relative(edge?.lastInteractionAt ?? null)}</span></span>{edge && <span className="w-10 shrink-0"><span className="block h-1.5 overflow-hidden rounded-full bg-raised"><span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, Math.min(100, edge.strength))}%` }} /></span><span className="mt-1 block text-center text-[9px] text-ink-secondary">{Math.round(edge.strength)}</span></span>}</button>; })}</div></section>
        <section className={cn(panel, "min-w-0 p-4 sm:p-5")}>{!selected ? <div className="flex min-h-64 items-center justify-center text-[13px] text-ink-secondary">Select a person to inspect the relationship.</div> : <>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex size-12 items-center justify-center rounded-full bg-accent/10 text-accent">{selected.personType === "group" ? <Users size={20} /> : <UserRound size={20} />}</div>{editing ? <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Person name" maxLength={160} className="mt-3 min-h-11 w-full rounded-xl border border-accent/50 bg-inset px-3 text-[16px] font-semibold text-ink outline-none" /> : <h2 className="mt-3 break-words text-[21px] font-semibold text-ink">{selected.displayName}</h2>}<div className="mt-1 flex flex-wrap gap-1.5">{selected.identities.map((identity) => <span key={`${identity.provider}:${identity.value}`} className="rounded-md bg-inset px-2 py-1 text-[10.5px] text-ink-secondary">{identity.provider} · {shortIdentity(identity)}</span>)}</div></div>{editing ? <button aria-label="Cancel editing" onClick={() => setEditing(false)} className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-inset"><X size={17} /></button> : <button onClick={startEditing} className="flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-hairline/40 px-3 text-[12px] text-ink hover:bg-inset"><Edit3 size={14} />Edit</button>}</div>
          {selectedEdge && <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-xl bg-inset p-3"><ArrowDownLeft size={14} className="text-success" /><div className="mt-2 text-[19px] font-semibold text-ink">{selectedEdge.inboundCount.toLocaleString()}</div><div className="text-[10.5px] text-ink-secondary">Received</div></div><div className="rounded-xl bg-inset p-3"><ArrowUpRight size={14} className="text-accent" /><div className="mt-2 text-[19px] font-semibold text-ink">{selectedEdge.outboundCount.toLocaleString()}</div><div className="text-[10.5px] text-ink-secondary">Sent</div></div><div className="rounded-xl bg-inset p-3"><Network size={14} className="text-accent" /><div className="mt-2 text-[19px] font-semibold text-ink">{Math.round(selectedEdge.strength)}</div><div className="text-[10.5px] text-ink-secondary">Strength</div></div><div className="rounded-xl bg-inset p-3"><MessageCircle size={14} className="text-accent" /><div className="mt-2 text-[12px] font-semibold text-ink">{relative(selectedEdge.lastInteractionAt)}</div><div className="text-[10.5px] text-ink-secondary">Last contact</div></div></div>}
          <div className="mt-5"><label className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">Relationship</label>{editing ? <input value={relationshipLabel} onChange={(event) => setRelationshipLabel(event.target.value)} aria-label="Relationship label" maxLength={160} placeholder="friend, manager, client…" className="mt-1.5 min-h-11 w-full rounded-xl border border-hairline/40 bg-inset px-3 text-[13px] text-ink outline-none focus:border-accent" /> : <div className="mt-1.5 text-[13.5px] capitalize text-ink">{selectedEdge?.label || selectedEdge?.relationType.replaceAll("-", " ") || "Not labeled"}</div>}</div>
          <div className="mt-4"><label className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">Private notes</label>{editing ? <textarea value={notes} onChange={(event) => setNotes(event.target.value)} aria-label="Private notes" maxLength={4000} placeholder="Context agents should know about this person…" className="mt-1.5 min-h-28 w-full resize-y rounded-xl border border-hairline/40 bg-inset px-3 py-2.5 text-[13px] leading-relaxed text-ink outline-none focus:border-accent" /> : <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-secondary">{selected.notes || "No private notes yet."}</p>}</div>
          {selectedEdge && <div className="mt-4 text-[10.5px] text-ink-secondary">Source: {selectedEdge.sourceType === "whatsapp" ? "WhatsApp interaction history" : "You confirmed this relationship"} · {selectedEdge.userVerified ? "verified" : `${Math.round(selectedEdge.confidence * 100)}% confidence`}</div>}
          {editing && <button disabled={saving || !name.trim()} onClick={() => void save()} className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[13px] font-medium text-white disabled:opacity-40">{saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}Save person</button>}
        </>}</section>
      </div>
    </div>
  </main>;
}
