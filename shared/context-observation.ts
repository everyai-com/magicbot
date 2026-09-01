export type ObservationKind = "preference" | "relationship" | "profile" | "habit";

export interface ContextObservationCandidate {
  kind: ObservationKind;
  text: string;
  normalizedText: string;
  confidence: number;
}

const MAX_TEXT = 500;

export function normalizeObservationText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

export function observationKey(value: unknown): string {
  return normalizeObservationText(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Conservative, deterministic extraction for statements that are useful but
 * were not explicitly offered as durable memory. These remain quarantined in
 * the review inbox; they never enter prompt context until the user accepts or
 * corrects them.
 */
export function extractContextObservations(message: unknown): ContextObservationCandidate[] {
  const text = normalizeObservationText(message);
  if (!text || /\b(?:remember(?: that)?|save this|store this|my preference is|i prefer|always use)\b/i.test(text)) return [];

  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map(normalizeObservationText).filter(Boolean);
  const results: ContextObservationCandidate[] = [];
  for (const sentence of sentences) {
    let kind: ObservationKind | null = null;
    let confidence = 0.72;
    if (/\b(?:is my|are my)\s+(?:friend|partner|spouse|wife|husband|manager|boss|colleague|coworker|teammate|client|customer|advisor|adviser|mentor|accountant|sibling|brother|sister|parent|mother|father|assistant|doctor|lawyer)\b/i.test(sentence)
      || /\bi (?:work|collaborate|coordinate) with\b/i.test(sentence)) {
      kind = "relationship";
      confidence = 0.78;
    } else if (/\bi (?:prefer|like|love|dislike|hate|want|don't want|do not want)\b/i.test(sentence)) {
      kind = "preference";
      confidence = 0.76;
    } else if (/\bi (?:usually|normally|typically|always|never)\b/i.test(sentence)) {
      kind = "habit";
      confidence = 0.7;
    } else if (/\bi (?:work (?:at|for|as)|live in|am based in|am a|serve as)\b/i.test(sentence)) {
      kind = "profile";
      confidence = 0.74;
    }
    if (!kind || sentence.length < 6) continue;
    const normalizedText = observationKey(sentence);
    if (!normalizedText || results.some((item) => item.normalizedText === normalizedText)) continue;
    results.push({ kind, text: sentence, normalizedText, confidence });
    if (results.length >= 5) break;
  }
  return results;
}

export function normalizeObservationCorrection(value: unknown): string {
  return normalizeObservationText(value);
}
