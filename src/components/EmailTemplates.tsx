import { createPortal } from "react-dom";
import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { FileText, MoreHorizontal, Plus, X } from "lucide-react";

type Row = { id?: unknown; _id?: unknown; name?: unknown; message?: unknown; to?: unknown; subject?: unknown; body?: unknown };
type Draft = { template_id?: string; name: string; to: string; subject: string; body: string };
const control = "mt-2 w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2.5 text-sm outline-none focus:border-accent";
const messageSchema = z.object({ to: z.string().optional(), subject: z.string().optional(), body: z.string().optional() });
function content(row: Row) {
  const serialized = z.string().safeParse(row.message);
  if (serialized.success) {
    try { const parsed = messageSchema.safeParse(JSON.parse(serialized.data)); if (parsed.success) return parsed.data; } catch { /* Legacy plain-text template. */ }
  }
  return { to: String(row.to ?? ""), subject: String(row.subject ?? ""), body: String(row.body ?? row.message ?? "") };
}

export function EmailTemplates({ templates, onSave, onDelete, actionTarget }: { actionTarget?: HTMLDivElement | null; templates: Row[]; onDelete: (id: string) => Promise<void>; onSave: (draft: { template_id?: string; name: string; category: string; message: string }) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<Draft | null>(null);
  const previewDialog = useRef<HTMLDialogElement>(null);
  const previewOpen = preview !== null;
  useEffect(() => { if (previewOpen) previewDialog.current?.showModal(); else previewDialog.current?.close(); }, [previewOpen]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenu(null); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menu]);
  const dialog = useRef<HTMLDialogElement>(null);
  const open = draft !== null;
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  return <div className="min-w-0 space-y-5">
    {actionTarget && createPortal(<button type="button" className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm text-white" onClick={() => { setError(""); setDraft({ name: "", to: "<<email>>", subject: "", body: "" }); }}><Plus size={17} />New Template</button>, actionTarget)}
    {!templates.length && <div className="rounded-xl border border-dashed border-hairline/50 bg-card/30 px-6 py-7"><h3 className="text-lg font-semibold">Gmail Template</h3><p className="mt-2 text-sm leading-relaxed text-ink-secondary">Create reusable Gmail templates with To, Subject, Body, and custom placeholders written inside {"<< >>"}.</p></div>}
    {!templates.length ? <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-hairline/50 px-6 py-10 text-center"><span className="mb-4 rounded-full bg-control/60 p-3 text-ink-secondary"><FileText size={22} /></span><h4 className="text-sm font-semibold">No Gmail templates yet</h4><p className="mt-2 text-sm text-ink-secondary">Create one and it will appear here.</p></div> : <div className="grid gap-3 sm:grid-cols-2">{templates.map((row, index) => {
      const id = String(row.id ?? row._id ?? "");
      const title = String(row.name ?? "Email template");
      return <div key={id || index} className="relative flex min-h-28 min-w-0 items-center justify-between rounded-xl border border-hairline/40 bg-inset">
        <button type="button" aria-label={`View ${title}`} className="min-h-28 min-w-0 flex-1 self-stretch rounded-xl p-5 text-left font-medium break-words hover:bg-control/30 focus-visible:outline-2 focus-visible:outline-accent" onClick={() => { const message = content(row); setMenu(null); setPreview({ name: title, to: message.to ?? "", subject: message.subject ?? "", body: message.body ?? "" }); }}>{title}</button>
        <div ref={menu === id ? menuRef : undefined} className="relative mr-4 shrink-0" onKeyDown={(event) => { if (event.key === "Escape") setMenu(null); }}>
          <button type="button" disabled={busy || !id} aria-label={`Actions for ${title}`} aria-expanded={menu === id} className="rounded-lg p-2 text-ink-secondary hover:bg-control" onClick={() => setMenu(menu === id ? null : id)}><MoreHorizontal size={20} /></button>
          {menu === id && <div className="absolute right-0 top-full z-20 mt-1 min-w-32 rounded-lg border border-hairline/50 bg-panel p-1 shadow-xl">
            <button type="button" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-control" onClick={() => { const message = content(row); setError(""); setMenu(null); setDraft({ template_id: id, name: title, to: message.to ?? "", subject: message.subject ?? "", body: message.body ?? "" }); }}>Edit</button>
            <button type="button" className="block w-full rounded px-3 py-2 text-left text-sm text-danger hover:bg-control" onClick={async () => { if (busy) return; setBusy(true); setError(""); setMenu(null); try { await onDelete(id); } catch (e) { setError(e instanceof Error ? e.message : "Could not delete template."); } finally { setBusy(false); } }}>Delete</button>
          </div>}
        </div>
      </div>;
    })}</div>}
    {!draft && error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <dialog ref={previewDialog} aria-labelledby="email-preview-heading" onCancel={() => setPreview(null)} className="fixed inset-0 m-auto max-h-[85vh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-xl border border-hairline/40 bg-panel p-6 text-ink shadow-xl backdrop:bg-black/60">
      {preview && <>
        <div className="flex items-center justify-between gap-3 border-b border-hairline/40 pb-4"><h3 id="email-preview-heading" className="min-w-0 break-words text-xl font-semibold">{preview.name}</h3><button type="button" autoFocus aria-label="Close template preview" className="shrink-0 rounded p-1 hover:bg-control" onClick={() => setPreview(null)}><X size={20} /></button></div>
        <dl className="mt-5 space-y-5">{(["to", "subject", "body"] as const).map((key) => <div key={key}><dt className="text-sm capitalize text-ink-secondary">{key}</dt><dd className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{preview[key] || "—"}</dd></div>)}</dl>
      </>}
    </dialog>
    <dialog ref={dialog} aria-labelledby="email-template-heading" onCancel={(event) => { if (busy) event.preventDefault(); else setDraft(null); }} className="fixed inset-0 m-auto max-h-[85vh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-xl border border-hairline/40 bg-panel p-6 text-ink shadow-xl backdrop:bg-black/60">
      {draft && <form onSubmit={async (event) => {
        event.preventDefault(); if (busy) return;
        if (draft.name.trim().length < 3 || !draft.to.trim() || !draft.subject.trim() || !draft.body.trim()) { setError("Enter a name of at least 3 characters, recipient, subject, and body."); return; }
        setBusy(true); setError("");
        try { await onSave({ template_id: draft.template_id, name: draft.name.trim(), category: "email", message: JSON.stringify({ to: draft.to.trim(), subject: draft.subject.trim(), body: draft.body.trim() }) }); setDraft(null); } catch (e) { setError(e instanceof Error ? e.message : "Could not save template."); } finally { setBusy(false); }
      }}>
        <div className="flex items-center justify-between gap-3 border-b border-hairline/40 pb-4"><h3 id="email-template-heading" className="text-xl font-semibold">{draft.template_id ? "Edit Gmail Template" : "New Gmail Template"}</h3><button type="button" disabled={busy} aria-label="Close template" onClick={() => setDraft(null)}><X size={20} /></button></div>
        <fieldset disabled={busy} className="mt-5 space-y-4">
          <label className="block text-sm">Template name<input autoFocus required minLength={3} className={control} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label className="block text-sm">To<input required className={control} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
          <label className="block text-sm">Subject<input required className={control} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>
          <label className="block text-sm">Body<textarea required rows={7} className={control + " resize-y"} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
          <p className="text-xs leading-relaxed text-ink-secondary">Use {"<<email>>"}, {"<<Name>>"}, or any custom contact field inside {"<< >>"} to personalize your email.</p>
        </fieldset>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-6 flex justify-end gap-3 border-t border-hairline/40 pt-4"><button type="button" disabled={busy} className="rounded-lg bg-control px-4 py-2 text-sm" onClick={() => setDraft(null)}>Cancel</button><button disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm text-white">{busy ? "Saving…" : draft.template_id ? "Save Changes" : "Create Template"}</button></div>
      </form>}
    </dialog>
  </div>;
}
