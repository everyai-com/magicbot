import { expect, it, vi } from "vitest";
import { writeNewSheet, confirmedSheetWrite } from "./sheets-write";
it("uses the legacy action only when the current action is missing", async () => {
 const execute = vi.fn().mockRejectedValueOnce(new Error("Tool GOOGLESHEETS_VALUES_UPDATE not found")).mockResolvedValueOnce({ sheets: [{ properties: { title: "Foglio1" } }] }).mockResolvedValueOnce({ totalUpdatedCells: 2 });
 const result = await writeNewSheet(execute, "sheet-id", [["Name"], ["=literal"]]);
 expect(execute.mock.calls[2]).toEqual(["BATCH_UPDATE", { spreadsheet_id: "sheet-id", sheet_name: "Foglio1", first_cell_location: "A1", values: [["Name"], ["=literal"]], value_input_option: "RAW" }]);
 expect(confirmedSheetWrite(result)).toBe(true);
});
it("does not retry uncertain writes", async () => {
 const execute = vi.fn().mockRejectedValue(new Error("Request timed out"));
 await expect(writeNewSheet(execute, "sheet-id", [[1]])).rejects.toThrow("timed out");
 expect(execute).toHaveBeenCalledTimes(1);
 expect(confirmedSheetWrite({})).toBe(false);
});
