import { expect, it } from "vitest";
import {
  campaignRuns,
  outcomeBreakdown,
  outcomeCountsFor,
  outcomeStatus,
  processedPercent,
  runMoment,
  summaryRows,
} from "./campaign-outcome-summary";

it("reads the platform's results, including the live one", () => {
  expect(outcomeStatus("PENDING")).toEqual({ label: "Pending", tone: "neutral" });
  expect(outcomeStatus("IN_PROGRESS")).toEqual({ label: "Live", tone: "live" });
  expect(outcomeStatus("COMPLETED")).toEqual({ label: "Completed", tone: "positive" });
  expect(outcomeStatus("VOICEMAIL")).toEqual({ label: "Voicemail", tone: "voicemail" });
  expect(outcomeStatus("NO_ANSWER")).toEqual({ label: "No answer", tone: "warning" });
  expect(outcomeStatus("BUZZED")).toEqual({ label: "Buzzed", tone: "neutral" });
  expect(outcomeStatus(undefined).label).toBe("Unknown");
});

it("tallies one campaign into a single outcome", () => {
  const rows = summaryRows([
    { campaign_id: "a", outcome: "COMPLETED", count: 42 },
    { campaign_id: "a", outcome: "VOICEMAIL", count: 5 },
    { campaign_id: "a", outcome: "IN_PROGRESS", count: 2 },
    { campaign_id: "a", outcome: "PENDING", count: 1 },
    { campaign_id: "b", outcome: "COMPLETED", count: 40 },
    { campaign_id: "a", outcome: "COMPLETED", count: 0 },
  ]);
  const counts = outcomeCountsFor(rows, "a");
  expect(counts).toMatchObject({ total: 50, completed: 42, voicemail: 5, live: 2, pending: 1 });
  expect(outcomeBreakdown(counts)).toBe("42 completed · 5 voicemail · 2 live · 1 pending");
  expect(processedPercent(counts)).toBe(98);
  expect(outcomeCountsFor(rows, "b")).toMatchObject({ total: 40, completed: 40 });
  expect(outcomeBreakdown(outcomeCountsFor(rows, "nobody"))).toBe("No calls yet");
});

it("counts the outcomes that are not conversations as failures, not successes", () => {
  const counts = outcomeCountsFor(summaryRows([
    { campaign_id: "a", outcome: "NO_ANSWER", count: 3 },
    { campaign_id: "a", outcome: "BUSY", count: 2 },
    { campaign_id: "a", outcome: "REJECTED", count: 1 },
    { campaign_id: "a", outcome: "CANCELED", count: 1 },
    { campaign_id: "a", outcome: "FAILED", count: 1 },
    { campaign_id: "a", outcome: "SOMETHING_NEW", count: 1 },
  ]), "a");
  expect(counts).toMatchObject({ total: 9, completed: 0, noAnswer: 3, busy: 2, rejected: 2, failed: 2, pending: 0 });
  expect(outcomeBreakdown(counts)).toBe("3 no answer · 2 busy · 2 rejected · 2 failed");
});

it("never bars progress on a call that has not been placed", () => {
  const counts = outcomeCountsFor(summaryRows([{ campaign_id: "a", outcome: "PENDING", count: 40 }]), "a");
  expect(processedPercent(counts)).toBe(0);
  expect(processedPercent(outcomeCountsFor(summaryRows([{ campaign_id: "a", outcome: "COMPLETED", count: 40 }]), "a"))).toBe(100);
});

it("survives a summary the platform cannot answer yet", () => {
  expect(summaryRows(undefined)).toEqual([]);
  expect(summaryRows({ error: "Not found" })).toEqual([]);
  expect(summaryRows([{ campaign_id: "", outcome: "COMPLETED", count: 3 }])).toEqual([]);
});

it("gives every run of a campaign its own card, instead of folding it in", () => {
  const rows = summaryRows([
    { campaign_id: "a", attempt_number: 1, outcome: "COMPLETED", count: 50, first_at: 1_000, latest_at: 9_000 },
    { campaign_id: "a", attempt_number: 2, outcome: "COMPLETED", count: 12, first_at: 60_000, latest_at: 61_000 },
    { campaign_id: "a", attempt_number: 2, outcome: "PENDING", count: 28, first_at: 60_000, latest_at: 61_000 },
    { campaign_id: "b", attempt_number: 1, outcome: "VOICEMAIL", count: 3, first_at: 5_000, latest_at: 6_000 },
  ]);
  const runs = campaignRuns(rows, "a");
  expect(runs.map((run) => run.attempt)).toEqual([2, 1]);
  expect(runs[0].counts).toMatchObject({ total: 40, completed: 12, pending: 28 });
  expect(outcomeBreakdown(runs[0].counts)).toBe("12 completed · 28 pending");
  expect(runs[1].counts).toMatchObject({ total: 50, completed: 50 });
  expect(runs[0].firstAt).toBe(60_000);
  expect(runs[1].latestAt).toBe(9_000);
  expect(campaignRuns(rows, "c")).toEqual([]);
});

it("treats a summary without an attempt as the campaign's first run", () => {
  const runs = campaignRuns(summaryRows([{ campaign_id: "a", outcome: "COMPLETED", count: 4 }]), "a");
  expect(runs).toHaveLength(1);
  expect(runs[0].attempt).toBe(1);
  expect(outcomeCountsFor(summaryRows([{ campaign_id: "a", outcome: "COMPLETED", count: 4 }]), "a", 1).total).toBe(4);
});

it("dates a run the way a card needs to tell two runs apart", () => {
  const at = Date.UTC(2026, 8, 16, 15, 20);
  expect(runMoment(at)).toMatch(/16 Sept/);
  expect(runMoment(0)).toBe("");
});
