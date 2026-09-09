import { createPortal } from "react-dom";
import { OutcomeExport } from "./OutcomeExport";
import { Search, Clock } from "lucide-react";
import { useState } from "react";
type Row = Record<string, unknown>;
export function CampaignOutcomes({ rows, onExport, agentId, campaignName, exportTarget, resultValues, showErrorSummary = true }: { showErrorSummary?: boolean; resultValues?: string[]; exportTarget?: HTMLDivElement | null; rows: Row[]; agentId?: string; campaignName: string; onExport: (rows: Row[]) => void }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All Results");
  const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[ _-]+/g, "");
  const query = search.trim().toLowerCase();
  const digits = query.replace(/\D/g, "");
  const filtered = rows.filter((row, index) => (filter === "All Results" || normalize(resultValues?.[index] ?? row.Result) === normalize(filter)) && (!query || Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(query) || (digits.length > 0 && /^[+\d\s().-]+$/.test(query) && String(value ?? "").replace(/\D/g, "").includes(digits)))));
  const resultOptions = resultValues ? ["All Results", ...new Set(resultValues.filter(Boolean))] : ["All Results", "Answered", "Voicemail", "No Answer", "Failed", "Pending"];
  const columns = [...new Set(rows.flatMap(Object.keys))];
  const [hidden, setHidden] = useState<string[]>([]);
  const shown = columns.filter((column) => !hidden.includes(column));
  const text = (value: unknown) => value == null || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const errors = [...new Set(rows.map((row) => text(row.Error)).filter((value) => value !== "—"))];
  return <div className="min-w-0 space-y-3">
    {showErrorSummary && errors.length > 0 && <div role="alert" className="rounded-lg border border-danger/30 p-3 text-sm text-danger"><p className="font-medium">Delivery errors</p>{errors.map((error) => <p key={error} className="mt-2 whitespace-pre-wrap break-words">{error}</p>)}</div>}
    <div className="flex flex-col gap-3 sm:flex-row">
      <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-hairline/50 bg-inset px-3 py-2.5 text-ink-secondary focus-within:border-accent">
        <Search size={17} aria-hidden="true" /><input aria-label="Search campaign outcomes" placeholder="Search outcomes..." value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-secondary" />
      </label>
      <select aria-label="Filter outcomes by result" className="shrink-0 rounded-lg border border-hairline/50 bg-inset px-3 py-2.5 text-[13px] text-ink sm:w-36" value={filter} onChange={(event) => setFilter(event.target.value)}>{resultOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
    </div>

    <div className="w-full min-w-0 max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xl border border-hairline/40 bg-panel/30" tabIndex={0} role="region" aria-label="Scrollable campaign outcomes"><table className="w-max min-w-full text-left text-[13px]">
      <caption className="sr-only">Campaign outcomes and configured contact fields</caption>
      <thead className="border-b border-hairline/40 text-ink-secondary"><tr>{shown.map((key) => <th key={key} className="whitespace-nowrap px-4 py-3.5 font-medium">{key}</th>)}</tr></thead>
      <tbody>{filtered.map((row, i) => <tr key={i} className="border-b border-hairline/30 last:border-0">{shown.map((key) => <td key={key} className="whitespace-nowrap px-4 py-5 align-top">{key === "Result" ? <span className={"inline-block rounded-full px-2.5 py-1 text-xs font-medium " + (normalize(row[key]) === "voicemail" ? "bg-accent/15 text-accent" : normalize(row[key]) === "answered" ? "bg-success/15 text-success" : normalize(row[key]) === "failed" ? "bg-danger/15 text-danger" : "bg-control text-ink-secondary")}>{text(row[key])}</span> : (key === "Transcript" || key === "AI Summary" || key === "Error") && row[key] ? <details><summary className="cursor-pointer text-accent">View</summary><p className="mt-2 max-w-sm whitespace-pre-wrap break-words">{text(row[key])}</p></details> : key === "Duration" && row[key] != null ? <span className="inline-flex items-center gap-1.5"><Clock size={13} className="text-ink-secondary" />{text(row[key])}</span> : key === "Contact" ? <span className="font-medium">{text(row[key])}</span> : text(row[key])}</td>)}</tr>)}</tbody>
    </table></div>
    {!filtered.length && <p className="text-sm text-ink-secondary">No outcomes match this filter.</p>}
    <details className="text-xs text-ink-secondary"><summary className="cursor-pointer">Visible columns</summary><div className="mt-2 flex flex-wrap gap-3">{columns.map((column) => <label key={column} className="flex items-center gap-1"><input type="checkbox" checked={!hidden.includes(column)} onChange={(e) => setHidden((old) => e.target.checked ? old.filter((key) => key !== column) : [...old, column])} />{column}</label>)}</div></details>
    {exportTarget && createPortal(<OutcomeExport rows={filtered} agentId={agentId} campaignName={campaignName} onCsv={() => onExport(filtered)} />, exportTarget)}
  </div>;
}
