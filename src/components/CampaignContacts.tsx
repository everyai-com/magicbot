import { Fragment, useEffect, useRef, useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
type Row = Record<string, unknown>;
export function contactMetadata(row: Row): Row {
  if (typeof row.metadata === "string") {
    try { const value = JSON.parse(row.metadata); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; }
  }
  return row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata as Row : {};
}
export function contactColumns(row: Row): Row {
  const metadata = contactMetadata(row);
  if (Object.keys(metadata).length) {
    const keys = Object.keys(metadata).map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const result = { ...metadata };
    if (!keys.some((key) => ["name", "fullname", "contactname", "firstname"].includes(key)) && row.first_name) result.first_name = row.first_name;
    if (!keys.some((key) => ["phone", "phonenumber", "mobile", "mobilenumber", "telephone", "contactnumber"].includes(key)) && row.phone_number) result.phone_number = row.phone_number;
    return result;
  }
  return Object.fromEntries(Object.entries(row).filter(([key, value]) => !["id", "_id", "campaign_id", "user_id", "user_email", "metadata", "_creation_time", "created_at", "updated_at"].includes(key) && value != null && value !== ""));
}
export function editableContactColumns(row: Row): Row {
  const fields = { ...contactColumns(row) };
  const normalize = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
  const defaults = [
    { label: "Name", aliases: ["name", "fullname", "contactname", "firstname"], value: row.first_name ?? row.name },
    { label: "S.No", aliases: ["sno", "serialnumber", "serialno"], value: row.sno ?? row.serial_number },
    { label: "Email", aliases: ["email", "emailaddress"], value: row.email },
    { label: "Phone", aliases: ["phone", "phonenumber", "mobile", "mobilenumber", "telephone", "contactnumber"], value: row.phone_number ?? row.phone },
  ];
  for (const field of defaults) {
    if (!Object.keys(fields).some((key) => field.aliases.includes(normalize(key)))) fields[field.label] = field.value ?? "";
  }
  return fields;
}
export function CampaignContacts({ rows, selected, onSelectionChange, onSave, onDelete }: { rows: Row[]; selected: number[]; onSelectionChange: (selected: number[]) => void; onDelete: (row: Row) => Promise<void>; onSave: (rows: Row[]) => Promise<void> }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<number | null>(null);
  useEffect(() => {
    if (menu === null) return;
    const dismiss = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menu]);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [draft, setDraft] = useState<Row[] | null>(null);
  const [column, setColumn] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const visible = draft ?? rows;
  const columns = [...new Set(visible.flatMap((row) => Object.keys(editableContactColumns(row))))];
  const control = "rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px]";
  const edit = (index: number, key: string, value: string) => setDraft(visible.map((row, i) => i === index ? { ...row, metadata: { ...editableContactColumns(row), [key]: value } } : row));
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[13px] text-ink-secondary">{selected.length} of {rows.length} selected</p>
      <button type="button" className={control + " inline-flex items-center gap-2"} disabled={saving || !rows.length} onClick={() => setAdding(!adding)}><Plus size={15} />Add Custom Field</button>
    </div>
    {adding && <div className="flex flex-wrap gap-2"><input aria-label="New column name" className={control + " min-w-0 max-w-full"} placeholder="New field name" value={column} onChange={(e) => setColumn(e.target.value)} disabled={saving} /><button type="button" className={control} disabled={saving} onClick={() => {
      const name = column.trim();
      if (!name || columns.some((key) => key.toLowerCase() === name.toLowerCase())) { setError("Enter a unique column name."); return; }
      setDraft(visible.map((row) => ({ ...row, metadata: { ...editableContactColumns(row), [name]: "" } }))); setColumn(""); setError(""); setAdding(false); setExpanded(0);
    }}>Add field</button></div>}
    <div className={"w-full min-w-0 max-w-full overflow-x-auto " + (menu !== null ? "pb-24" : "")} tabIndex={0} role="region" aria-label="Scrollable campaign contacts">
      <table className="w-max min-w-full text-left text-[12px]">
        <caption className="sr-only">Campaign contacts and recipient selection</caption>
        <thead className="sticky top-0 z-10 bg-card text-ink-secondary"><tr>
          <th className="w-7 py-3"><input type="checkbox" aria-label="Select all contacts" checked={rows.length > 0 && selected.length === rows.length} ref={(element) => { if (element) element.indeterminate = selected.length > 0 && selected.length < rows.length; }} onChange={(e) => onSelectionChange(e.target.checked ? rows.map((_, i) => i) : [])} /></th>
          <th className="w-7 py-3">#</th><th className="whitespace-nowrap px-4 py-3">Name</th><th className="whitespace-nowrap px-4 py-3">S.No</th><th className="whitespace-nowrap px-4 py-3">Email</th><th className="whitespace-nowrap px-4 py-3">Phone</th><th className="w-12 py-3 text-right">Actions</th>
        </tr></thead>
        <tbody>{visible.map((row, i) => {
          const data = editableContactColumns(row);
          const find = (aliases: string[]) => Object.entries(data).find(([key]) => aliases.includes(key.toLowerCase().replace(/[^a-z0-9]/g, "")))?.[1];
          const values = [find(["name", "firstname", "fullname", "contactname"]) ?? row.first_name, find(["sno", "serialnumber", "serialno"]), find(["email", "emailaddress"]) ?? row.email, find(["phone", "phonenumber", "mobile", "mobilenumber", "telephone", "contactnumber"]) ?? row.phone_number];
          return <Fragment key={String(row.id ?? row._id ?? i)}>
            <tr className="border-t border-hairline/40">
              <td className="py-4"><input type="checkbox" aria-label={`Select contact ${i + 1}`} checked={selected.includes(i)} onChange={(e) => onSelectionChange(e.target.checked ? [...selected, i] : selected.filter((value) => value !== i))} /></td>
              <td className="py-4 text-ink-secondary">{i + 1}</td>
              {values.map((value, index) => <td key={index} className="whitespace-nowrap px-4 py-4 align-top">{value == null || value === "" ? "—" : String(value)}</td>)}
              <td className="py-4 text-right"><div className="relative inline-block" ref={menu === i ? menuRef : undefined} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setMenu(null); } }}>
                <button type="button" aria-label={`Actions for contact ${i + 1}`} aria-expanded={menu === i} className="rounded p-1 hover:bg-control focus-visible:outline-2 focus-visible:outline-accent" onClick={() => setMenu(menu === i ? null : i)}><MoreHorizontal size={16} /></button>
                {menu === i && <div className="absolute right-0 top-full z-20 mt-1 flex min-w-32 flex-col gap-1 rounded-lg border border-hairline/50 bg-panel p-1 shadow-xl">
              <button type="button" className={control} disabled={saving} onClick={() => { setMenu(null); setExpanded(i); setDraft(rows.map((contact) => ({ ...contact, metadata: { ...editableContactColumns(contact) } }))); }}>Edit</button>
              <button type="button" className={control + " text-danger"} disabled={saving || Boolean(draft)} onClick={async () => { setSaving(true); setError(""); try { await onDelete(row); setMenu(null); setExpanded(null); } catch (e) { setError(e instanceof Error ? e.message : "Could not delete contact."); } finally { setSaving(false); } }}>Delete</button>
                </div>}
              </div></td>
            </tr>
            {expanded === i && <tr><td colSpan={7} className="border-t border-hairline/30 bg-inset/30 p-3">
              <div className="mb-3 flex justify-between gap-2"><span className="font-medium">Contact fields</span>{!draft && <button type="button" className={control} onClick={() => setDraft(rows.map((contact) => ({ ...contact, metadata: { ...editableContactColumns(contact) } })))}>Edit contact</button>}</div>
              <dl className="grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr))]">{columns.map((key) => <div key={key} className="min-w-0"><dt className="mb-1 text-ink-secondary [overflow-wrap:anywhere]">{key}</dt><dd className="[overflow-wrap:anywhere]">{draft ? <input aria-label={`${key}, contact ${i + 1}`} disabled={saving} className="w-full min-w-0 rounded border border-hairline/40 bg-inset px-2 py-1" value={String(data[key] ?? "")} onChange={(e) => edit(i, key, e.target.value)} /> : String(data[key] ?? "—")}</dd></div>)}</dl>
            </td></tr>}
          </Fragment>;
        })}</tbody>
      </table>
    </div>
    {draft && <div className="flex gap-2"><button type="button" className={control + " bg-accent text-white"} disabled={saving} onClick={async () => { setSaving(true); setError(""); try { await onSave(draft); setDraft(null); setExpanded(null); } catch (e) { setError(e instanceof Error ? e.message : "Could not save columns."); } finally { setSaving(false); } }}>{saving ? "Saving…" : "Save columns"}</button><button type="button" className={control} disabled={saving} onClick={() => { setDraft(null); setExpanded(null); }}>Cancel</button></div>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!rows.length && <p className="text-sm text-ink-secondary">Import contacts before adding columns.</p>}
  </div>;
}
