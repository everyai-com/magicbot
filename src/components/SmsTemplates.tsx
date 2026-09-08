import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
type Row = Record<string, unknown>;
type Draft = { name: string; category: string; message: string; linked_tags: string[]; template_id?: string };
const categories = ["welcome", "promotional", "reactivation", "retention", "reminder", "follow-up", "seasonal"];
const control = "mt-2 w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2.5 text-sm focus:border-accent outline-none";
const tagsOf = (row: Row) => Array.isArray(row.linked_tags) ? row.linked_tags.map(String) : [];
export function SmsTemplates({ templates, onSave }: { templates: Row[]; onSave: (draft: Draft) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tag, setTag] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (draft) dialog.current?.showModal(); else dialog.current?.close(); }, [Boolean(draft)]);
  const knownTags = [...new Set([...templates.flatMap(tagsOf), ...(draft?.linked_tags ?? [])])];
  const open = (row?: Row) => { setError(""); setTag(""); setDraft(row ? { template_id: String(row.id ?? row._id), name: String(row.name ?? ""), category: String(row.category ?? "welcome"), message: String(row.message ?? ""), linked_tags: tagsOf(row) } : { name: "", category: "welcome", message: "", linked_tags: [] }); };
  return <div className="space-y-4">
    <div className="flex justify-end"><button type="button" className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm text-white" onClick={() => open()}><Plus size={16} />New Template</button></div>
    {!templates.length && <p className="rounded-xl bg-card p-6 text-sm text-ink-secondary">Create reusable SMS templates with categories and personalized messages.</p>}
    <div className="grid gap-3 sm:grid-cols-2">{templates.map((row) => <button type="button" key={String(row.id ?? row._id)} onClick={() => open(row)} className="min-h-24 min-w-0 rounded-xl border border-hairline/40 bg-inset p-4 text-left hover:bg-control/40"><span className="block break-words font-medium">{String(row.name)}</span><span className="mt-2 block text-xs capitalize text-ink-secondary">{String(row.category ?? "")}</span>{tagsOf(row).length > 0 && <span className="mt-2 block text-xs text-accent">{tagsOf(row).join(" · ")}</span>}</button>)}</div>
    <dialog ref={dialog} aria-labelledby="sms-template-heading" onCancel={(event) => { if (busy) event.preventDefault(); else setDraft(null); }} className="fixed inset-0 m-auto max-h-[85vh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-xl border border-hairline/40 bg-panel p-6 text-ink shadow-xl backdrop:bg-black/60">
      {draft && <form onSubmit={async (event) => {
        event.preventDefault(); if (busy) return;
        if (draft.name.trim().length < 3 || draft.message.trim().length < 10) { setError("Enter a name of at least 3 characters and a message of at least 10 characters."); return; }
        setBusy(true); setError("");
        try { await onSave({ ...draft, name: draft.name.trim(), message: draft.message.trim() }); setDraft(null); }
        catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>
        <div className="flex items-center justify-between border-b border-hairline/40 pb-4"><h3 id="sms-template-heading" className="text-xl font-semibold">{draft.template_id ? "Edit Template" : "Create Template"}</h3><button type="button" disabled={busy} aria-label="Close template" onClick={() => setDraft(null)}><X size={20} /></button></div>
        <fieldset disabled={busy} className="mt-5 space-y-5">
          <label className="block text-sm">Template Name <span className="text-danger">*</span><input autoFocus required minLength={3} className={control} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /><span className="mt-2 block text-xs text-ink-secondary">Minimum 3 characters required</span></label>
          <label className="block text-sm">Category <span className="text-danger">*</span><select required className={control + " capitalize"} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>{[...new Set([...categories, draft.category])].map((category) => <option key={category} value={category}>{category.replace("-", " ")}</option>)}</select></label>
          <div className="rounded-xl border border-success/30 bg-success/5 p-4"><label className="block text-sm">Message<textarea required minLength={10} rows={7} className={control + " resize-y"} value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} /></label><p className="mt-2 text-xs text-ink-secondary">Minimum 10 characters required · {draft.message.length} characters</p><p className="mt-3 text-xs leading-relaxed text-ink-secondary">Use placeholders like {"<<Name>>"}, {"<<Phone>>"}, {"<<Email>>"}, or any custom field wrapped in {"<< >>"}. Matching contact details are inserted when the campaign runs.</p><p className="mt-2 text-xs text-ink-secondary">Personalized values and any SMS signature affect the final message length.</p></div>
          <div><h4 className="font-medium">Linked Tags (Optional)</h4><div className="mt-3 flex flex-wrap gap-3">{knownTags.map((value) => <label key={value} className="flex items-center gap-2 rounded-lg border border-hairline/40 p-3 text-sm"><input type="checkbox" checked={draft.linked_tags.includes(value)} onChange={(e) => setDraft({ ...draft, linked_tags: e.target.checked ? [...draft.linked_tags, value] : draft.linked_tags.filter((item) => item !== value) })} />{value}</label>)}</div><div className="mt-2 flex items-end gap-2"><input aria-label="New linked tag" placeholder="Tag name" className={control} value={tag} onChange={(e) => setTag(e.target.value)} /><button type="button" className="shrink-0 rounded-lg bg-control px-3 py-2.5 text-sm" disabled={!tag.trim()} onClick={() => { setDraft({ ...draft, linked_tags: [...new Set([...draft.linked_tags, tag.trim()])] }); setTag(""); }}>Add tag</button></div></div>
        </fieldset>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-6 flex justify-end gap-3 border-t border-hairline/40 pt-4"><button type="button" disabled={busy} className="rounded-lg bg-control px-4 py-2 text-sm" onClick={() => setDraft(null)}>Cancel</button><button disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm text-white">{busy ? "Saving…" : draft.template_id ? "Save Changes" : "Create Template"}</button></div>
      </form>}
    </dialog>
  </div>;
}
