export const CONNECTOR_SYNC_MINUTES = [15, 30, 60, 360, 1440] as const;

export function normalizeConnectorSyncMinutes(value: unknown): number {
  const numeric = Number(value);
  return CONNECTOR_SYNC_MINUTES.includes(numeric as (typeof CONNECTOR_SYNC_MINUTES)[number]) ? numeric : 60;
}

export function nextConnectorSyncAt(lastSyncedAt: number, intervalMinutes: unknown): number {
  return lastSyncedAt + normalizeConnectorSyncMinutes(intervalMinutes) * 60_000;
}

export function isReadOnlyConnectorTool(name: unknown): name is string {
  if (typeof name !== "string") return false;
  if (/(^|_)(SEND|CREATE|UPDATE|DELETE|REMOVE|WRITE|POST|PUT|PATCH|REPLY|FORWARD|MOVE|MODIFY|ADD|UPLOAD)(_|$)/i.test(name)) return false;
  return /(^|_)(GET|LIST|SEARCH|FETCH|READ)(_|$)/i.test(name);
}
