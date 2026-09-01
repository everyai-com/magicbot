import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, Download, Loader2, PackagePlus, Trash2, Upload } from "lucide-react";
import { api, type Bot } from "@/state/store";
import { BOT_MODULE_CAPABILITIES, type BotModuleCapability } from "../../shared/bot-module";
import { parseSkillMarkdown } from "../../shared/bot-module";
import { cn } from "@/lib/cn";

type InstalledModule = {
  id: string; slug: string; name: string; version: string; description: string; instructions: string;
  triggerTerms: string[]; requiredCapabilities: BotModuleCapability[]; source: string; enabled: boolean;
};

export function BotModulesCard({ bot }: { bot: Bot }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [modules, setModules] = useState<InstalledModule[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggers, setTriggers] = useState("");
  const [instructions, setInstructions] = useState("");
  const [capabilities, setCapabilities] = useState<BotModuleCapability[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const result = await api(`/api/bots/${bot.id}/modules`, { cache: "no-store" }) as { modules: InstalledModule[] };
    setModules(result.modules ?? []);
  };
  useEffect(() => { if (open) void load().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }, [open, bot.id]);

  const install = async (payload: unknown) => {
    setBusy("install"); setError("");
    try {
      await api(`/api/bots/${bot.id}/modules`, { method: "POST", body: JSON.stringify(payload) });
      setName(""); setDescription(""); setTriggers(""); setInstructions(""); setCapabilities([]); setCreating(false);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  };

  const importFile = async (file: File) => {
    if (file.size > 100_000) { setError("Module packages must be smaller than 100 KB."); return; }
    try {
      const text = await file.text();
      if (/\.md$/i.test(file.name)) {
        const skill = parseSkillMarkdown(text);
        setName(skill.name); setDescription(skill.description); setInstructions(skill.instructions); setTriggers(""); setCreating(true);
      } else await install(JSON.parse(text));
    }
    catch (cause) { setError(cause instanceof SyntaxError ? "That module package is not valid JSON." : cause instanceof Error ? cause.message : String(cause)); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };

  const toggle = async (module: InstalledModule) => {
    setBusy(module.id); setError("");
    try { await api(`/api/bots/${bot.id}/modules/${module.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !module.enabled }) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  };

  const remove = async (module: InstalledModule) => {
    if (!window.confirm(`Remove “${module.name}” from ${bot.name}?`)) return;
    setBusy(module.id); setError("");
    try { await api(`/api/bots/${bot.id}/modules/${module.id}`, { method: "DELETE" }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  };

  return <section className="rounded-xl bg-card p-4">
    <button className="flex w-full items-center justify-between gap-4 text-left" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <div className="flex min-w-0 items-start gap-3"><BookOpen size={18} className="mt-0.5 shrink-0 text-accent" /><div><div className="text-[15px] font-medium text-ink">Modules</div><div className="mt-0.5 text-[13px] leading-relaxed text-ink-secondary">Reusable skills that load only when this bot’s request matches their triggers.</div></div></div>
      <ChevronDown size={16} className={cn("shrink-0 text-ink-secondary transition-transform", open && "rotate-180")} />
    </button>
    {open && <div className="mt-4 border-t border-hairline/30 pt-4">
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setCreating((value) => !value)} className="flex min-h-10 items-center gap-2 rounded-lg bg-control px-3 text-[12.5px] text-ink"><PackagePlus size={14} />Create module</button>
        <input ref={fileRef} type="file" accept=".md,.json,text/markdown,application/json" className="hidden" onChange={(event) => event.target.files?.[0] && void importFile(event.target.files[0])} />
        <button onClick={() => fileRef.current?.click()} className="flex min-h-10 items-center gap-2 rounded-lg bg-control px-3 text-[12.5px] text-ink"><Upload size={14} />Import package</button>
      </div>
      {creating && <div className="mt-3 grid gap-3 rounded-xl bg-inset p-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-[11px] text-ink-secondary">Name</span><input value={name} onChange={(event) => setName(event.target.value)} className="min-h-10 w-full rounded-lg border border-hairline/30 bg-card px-3 text-[13px] text-ink" placeholder="Research brief" /></label>
        <label className="block"><span className="mb-1 block text-[11px] text-ink-secondary">Trigger phrases</span><input value={triggers} onChange={(event) => setTriggers(event.target.value)} className="min-h-10 w-full rounded-lg border border-hairline/30 bg-card px-3 text-[13px] text-ink" placeholder="research, investigate" /></label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-[11px] text-ink-secondary">Description</span><input value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-10 w-full rounded-lg border border-hairline/30 bg-card px-3 text-[13px] text-ink" placeholder="How this module helps" /></label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-[11px] text-ink-secondary">Instructions</span><textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} className="min-h-36 w-full resize-y rounded-lg border border-hairline/30 bg-card p-3 text-[12px] leading-relaxed text-ink" placeholder="When this module is active…" /></label>
        <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-[11px] text-ink-secondary">Required capabilities (optional)</legend><div className="flex flex-wrap gap-2">{BOT_MODULE_CAPABILITIES.map((capability) => <label key={capability} className="flex min-h-9 items-center gap-2 rounded-lg bg-card px-2.5 text-[11.5px] text-ink"><input type="checkbox" checked={capabilities.includes(capability)} onChange={(event) => setCapabilities((current) => event.target.checked ? [...current, capability] : current.filter((item) => item !== capability))} />{capability}</label>)}</div></fieldset>
        <button disabled={busy === "install" || !name.trim() || !triggers.trim() || !instructions.trim()} onClick={() => void install({ name, description, triggerTerms: triggers, instructions, requiredCapabilities: capabilities })} className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-[12.5px] font-medium text-white disabled:opacity-50 sm:col-span-2">{busy === "install" && <Loader2 size={14} className="animate-spin" />}Install for {bot.name}</button>
      </div>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>}
      <div className="mt-3 space-y-2">{modules.length === 0 ? <div className="rounded-xl border border-dashed border-hairline/40 px-3 py-5 text-center text-[12.5px] text-ink-secondary">No modules installed for this bot.</div> : modules.map((module) => <article key={module.id} className="rounded-xl border border-hairline/35 bg-inset p-3">
        <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="text-[13px] font-medium text-ink">{module.name}</h4><span className="rounded bg-card px-1.5 py-0.5 text-[9.5px] text-ink-secondary">v{module.version}</span></div><p className="mt-1 text-[11.5px] leading-relaxed text-ink-secondary">{module.description || module.triggerTerms.join(" · ")}</p><div className="mt-2 flex flex-wrap gap-1">{module.triggerTerms.map((term) => <span key={term} className="rounded-md bg-card px-2 py-1 text-[10px] text-ink-secondary">{term}</span>)}</div></div>
          <button role="switch" aria-checked={module.enabled} aria-label={`${module.enabled ? "Disable" : "Enable"} ${module.name}`} disabled={busy === module.id} onClick={() => void toggle(module)} className={cn("relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors disabled:opacity-50", module.enabled ? "bg-accent" : "bg-control")}><span className={cn("absolute top-[3px] size-5 rounded-full bg-white transition-all", module.enabled ? "left-[21px]" : "left-[3px]")} /></button></div>
        <div className="mt-3 flex flex-wrap justify-end gap-1"><a href={`/api/modules/${module.id}/export?format=skill`} className="flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] text-ink-secondary hover:bg-card"><Download size={13} />SKILL.md</a><a href={`/api/modules/${module.id}/export`} className="flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] text-ink-secondary hover:bg-card"><Download size={13} />Package</a><button onClick={() => void remove(module)} className="flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] text-ink-secondary hover:bg-danger/10 hover:text-danger"><Trash2 size={13} />Remove</button></div>
      </article>)}</div>
    </div>}
  </section>;
}
