import { outcomeStatus, type OutcomeTone } from "@/lib/campaign-outcome-summary";

/** One look per result, shared by the outcomes table and the call detail so a
 *  call reads the same wherever it appears. */
const toneClass = {
  live: "bg-success/15 text-success",
  positive: "bg-success/15 text-success",
  voicemail: "bg-accent/15 text-accent",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  neutral: "bg-control text-ink-secondary",
} satisfies Record<OutcomeTone, string>;

export function ResultPill({ value, className = "" }: { value: unknown; className?: string }) {
  const status = outcomeStatus(value);
  return <span className={"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium " + toneClass[status.tone] + (className ? " " + className : "")}>
    {status.tone === "live" && <span className="size-1.5 animate-pulse rounded-full bg-success" />}{status.label}
  </span>;
}
