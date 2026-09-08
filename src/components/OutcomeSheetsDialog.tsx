import { writeNewSheet, confirmedSheetWrite } from "@/lib/sheets-write";
import { useEffect, useRef, useState } from "react";
import { sheetsResult, spreadsheetId } from "@/lib/sheets-result";
import { api } from "@/state/store";
const control = "rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-sm";
async function execute(tool: string, args: Record<string, unknown>) {
  const response = await api("/api/outcome-sheets/execute", { method: "POST", body: JSON.stringify({ tool: "GOOGLESHEETS_" + tool, arguments: args }) });
  return sheetsResult(response);
}
export function OutcomeSheetsDialog({ campaignName, rows, onClose }: { campaignName: string; rows: Record<string, unknown>[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState("new");
  const [name, setName] = useState(campaignName + " outcomes");
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [id, setId] = useState("");
  const [tabs, setTabs] = useState<string[]>([]);
  const [tab, setTab] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [createdId, setCreatedId] = useState("");
  const [createdName, setCreatedName] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (mode !== "existing") return;
    let alive = true; setLoading(true); setError("");
    void (async () => {
      const all: { id: string; name: string }[] = []; let token = "";
      do {
        const result = await execute("SEARCH_SPREADSHEETS", { max_results: 100, ...(token ? { page_token: token } : {}) });
        const items = result?.files ?? result?.spreadsheets;
        if (!Array.isArray(items)) throw new Error("Google Sheets returned an unexpected file list.");
        all.push(...items.map((item: { id?: string; spreadsheet_id?: string; name?: string; title?: string }) => ({ id: item.id ?? item.spreadsheet_id ?? "", name: item.name ?? item.title ?? "Untitled" })).filter((item) => item.id));
        token = result.next_page_token ?? result.nextPageToken ?? "";
      } while (token && alive);
      if (alive) setFiles(all);
    })().catch((e) => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [mode, retry]);
  useEffect(() => {
    setTabs([]); setTab(""); if (!id) return;
    let alive = true; setLoading(true); setError("");
    execute("GET_SPREADSHEET_INFO", { spreadsheet_id: id }).then((result) => {
      const names = result?.sheets?.map((sheet: { properties: { title: string } }) => sheet.properties.title);
      if (!names?.length) throw new Error("No worksheets available in this spreadsheet.");
      if (alive) { setTabs(names); setTab(names[0]); }
    }).catch((e) => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);
  const sync = async () => {
    if (busy) return;
    setBusy(true); setError(""); setLink("");
    try {
      let target = id;
      if (mode === "new") {
        target = createdId;
        if (!target) {
          const created = await execute("CREATE_GOOGLE_SHEET1", { title: name.trim() });
          target = spreadsheetId(created);
          if (!/^[\w-]+$/.test(target)) throw new Error("Google Sheets did not return a spreadsheet ID. Check your Drive before retrying.");
          setCreatedId(target); setCreatedName(name.trim());
        }
      }
      if (mode === "new" && createdId && createdName !== name.trim()) {
        await execute("UPDATE_SPREADSHEET_PROPERTIES", { spreadsheetId: target, fields: "title", properties: { title: name.trim() } });
        setCreatedName(name.trim());
      }
      if (!target) throw new Error("Select a spreadsheet.");
      const headers = [...new Set(rows.flatMap(Object.keys))];
      const cell = (value: unknown) => value == null ? "" : typeof value === "object" ? JSON.stringify(value) : value;
      let values = [headers, ...rows.map((row) => headers.map((header) => cell(row[header])))];
      let result;
      if (mode === "existing") {
        if (!tab) throw new Error("Select a worksheet.");
        const range = "'" + tab.replaceAll("'", "''") + "'";
        const existing = await execute("VALUES_GET", { spreadsheet_id: target, range: range + "!1:1" });
        const savedHeaders = existing?.values?.[0] as string[] | undefined;
        if (savedHeaders?.length) {
          if (headers.some((header) => !savedHeaders.includes(header))) throw new Error("This worksheet has different columns. Choose an empty worksheet or create a new spreadsheet to include all outcome fields.");
          values = rows.map((row) => savedHeaders.map((header) => cell(row[header])));
        }
        result = await execute("SPREADSHEETS_VALUES_APPEND", { spreadsheetId: target, range: range + "!A1", values, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS" });
      } else {
        result = await writeNewSheet(execute, target, values);
      }
      if (!confirmedSheetWrite(result)) throw new Error("Google Sheets did not confirm any written cells. Check the spreadsheet before retrying.");
      setLink(`https://docs.google.com/spreadsheets/d/${target}/edit`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} onCancel={(e) => { if (busy) e.preventDefault(); else onClose(); }} className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-hairline/40 bg-panel p-6 text-ink shadow-xl backdrop:bg-black/60">
    <form onSubmit={(e) => { e.preventDefault(); void sync(); }}>
      <h3 className="text-lg font-semibold">Open in Google Sheets</h3>
      <p className="mt-2 text-sm text-ink-secondary">Create a new spreadsheet or select an existing spreadsheet and worksheet.</p>
      <fieldset disabled={busy} className="mt-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">{["new", "existing"].map((value) => <button type="button" key={value} aria-pressed={mode === value} className={"rounded-xl border p-4 text-left " + (mode === value ? "border-accent bg-accent/10" : "border-hairline/40 bg-inset")} onClick={() => { setMode(value); setError(""); setLink(""); }}>{value === "new" ? "New sheet" : "Existing sheet"}</button>)}</div>
        {mode === "new" ? <label className="block text-sm">Sheet name<input required className={control + " mt-2 w-full"} value={name} onChange={(e) => { setName(e.target.value); setLink(""); }} /></label> : <>
          <label className="block text-sm">Spreadsheet<select required className={control + " mt-2 w-full"} value={id} onChange={(e) => setId(e.target.value)}><option value="">Select a spreadsheet</option>{files.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}</select></label>
          {!!tabs.length && <label className="block text-sm">Worksheet<select className={control + " mt-2 w-full"} value={tab} onChange={(e) => setTab(e.target.value)}>{tabs.map((title) => <option key={title}>{title}</option>)}</select></label>}
          <p className="text-xs text-ink-secondary">Outcomes are appended to the selected worksheet using its column headers. Existing rows are preserved.</p>
          {loading && <p role="status" className="text-sm">Loading Google Sheets…</p>}
          {!loading && !files.length && !error && <p className="text-sm">No spreadsheets found.</p>}
          <button type="button" className={control} onClick={() => setRetry((n) => n + 1)}>Reload sheets</button>
        </>}
      </fieldset>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}{createdId && " The spreadsheet was created; retrying will reuse it."}</p>}
      {link && <p role="status" className="mt-3 text-sm">Outcomes synced. <a className="text-accent underline" href={link} target="_blank" rel="noreferrer">Open Google Sheet</a></p>}
      <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} className={control} onClick={onClose}>{link ? "Done" : "Cancel"}</button>{!link && <button disabled={busy || loading || !rows.length || (mode === "existing" && !tab) || (mode === "new" && !name.trim())} className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? "Syncing…" : mode === "new" ? "Create and Sync" : "Sync to Sheet"}</button>}</div>
    </form>
  </dialog>;
}
