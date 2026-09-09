import { describe, expect, it } from "vitest";
import { sheetsResult, spreadsheetId } from "./sheets-result";
describe("Sheets connector confirmation", () => {
  it("rejects failed or unconfirmed responses even if they contain a link", () => {
    expect(() => sheetsResult({ ok: false, error: "Permission denied", result: { spreadsheetId: "example" } })).toThrow("Permission denied");
    expect(() => sheetsResult({ ok: true, result: { successful: false } })).toThrow();
    expect(() => sheetsResult({ ok: true })).toThrow();
  });
  it("unwraps confirmed results without generating IDs or write counts", () => {
    expect(sheetsResult({ ok: true, result: { data: { updatedCells: 24 }, successful: true } })).toEqual({ updatedCells: 24 });
    expect(sheetsResult({ ok: true, result: { files: [] } })).toEqual({ files: [] });
  });
});

it("reads spreadsheet IDs through nested connector envelopes", () => {
  const result = sheetsResult({ ok: true, result: { successful: true, data: { response_data: { spreadsheetId: "sheet_123" } } } });
  expect(spreadsheetId(result)).toBe("sheet_123");
  expect(spreadsheetId({ spreadsheet_url: "https://docs.google.com/spreadsheets/d/sheet_456/edit" })).toBe("sheet_456");
  expect(spreadsheetId({ url: "https://example.com/spreadsheets/d/fake/edit" })).toBe("");
});
it("rejects nested failures and unwraps write confirmations", () => {
  expect(() => sheetsResult({ ok: true, result: { data: { successful: false, error: "Denied" } } })).toThrow("Denied");
  expect(sheetsResult({ ok: true, result: { response_data: { updatedCells: 12 } } })).toEqual({ updatedCells: 12 });
});
