type Row = Record<string, unknown>;

/** One (campaign, result) bucket from /api/call-outcomes/summary. */
export type OutcomeCount = { campaign_id: string; outcome: string; count: number };

export type OutcomeCounts = {
  /** Calls recorded for the campaign — one row per dial, so attempts add up. */
  total: number;
  /** The callee is on the line right now. */
  live: number;
  completed: number;
  voicemail: number;
  noAnswer: number;
  busy: number;
  rejected: number;
  failed: number;
  /** Dialled, no result back yet. */
  pending: number;
};

export type OutcomeTone = "live" | "positive" | "voicemail" | "warning" | "danger" | "neutral";
export type OutcomeStatus = { label: string; tone: OutcomeTone };

const normalize = (value: unknown) => String(value ?? "").trim().toUpperCase().replace(/[ _-]+/g, "_");

/**
 * What a stored result reads as. The platform writes provider truth in upper
 * case (PENDING, IN_PROGRESS, COMPLETED, VOICEMAIL, NO_ANSWER, BUSY, REJECTED,
 * CANCELED, FAILED) and older rows may hold anything, so the fallback keeps the
 * raw value rather than hiding it.
 */
export function outcomeStatus(value: unknown): OutcomeStatus {
  switch (normalize(value)) {
    case "IN_PROGRESS":
    case "ANSWERED":
      return { label: "Live", tone: "live" };
    case "COMPLETED":
      return { label: "Completed", tone: "positive" };
    case "VOICEMAIL":
      return { label: "Voicemail", tone: "voicemail" };
    case "NO_ANSWER":
      return { label: "No answer", tone: "warning" };
    case "BUSY":
      return { label: "Busy", tone: "warning" };
    case "REJECTED":
      return { label: "Rejected", tone: "danger" };
    case "CANCELED":
    case "CANCELLED":
      return { label: "Canceled", tone: "danger" };
    case "FAILED":
      return { label: "Failed", tone: "danger" };
    case "PENDING":
      return { label: "Pending", tone: "neutral" };
    default: {
      // An unmapped value still reads as a sentence rather than shouting in caps.
      const raw = String(value ?? "").trim().replace(/[_-]+/g, " ").toLowerCase();
      return { label: raw ? raw[0].toUpperCase() + raw.slice(1) : "Unknown", tone: "neutral" };
    }
  }
}

const emptyCounts = (): OutcomeCounts => ({
  total: 0,
  live: 0,
  completed: 0,
  voicemail: 0,
  noAnswer: 0,
  busy: 0,
  rejected: 0,
  failed: 0,
  pending: 0,
});

/** Tally one campaign's results, so a campaign reads as a single outcome. */
export function outcomeCountsFor(rows: OutcomeCount[], campaignId: string): OutcomeCounts {
  const counts = emptyCounts();
  for (const row of rows) {
    if (!row || String(row.campaign_id) !== String(campaignId)) continue;
    const count = Math.max(0, Number(row.count ?? 0));
    if (!count) continue;
    counts.total += count;
    switch (normalize(row.outcome)) {
      case "IN_PROGRESS":
      case "ANSWERED":
        counts.live += count;
        break;
      case "COMPLETED":
        counts.completed += count;
        break;
      case "VOICEMAIL":
        counts.voicemail += count;
        break;
      case "NO_ANSWER":
        counts.noAnswer += count;
        break;
      case "BUSY":
        counts.busy += count;
        break;
      case "REJECTED":
      case "CANCELED":
      case "CANCELLED":
        counts.rejected += count;
        break;
      case "PENDING":
        counts.pending += count;
        break;
      default:
        counts.failed += count;
        break;
    }
  }
  return counts;
}

/** Calls the campaign has finished with: everything but the ones still ringing. */
export function processedCount(counts: OutcomeCounts): number {
  return Math.max(0, counts.total - counts.pending);
}

export function processedPercent(counts: OutcomeCounts): number {
  return counts.total ? Math.round((processedCount(counts) / counts.total) * 100) : 0;
}

/**
 * "42 completed · 5 voicemail · 2 live · 1 pending" — zero buckets stay out of
 * the line, and a campaign with nothing recorded says so.
 */
export function outcomeBreakdown(counts: OutcomeCounts): string {
  const parts: string[] = [];
  const add = (count: number, label: string) => {
    if (count > 0) parts.push(`${count} ${label}`);
  };
  add(counts.completed, "completed");
  add(counts.voicemail, "voicemail");
  add(counts.live, "live");
  add(counts.noAnswer, "no answer");
  add(counts.busy, "busy");
  add(counts.rejected, "rejected");
  add(counts.failed, "failed");
  add(counts.pending, "pending");
  return parts.length ? parts.join(" · ") : "No calls yet";
}

/** The campaign list only needs the summary rows it will actually render. */
export function summaryRows(data: unknown): OutcomeCount[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((row): row is Row => Boolean(row) && typeof row === "object")
    .map((row) => ({
      campaign_id: String(row.campaign_id ?? ""),
      outcome: String(row.outcome ?? ""),
      count: Number(row.count ?? 0),
    }))
    .filter((row) => row.campaign_id && row.count > 0);
}
