import { describe, expect, it } from "vitest";
import { isReadOnlyConnectorTool, nextConnectorSyncAt, normalizeConnectorSyncMinutes } from "../../shared/connector-snapshot";

describe("connector snapshots", () => {
  it("only permits explicitly read-only connector tools", () => {
    expect(isReadOnlyConnectorTool("GMAIL_LIST_EMAILS")).toBe(true);
    expect(isReadOnlyConnectorTool("GOOGLECALENDAR_SEARCH_EVENTS")).toBe(true);
    expect(isReadOnlyConnectorTool("GMAIL_SEND_EMAIL")).toBe(false);
    expect(isReadOnlyConnectorTool("DELETE_EVENT")).toBe(false);
    expect(isReadOnlyConnectorTool("GMAIL_GET_AND_DELETE_EMAIL")).toBe(false);
  });

  it("normalizes refresh intervals to the supported bounded set", () => {
    expect(normalizeConnectorSyncMinutes(15)).toBe(15);
    expect(normalizeConnectorSyncMinutes("360")).toBe(360);
    expect(normalizeConnectorSyncMinutes(1)).toBe(60);
    expect(normalizeConnectorSyncMinutes(Number.NaN)).toBe(60);
  });

  it("computes the next refresh from a completed sync", () => {
    expect(nextConnectorSyncAt(1_000, 30)).toBe(1_801_000);
  });
});
