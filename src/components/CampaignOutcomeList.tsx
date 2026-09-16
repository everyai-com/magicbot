import { useMemo } from "react";
import { MoreHorizontal } from "lucide-react";
import { campaignRuns, type OutcomeCount } from "@/lib/campaign-outcome-summary";

type Row = Record<string, unknown>;

type Card = { campaign: Row; id: string; title: string; agent: string; attempt: number };

/**
 * The Outcomes list: one card per campaign run, labelled with the campaign and
 * the bot that dialled it. Starting a campaign again dials a new run, and that
 * run gets its own card rather than replacing the first one — opening a card
 * shows what that run did.
 */
export function CampaignOutcomeList({
  campaigns, summary, agents = [], emptyMessage, onOpen, onRename, onDelete, menu, menuRef, onMenu,
}: {
  campaigns: Row[];
  summary: OutcomeCount[];
  agents?: Row[];
  emptyMessage?: string;
  onOpen: (campaign: Row, attempt: number) => void;
  onRename?: (campaign: Row) => void;
  onDelete?: (campaign: Row) => void;
  menu?: string | null;
  menuRef?: React.RefObject<HTMLDivElement | null>;
  onMenu?: (id: string | null) => void;
}) {
  const agentNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const agent of agents) names.set(String(agent.id ?? agent._id ?? ""), String(agent.name ?? ""));
    return names;
  }, [agents]);

  const cards = useMemo(() => campaigns.flatMap<Card>((campaign) => {
    const id = String(campaign.id ?? campaign._id ?? "");
    const title = String(campaign.name ?? campaign.venue_name ?? id);
    const agent = agentNames.get(String(campaign.agent_id ?? "")) || "Workspace AI";
    const runs = campaignRuns(summary, id);
    // Never dialled: one card, waiting for its first run.
    if (!runs.length) return [{ campaign, id, title, agent, attempt: Number(campaign.round ?? 1) || 1 }];
    return runs.map((run) => ({ campaign, id, title, agent, attempt: run.attempt }));
  }), [campaigns, summary, agentNames]);

  if (!cards.length) {
    return <p className="text-sm text-ink-secondary">{emptyMessage ?? "No campaigns yet."}</p>;
  }

  return <div className="grid gap-2 sm:grid-cols-2">
    {cards.map(({ campaign, id, title, agent, attempt }) => (
      <div key={`${id}:${attempt}`} className="relative flex min-h-20 min-w-0 items-center rounded-lg border border-hairline/40 bg-inset transition-colors hover:border-hairline/70">
        <button type="button" onClick={() => onOpen(campaign, attempt)}
          className="min-w-0 flex-1 rounded-lg px-3 py-4 text-left focus-visible:outline-2 focus-visible:outline-accent">
          <span className="block break-words text-[13px] font-medium text-ink">{title}</span>
          <span className="mt-0.5 block break-words text-[12px] text-ink-secondary">{agent}</span>
        </button>
        {(onRename || onDelete) && <div ref={menu === id ? menuRef : undefined} className="relative mr-2 shrink-0"
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onMenu?.(null); } }}>
          <button type="button" aria-label={`Actions for ${title}`} aria-expanded={menu === id} className="rounded-md p-2 text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => onMenu?.(menu === id ? null : id)}><MoreHorizontal size={18} /></button>
          {menu === id && <div className="absolute right-0 top-full z-20 mt-1 flex min-w-32 flex-col rounded-lg border border-hairline/50 bg-panel p-1 shadow-xl">
            {onRename && <button type="button" className="rounded px-3 py-2 text-left text-sm hover:bg-control" onClick={() => { onMenu?.(null); onRename(campaign); }}>Edit</button>}
            {onDelete && <button type="button" className="rounded px-3 py-2 text-left text-sm text-danger hover:bg-control" onClick={() => { onMenu?.(null); onDelete(campaign); }}>Delete</button>}
          </div>}
        </div>}
      </div>
    ))}
  </div>;
}
