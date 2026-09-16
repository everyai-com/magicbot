import { api } from "@/state/store";
import {
  extractCallId,
  extractPlatformAgentId,
  extractRowTime,
  normalizeLiveCall,
  type LiveCall,
} from "./ultravox-calls";

type Row = Record<string, unknown>;

/**
 * Resolve one platform row to its live provider call: direct id first, then
 * time-proximity matching through the server.
 *
 * Shared by the call history and the campaign outcomes so a call opens the same
 * way — recording, transcript and summary all come from this one provider read.
 */
export async function resolveLiveCall(raw: Row): Promise<LiveCall | null> {
  const callId = extractCallId(raw);
  if (callId) {
    try {
      const data = await api(`/api/ultravox/calls/${encodeURIComponent(callId)}`);
      if (data && typeof data.call === "object" && data.call) {
        return normalizeLiveCall(data.call as Row);
      }
    } catch {
      // Fall through to time-proximity matching below.
    }
  }
  const platformAgentId = extractPlatformAgentId(raw);
  const at = extractRowTime(raw);
  if (!platformAgentId || !at) return null;
  const data = await api("/api/ultravox/match-calls", {
    method: "POST",
    body: JSON.stringify({ items: [{ key: "r", platformAgentId, at }] }),
  });
  const found = Array.isArray(data?.results) ? data.results[0] : null;
  if (found && found.matched && found.call && typeof found.call === "object") {
    return normalizeLiveCall(found.call as Row);
  }
  return null;
}
