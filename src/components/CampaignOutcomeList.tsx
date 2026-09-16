import { useMemo } from "react";
import { MoreHorizontal, Phone, MessageSquare, Mail, MessageCircle, ChevronRight } from "lucide-react";
import {
  outcomeBreakdown,
  outcomeCountsFor,
  outcomeStatus,
  processedPercent,
  type OutcomeCount,
} from "@/lib/campaign-outcome-summary";

type Row = Record<string, unknown>;

const icons = {
  voice: Phone, sms: MessageSquare, gmail: Mail, whatsapp: MessageCircle,
} satisfies Record<string, typeof Phone>;

/**
 * The Outcomes list: one row per campaign, each row its own outcome.
 *
 * A campaign of fifty people is one result to read — "50 contacts · 42
 * completed · 5 voicemail · 2 live · 1 pending" — rather than fifty rows of
 * dial attempts. Opening a row shows the per-call detail for that campaign.
 */
export function CampaignOutcomeList({
  channel, campaigns, summary, emptyMessage, onOpen, onRename, onDelete, menu, menuRef, onMenu,
}: {
  channel: string;
  campaigns: Row[];
  summary: OutcomeCount[];
  emptyMessage?: string;
  onOpen: (campaign: Row) => void;
  onRename?: (campaign: Row) => void;
  onDelete?: (campaign: Row) => void;
  menu?: string | null;
  menuRef?: React.RefObject<HTMLDivElement | null>;
  onMenu?: (id: string | null) => void;
}) {
  const rows = useMemo(
    () =>
      campaigns.map((campaign) => {
        const id = String(campaign.id ?? campaign._id ?? "");
        const counts = outcomeCountsFor(summary, id);
        // The campaign's own list size is what the operator recognises; the
        // recorded calls fill the gap while a campaign is still dialling.
        const contacts = Math.max(Number(campaign.total_contacts ?? 0) || 0, counts.total);
        return {
          campaign, id,
          title: String(campaign.name ?? campaign.venue_name ?? id),
          counts, contacts,
          percent: processedPercent(counts),
          breakdown: outcomeBreakdown(counts),
          live: outcomeStatus("IN_PROGRESS"),
        };
      }),
    [campaigns, summary],
  );

  if (!rows.length) {
    return <p className="text-sm text-ink-secondary">{emptyMessage ?? "No campaigns yet."}</p>;
  }

  return <ul className="flex flex-col gap-2">
    {rows.map(({ campaign, id, title, counts, contacts, percent, breakdown, live }) => {
      const Icon = icons[channel as keyof typeof icons] ?? Phone;
      return <li key={id} className="relative flex min-w-0 items-stretch rounded-xl border border-hairline/40 bg-inset transition-colors hover:border-hairline/70">
        <button type="button" onClick={() => onOpen(campaign)} className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-control text-ink"><Icon size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-[15px] font-medium text-ink">{title}</span>
              {counts.live > 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                <span className="size-1.5 animate-pulse rounded-full bg-success" />{live.label}
              </span>}
            </span>
            <span className="mt-1 block text-[13px] text-ink-secondary">{contacts} contact{contacts === 1 ? "" : "s"} · {breakdown}</span>
            <span className="mt-2 flex items-center gap-2">
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-control">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-ink-secondary">{percent}%</span>
            </span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-ink-secondary transition-colors group-hover:text-ink" />
        </button>
        {(onRename || onDelete) && <div ref={menu === id ? menuRef : undefined} className="relative flex shrink-0 items-center pr-2"
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onMenu?.(null); } }}>
          <button type="button" aria-label={`Actions for ${title}`} aria-expanded={menu === id} className="rounded-md p-2 text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => onMenu?.(menu === id ? null : id)}><MoreHorizontal size={18} /></button>
          {menu === id && <div className="absolute right-0 top-full z-20 mt-1 flex min-w-32 flex-col rounded-lg border border-hairline/50 bg-panel p-1 shadow-xl">
            {onRename && <button type="button" className="rounded px-3 py-2 text-left text-sm hover:bg-control" onClick={() => { onMenu?.(null); onRename(campaign); }}>Edit</button>}
            {onDelete && <button type="button" className="rounded px-3 py-2 text-left text-sm text-danger hover:bg-control" onClick={() => { onMenu?.(null); onDelete(campaign); }}>Delete</button>}
          </div>}
        </div>}
      </li>;
    })}
  </ul>;
}
