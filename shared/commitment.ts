export type CommitmentDirection = "mine" | "theirs";
export type CommitmentKind = "promise" | "request" | "follow-up";

export interface CommitmentSuggestion {
  direction: CommitmentDirection;
  kind: CommitmentKind;
  text: string;
  confidence: number;
  suggestedDueAt: number | null;
}

const DAY = 86_400_000;

export function normalizeCommitmentText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 1_000);
}

function suggestedDue(text: string, now: number, fallbackDays: number): number {
  if (/\b(?:today|tonight|asap|as soon as possible)\b/i.test(text)) return now + 8 * 60 * 60 * 1_000;
  if (/\btomorrow\b/i.test(text)) return now + DAY;
  return now + fallbackDays * DAY;
}

/**
 * Conservative extraction from a single WhatsApp message. The result is only
 * a suggestion; it cannot enter Today or trigger a message until reviewed.
 */
export function extractCommitmentSuggestion(message: unknown, fromMe: boolean, now = Date.now()): CommitmentSuggestion | null {
  const text = normalizeCommitmentText(message);
  if (!text || text.length < 5 || /\b(?:maybe|might|not sure|spam|unsubscribe)\b/i.test(text)) return null;

  if (fromMe && /\b(?:i(?:'ll| will)|let me|i promise|i can send|i can share|i can get back)\b/i.test(text)) {
    return { direction: "mine", kind: "promise", text, confidence: 0.86, suggestedDueAt: suggestedDue(text, now, 1) };
  }
  if (!fromMe && /^(?:please\s+)?(?:can|could|would|will)\s+you\b|\bplease\s+(?:send|share|call|check|confirm|review|book|pay|remind|follow up)\b/i.test(text)) {
    return { direction: "mine", kind: "request", text, confidence: 0.8, suggestedDueAt: suggestedDue(text, now, 1) };
  }
  if (!fromMe && /\b(?:i(?:'ll| will)|let me|i promise|i can send|i can share|i can get back)\b/i.test(text)) {
    return { direction: "theirs", kind: "promise", text, confidence: 0.78, suggestedDueAt: suggestedDue(text, now, 3) };
  }
  if (!fromMe && /\b(?:following up|just checking|any update|checking in)\b/i.test(text)) {
    return { direction: "mine", kind: "follow-up", text, confidence: 0.72, suggestedDueAt: suggestedDue(text, now, 1) };
  }
  return null;
}

export function normalizeCommitmentDueAt(value: unknown): number | null {
  if (value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}
