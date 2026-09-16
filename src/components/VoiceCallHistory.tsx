import { useState } from "react";
import { Clock, Phone, Search } from "lucide-react";
import { formatClock, formatDayMonth, type LiveCall, type Row } from "@/lib/ultravox-calls";

const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[ _-]+/g, "");

function secondsOf(row: Row, live: LiveCall | undefined): number | null {
  if (live?.durationSeconds != null) return live.durationSeconds;
  const match = String(row.Duration ?? "").match(/([\d.]+)\s*s/i);
  return match ? Math.round(Number(match[1])) : null;
}

function pillClass(status: string): string {
  switch (normalize(status)) {
    case "live":
    case "inprogress":
      return "bg-success/15 text-success";
    case "voicemail":
      return "bg-amber-500/15 text-amber-300";
    case "failed":
    case "noanswer":
    case "busy":
      return "bg-danger/15 text-danger";
    default:
      // Neutral grey from the UI theme (adapts to dark/light skins).
      return "bg-control text-ink-secondary";
  }
}

function iconClass(status: string): string {
  switch (normalize(status)) {
    case "live":
    case "inprogress":
      return "bg-success/15 text-success";
    case "voicemail":
      return "bg-amber-500/15 text-amber-300";
    case "failed":
    case "noanswer":
    case "busy":
      return "bg-danger/15 text-danger";
    default:
      // Theme ink: white icon in dark theme, black icon in light theme.
      return "bg-control text-ink";
  }
}

export function VoiceCallHistory({ rows, rawRows, liveByIndex, demoStart, onSelect }: {
  rows: Row[];
  rawRows: Row[];
  liveByIndex: Record<number, LiveCall>;
  /** Index where appended browser-demo items begin (-1 when none). */
  demoStart?: number;
  onSelect: (index: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All Results");
  const query = search.trim().toLowerCase();
  const digits = query.replace(/\D/g, "");

  const indexed = rows.map((row, index) => ({ row, index }));
  const resultOptions = ["All Results", ...new Set(rows.map((row) => String(row.Result ?? "")).filter(Boolean))];
  const filtered = indexed.filter(({ row }) =>
    (filter === "All Results" || normalize(row.Result) === normalize(filter)) &&
    (!query || Object.values(row).some((value) =>
      String(value ?? "").toLowerCase().includes(query) ||
      (digits.length > 0 && /^[+\d\s().-]+$/.test(query) && String(value ?? "").replace(/\D/g, "").includes(digits)))),
  );

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-hairline/50 bg-inset px-3 py-2.5 text-ink-secondary focus-within:border-accent">
          <Search size={17} aria-hidden="true" />
          <input
            aria-label="Search call history"
            placeholder="Search outcomes..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-secondary"
          />
        </label>
        <select
          aria-label="Filter calls by result"
          className="shrink-0 rounded-lg border border-hairline/50 bg-inset px-3 py-2.5 text-[13px] text-ink sm:w-36"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          {resultOptions.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>

      {filtered.length === 0 && <p className="text-sm text-ink-secondary">No outcomes match this filter.</p>}

      <div className="space-y-3">
        {filtered.map(({ row, index }) => {
          const showDivider = demoStart != null && demoStart >= 0 && index === demoStart;
          const raw = (rawRows[index] ?? {}) as Row;
          const live = liveByIndex[index];
          const result = String(row.Result ?? "—");
          const seconds = secondsOf(row, live);
          const agents = raw.agents && typeof raw.agents === "object" ? (raw.agents as Row) : null;
          const direction = [raw.direction, raw.call_direction, raw.call_type]
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .find(Boolean) || "Outbound";
          const at = raw.started_at ?? raw.created_at ?? null;
          const contact = live?.to || String(row.Contact ?? "—");
          const showContact = contact && contact !== "—";
          return (
            <div key={index} className="space-y-3">
              {showDivider && (
                <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
                  Browser demo calls
                </p>
              )}
            <button
              type="button"
              onClick={() => onSelect(index)}
              className="w-full rounded-2xl border border-hairline/40 bg-panel p-4 text-left shadow-sm transition-colors hover:bg-raised/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`flex size-11 shrink-0 items-center justify-center rounded-full ${iconClass(result)}`}>
                    <Phone size={18} />
                  </span>
                  <div className="min-w-0">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${pillClass(result)}`}>
                      {(normalize(result) === "live" || normalize(result) === "inprogress") && (
                        <span className="size-1.5 animate-pulse rounded-full bg-success" />
                      )}
                      {result}
                    </span>
                    <div className="mt-1.5 truncate text-[12.5px] text-ink-secondary">
                      {direction}
                      <span className="mx-1.5">·</span>
                      {String(row.Agent ?? agents?.name ?? "—")}
                      {showContact && (
                        <>
                          <span className="mx-1.5">·</span>
                          <span className="tabular-nums text-ink">{contact}</span>
                        </>
                      )}
                      <span className="mx-1.5">·</span>
                      <span className="inline-block rounded-full border border-hairline/50 px-2 py-px text-[11px] font-medium text-ink">Transcript</span>
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[15px] font-semibold tabular-nums text-ink">
                    {seconds != null ? formatClock(seconds) : "—"}
                  </div>
                  <div className="mt-1.5 flex items-center justify-end gap-1 text-[12px] text-ink-secondary">
                    <Clock size={12} />
                    {formatDayMonth(at) || "—"}
                  </div>
                </div>
              </div>
            </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
