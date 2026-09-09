type Execute = (tool: string, args: Record<string, unknown>) => Promise<any>;
export async function writeNewSheet(execute: Execute, id: string, values: unknown[][]) {
  try {
    return await execute("VALUES_UPDATE", { spreadsheet_id: id, range: "A1", values, value_input_option: "RAW" });
  } catch (error) {
    // A missing action has not performed a write. Never retry an uncertain write.
    if (!/Tool GOOGLESHEETS_VALUES_UPDATE not found/i.test((error as Error).message)) throw error;
    const info = await execute("GET_SPREADSHEET_INFO", { spreadsheet_id: id });
    const title = info?.sheets?.[0]?.properties?.title;
    if (!title) throw new Error("Cannot determine the new spreadsheet’s worksheet name.");
    return execute("BATCH_UPDATE", { spreadsheet_id: id, sheet_name: title, first_cell_location: "A1", values, value_input_option: "RAW" });
  }
}
export function confirmedSheetWrite(result: any): boolean {
  return result?.updatedCells > 0 || result?.updates?.updatedCells > 0 || result?.totalUpdatedCells > 0 || result?.responses?.some((response: any) => response.updatedCells > 0) === true;
}
