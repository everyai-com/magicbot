export type DecisionStatus = "exploring" | "decided" | "revisit" | "archived";
export interface DecisionInput {
  question: string; options: string[]; assumptions: string[]; counterCase: string;
  choice: string; rationale: string; confidence: number | null; reviewAt: number | null; status: DecisionStatus;
}
const cleanText = (value: unknown, limit: number) => typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, limit) : "";
const cleanList = (value: unknown, limit: number) => Array.isArray(value) ? [...new Set(value.map((item) => cleanText(item, 500)).filter(Boolean))].slice(0, limit) : [];
export function normalizeDecision(value: unknown): DecisionInput {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawConfidence = record.confidence === null || record.confidence === undefined || record.confidence === "" ? null : Number(record.confidence);
  const confidence = rawConfidence !== null && Number.isFinite(rawConfidence) ? Math.max(0, Math.min(100, Math.round(rawConfidence))) : null;
  const rawReview = record.reviewAt === null || record.reviewAt === undefined || record.reviewAt === "" ? null : Number(record.reviewAt);
  const reviewAt = rawReview !== null && Number.isSafeInteger(rawReview) && rawReview > 0 ? rawReview : null;
  const requested = record.status;
  const status: DecisionStatus = requested === "decided" || requested === "revisit" || requested === "archived" ? requested : "exploring";
  return { question: cleanText(record.question, 500), options: cleanList(record.options, 12), assumptions: cleanList(record.assumptions, 12), counterCase: cleanText(record.counterCase, 8_000), choice: cleanText(record.choice, 1_000), rationale: cleanText(record.rationale, 8_000), confidence, reviewAt, status };
}
export function renderDecisionContext(decisions: Array<DecisionInput & { decidedAt?: number | null }>): string {
  const blocks = decisions.filter((item) => item.status === "decided" || item.status === "revisit").slice(0, 8).map((item) => {
    const parts = [`Decision: ${item.question}`, `Choice: ${item.choice}`];
    if (item.rationale) parts.push(`Why: ${item.rationale}`);
    if (item.confidence !== null) parts.push(`Confidence: ${item.confidence}%`);
    if (item.reviewAt) parts.push(`Review after: ${new Date(item.reviewAt).toISOString().slice(0, 10)}`);
    return parts.join("\n");
  });
  return blocks.length ? `Decision journal\n\n${blocks.join("\n\n")}`.slice(0, 8_000) : "";
}
export function challengePrompt(input: Pick<DecisionInput, "question" | "options" | "assumptions" | "choice" | "rationale">): string {
  return `Act as an independent red-team advisor. Steel-man the strongest case against the leading choice. Do not use tools and do not merely list generic risks.\n\nQuestion: ${input.question}\nOptions:\n${input.options.map((item) => `- ${item}`).join("\n")}\nLeading choice: ${input.choice || "Not chosen yet"}\nCurrent rationale: ${input.rationale || "Not recorded"}\nAssumptions:\n${input.assumptions.map((item) => `- ${item}`).join("\n")}\n\nReturn four concise sections: Strongest opposing case; Fragile assumptions; Evidence to seek; What would reverse the decision.`.slice(0, 12_000);
}
