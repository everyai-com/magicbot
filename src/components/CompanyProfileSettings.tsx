import { useEffect, useState } from "react";
import { Building2, Check, LoaderCircle } from "lucide-react";
import { api } from "@/state/store";
import { normalizeCompanyProfile, type CompanyProfile } from "../../shared/company-profile";
import { Card } from "./SettingsPrimitives";

const inputClass = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";
const labelClass = "flex flex-col gap-1.5 text-[12px] font-medium text-ink-secondary";
const lines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
const glossaryLines = (value: string) => lines(value).flatMap((line) => { const index = line.indexOf(":"); if (index < 1) return []; const term = line.slice(0, index).trim(); const meaning = line.slice(index + 1).trim(); return term && meaning ? [{ term, meaning }] : []; });

export function CompanyProfileSettings() {
  const [profile, setProfile] = useState<CompanyProfile>(normalizeCompanyProfile({})); const [products, setProducts] = useState(""); const [customers, setCustomers] = useState(""); const [differentiators, setDifferentiators] = useState(""); const [facts, setFacts] = useState(""); const [rules, setRules] = useState(""); const [glossary, setGlossary] = useState("");
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false); const [error, setError] = useState("");
  const apply = (next: CompanyProfile) => { setProfile(next); setProducts(next.products.join("\n")); setCustomers(next.customers.join("\n")); setDifferentiators(next.differentiators.join("\n")); setFacts(next.facts.join("\n")); setRules(next.operatingRules.join("\n")); setGlossary(next.glossary.map((item) => `${item.term}: ${item.meaning}`).join("\n")); };
  useEffect(() => { let active = true; void api("/api/company-profile").then((result: { profile: CompanyProfile }) => { if (active) apply(normalizeCompanyProfile(result.profile)); }).catch((reason) => active && setError(reason instanceof Error ? reason.message : "Could not load company context")).finally(() => active && setLoading(false)); return () => { active = false; }; }, []);
  const update = <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) => setProfile((current) => ({ ...current, [key]: value }));
  const save = async () => { setSaving(true); setSaved(false); setError(""); try { const pending = normalizeCompanyProfile({ ...profile, products: lines(products), customers: lines(customers), differentiators: lines(differentiators), facts: lines(facts), operatingRules: lines(rules), glossary: glossaryLines(glossary) }); const result = await api("/api/company-profile", { method: "PUT", body: JSON.stringify(pending) }) as { profile: CompanyProfile }; apply(normalizeCompanyProfile(result.profile)); setSaved(true); window.setTimeout(() => setSaved(false), 1800); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save company context"); } finally { setSaving(false); } };

  return <Card title="Shared company context" subtitle="One structured company profile for every hosted bot. Use verified facts and current strategy—not a prompt dump.">
    {loading ? <div className="flex items-center gap-2 py-2 text-[13px] text-ink-secondary"><LoaderCircle size={15} className="animate-spin" />Loading company context…</div> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex items-center gap-2 text-[12px] font-medium text-accent sm:col-span-2"><Building2 size={15} />Company mount</div>
      <label className={labelClass}>Company name<input value={profile.name} onChange={(event) => update("name", event.target.value)} placeholder="MagicBots" className={inputClass} /></label>
      <label className={labelClass}>Products and services<textarea rows={3} value={products} onChange={(event) => setProducts(event.target.value)} placeholder={"Autonomous agent workspace\nWhatsApp operations"} className={inputClass} /></label>
      <label className={`${labelClass} sm:col-span-2`}>What the company is<textarea rows={3} value={profile.description} onChange={(event) => update("description", event.target.value)} placeholder="A precise description agents can rely on" className={inputClass} /></label>
      <label className={labelClass}>Customer segments<textarea rows={3} value={customers} onChange={(event) => setCustomers(event.target.value)} placeholder={"Founders\nOperations teams"} className={inputClass} /></label>
      <label className={labelClass}>Differentiators<textarea rows={3} value={differentiators} onChange={(event) => setDifferentiators(event.target.value)} placeholder={"Context-first\nHuman-gated autonomy"} className={inputClass} /></label>
      <label className={`${labelClass} sm:col-span-2`}>Current strategy<textarea rows={4} value={profile.strategy} onChange={(event) => update("strategy", event.target.value)} placeholder="What matters now, and how the company intends to win" className={inputClass} /></label>
      <label className={labelClass}>Brand voice<textarea rows={4} value={profile.brandVoice} onChange={(event) => update("brandVoice", event.target.value)} placeholder="Clear, ambitious, warm; avoid hype" className={inputClass} /></label>
      <label className={labelClass}>Verified facts<textarea rows={4} value={facts} onChange={(event) => setFacts(event.target.value)} placeholder={"One fact per line\nOnly durable, verified statements"} className={inputClass} /></label>
      <label className={labelClass}>Operating rules<textarea rows={4} value={rules} onChange={(event) => setRules(event.target.value)} placeholder={"Never invent customer claims\nAsk before publishing"} className={inputClass} /></label>
      <label className={labelClass}>Glossary <span className="font-normal">term: meaning</span><textarea rows={4} value={glossary} onChange={(event) => setGlossary(event.target.value)} placeholder={"ICP: Founder-led SaaS\nMagicBot: An autonomous agent"} className={inputClass} /></label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><button type="button" onClick={() => void save()} disabled={saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60">{saving && <LoaderCircle size={14} className="animate-spin" />}{saving ? "Saving…" : "Save company context"}</button>{saved && <span className="inline-flex items-center gap-1 text-[12px] text-success"><Check size={13} />Available to every hosted bot</span>}{error && <span role="alert" className="text-[12px] text-danger">{error}</span>}</div>
    </div>}
  </Card>;
}
