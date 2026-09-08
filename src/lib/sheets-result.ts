// Normalize known connector envelopes without treating failed actions as success.
export function sheetsResult(response: { ok?: boolean; error?: unknown; result?: any }) {
  if (response.ok !== true) throw new Error(typeof response.error === "string" ? response.error : "Google Sheets did not confirm the operation.");
  let result = response.result;
  for (let depth = 0; depth < 8; depth++) {
    if (!result || typeof result !== "object") throw new Error("Google Sheets returned no result.");
    if (result.successful === false || result.success === false || result.error) {
      throw new Error(typeof result.error === "string" ? result.error : result.error?.message || "Google Sheets did not confirm the operation.");
    }
    const nested = result.response_data ?? result.data ?? result.spreadsheet;
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) return result;
    result = nested;
  }
  throw new Error("Google Sheets returned an unsupported response.");
}

export function spreadsheetId(result: Record<string, unknown>): string {
  const id = result.spreadsheetId ?? result.spreadsheet_id ?? result.id;
  if (typeof id === "string" && /^[\w-]+$/.test(id)) return id;
  const link = result.spreadsheetUrl ?? result.spreadsheet_url ?? result.url;
  if (typeof link === "string") {
    try {
      const url = new URL(link);
      if (url.protocol === "https:" && url.hostname === "docs.google.com") return url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)(?:\/|$)/)?.[1] ?? "";
    } catch { /* Not a spreadsheet URL. */ }
  }
  return "";
}
