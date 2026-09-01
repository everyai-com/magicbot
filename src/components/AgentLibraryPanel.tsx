import { cn } from "@/lib/cn";
import { api, useStore, type Bot } from "@/state/store";
import { ArrowDownToLine, Bot as BotIcon, Check, Loader2, Search, UploadCloud, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SpecialistAgent, SpecialistBundle } from "../../shared/specialist-agent";

const BUNDLES: Array<{ id: "all" | SpecialistBundle; label: string }> = [
  { id: "all", label: "All" }, { id: "strategy", label: "Strategy" }, { id: "sales", label: "Sales" },
  { id: "finance-legal", label: "Finance & legal" }, { id: "engineering", label: "Engineering" },
  { id: "communication", label: "Communication" }, { id: "personal", label: "Personal" },
];

export function AgentLibraryPanel({ onClose, returnFocusRef }: { onClose: () => void; returnFocusRef: React.RefObject<HTMLButtonElement | null> }) {
  const { dispatch } = useStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [agents, setAgents] = useState<SpecialistAgent[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [bundle, setBundle] = useState<"all" | SpecialistBundle>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState("");

  useEffect(() => {
    dialogRef.current?.focus();
    void api("/api/specialists").then((result: { specialists: SpecialistAgent[] }) => {
      setAgents(result.specialists); setSelectedId(result.specialists[0]?.id ?? "");
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setLoading(false));
    return () => returnFocusRef.current?.focus();
  }, [returnFocusRef]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [busy, onClose]);

  const filtered = useMemo(() => agents.filter((agent) => {
    const matchesBundle = bundle === "all" || agent.bundle === bundle;
    const haystack = `${agent.name} ${agent.title} ${agent.summary}`.toLowerCase();
    return matchesBundle && haystack.includes(query.trim().toLowerCase());
  }), [agents, bundle, query]);
  const selected = agents.find((agent) => agent.id === selectedId) ?? filtered[0];

  const addBot = (bot: Bot) => { dispatch({ type: "botAdded", bot }); setCreated(bot.name); };
  const spawn = async () => {
    if (!selected) return;
    setBusy(true); setError(""); setCreated("");
    try { const result = await api(`/api/specialists/${encodeURIComponent(selected.id)}/spawn`, { method: "POST", body: "{}" }) as { bot: Bot }; addBot(result.bot); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const importFile = async (file: File) => {
    if (file.size > 500_000) { setError("That specialist file is too large."); return; }
    setBusy(true); setError(""); setCreated("");
    try {
      const manifest = JSON.parse(await file.text()) as unknown;
      const result = await api("/api/specialists/import", { method: "POST", body: JSON.stringify(manifest) }) as { bot: Bot };
      addBot(result.bot);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That file is not valid JSON."); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex bg-black/65 md:items-center md:justify-center md:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="agent-library-title" tabIndex={-1} className="flex h-full w-full flex-col overflow-hidden bg-canvas outline-none md:h-[min(780px,92vh)] md:max-w-6xl md:rounded-2xl md:border md:border-hairline/60 md:shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 border-b border-hairline/50 px-4 py-3 md:px-6">
          <div className="flex size-9 items-center justify-center rounded-xl bg-accent/15 text-accent"><BotIcon size={19} /></div>
          <div className="min-w-0 flex-1"><h2 id="agent-library-title" className="text-[16px] font-semibold text-ink">Agent library</h2><p className="truncate text-[12px] text-ink-secondary">30 specialists across six operating bundles</p></div>
          <input ref={fileRef} className="hidden" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="hidden items-center gap-2 rounded-lg border border-hairline/60 px-3 py-2 text-[13px] text-ink hover:bg-raised disabled:opacity-50 sm:flex"><UploadCloud size={15} /> Import</button>
          <button type="button" aria-label="Close agent library" onClick={onClose} disabled={busy} className="flex size-9 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"><X size={19} /></button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <section className="flex min-h-0 flex-1 flex-col border-b border-hairline/50 md:w-[48%] md:border-b-0 md:border-r">
            <div className="shrink-0 space-y-3 p-4 md:px-5">
              <label className="flex items-center gap-2 rounded-xl border border-hairline/60 bg-card px-3 py-2.5"><Search size={16} className="text-ink-secondary" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search roles and outcomes" className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-tertiary" /></label>
              <div className="flex gap-2 overflow-x-auto pb-1">{BUNDLES.map((item) => <button key={item.id} type="button" onClick={() => setBundle(item.id)} className={cn("whitespace-nowrap rounded-full px-3 py-1.5 text-[12px]", bundle === item.id ? "bg-accent text-white" : "bg-raised text-ink-secondary hover:text-ink")}>{item.label}</button>)}</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 md:px-5">
              {loading ? <div className="flex justify-center py-12"><Loader2 className="animate-spin text-accent" /></div> : filtered.length === 0 ? <p className="py-10 text-center text-[13px] text-ink-secondary">No specialists match that search.</p> : <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">{filtered.map((agent) => <button key={agent.id} type="button" onClick={() => setSelectedId(agent.id)} className={cn("rounded-xl border p-3 text-left transition", selected?.id === agent.id ? "border-accent/70 bg-accent/10" : "border-hairline/50 bg-card hover:border-hairline hover:bg-raised/50")}><div className="flex items-start justify-between gap-2"><div><div className="text-[14px] font-medium text-ink">{agent.title}</div><div className="text-[12px] text-accent">{agent.name}</div></div>{selected?.id === agent.id && <Check size={15} className="shrink-0 text-accent" />}</div><p className="mt-2 line-clamp-2 text-[12px] leading-5 text-ink-secondary">{agent.summary}</p></button>)}</div>}
            </div>
          </section>
          <section className="min-h-0 flex-1 overflow-y-auto p-5 md:p-7">
            {selected && <div className="mx-auto max-w-xl"><div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">{selected.bundle.replace("-", " & ")}</div><h3 className="mt-2 text-2xl font-semibold text-ink">{selected.title}</h3><p className="mt-2 text-[14px] leading-6 text-ink-secondary">{selected.mandate}</p>
              <h4 className="mt-6 text-[12px] font-semibold uppercase tracking-wide text-ink-secondary">Expected deliverables</h4><ul className="mt-2 space-y-2">{selected.deliverables.map((item) => <li key={item} className="flex gap-2 text-[13px] text-ink"><Check size={14} className="mt-0.5 shrink-0 text-accent" />{item}</li>)}</ul>
              <h4 className="mt-6 text-[12px] font-semibold uppercase tracking-wide text-ink-secondary">Operating guardrails</h4><ul className="mt-2 space-y-2">{selected.guardrails.map((item) => <li key={item} className="text-[13px] leading-5 text-ink-secondary">• {item}</li>)}</ul>
              {selected.recommendedCapabilities.length > 0 && <div className="mt-6"><h4 className="text-[12px] font-semibold uppercase tracking-wide text-ink-secondary">Recommended tools</h4><div className="mt-2 flex flex-wrap gap-2">{selected.recommendedCapabilities.map((item) => <span key={item} className="rounded-full bg-raised px-2.5 py-1 text-[11px] text-ink-secondary">{item}</span>)}</div><p className="mt-2 text-[11px] text-ink-tertiary">Recommendations never grant access. Your approval policy still applies.</p></div>}
              {error && <div role="alert" className="mt-5 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}{created && <div role="status" className="mt-5 rounded-lg bg-success/10 px-3 py-2 text-[12px] text-success">{created} is ready and selected.</div>}
              <div className="sticky bottom-0 mt-7 flex gap-2 border-t border-hairline/50 bg-canvas py-4"><button type="button" onClick={() => void spawn()} disabled={busy} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-[14px] font-medium text-white hover:bg-accent/90 disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <BotIcon size={16} />} Add specialist</button><a href={`/api/specialists/${encodeURIComponent(selected.id)}/export`} download className="flex items-center justify-center gap-2 rounded-xl border border-hairline/60 px-4 py-3 text-[13px] text-ink hover:bg-raised" title="Export portable role"><ArrowDownToLine size={16} /><span className="hidden sm:inline">Export</span></a><button type="button" onClick={() => fileRef.current?.click()} className="flex items-center justify-center rounded-xl border border-hairline/60 px-3 sm:hidden" aria-label="Import specialist"><UploadCloud size={17} /></button></div>
            </div>}
          </section>
        </div>
      </div>
    </div>, document.body,
  );
}
