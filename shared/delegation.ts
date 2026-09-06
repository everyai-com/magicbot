export type DelegationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface DelegationInput {
  sourceBotId: string | null;
  targetBotId: string;
  task: string;
  context: string;
  expectedOutput: string;
}

const clean = (value: unknown, max: number): string => typeof value === "string"
  ? value.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim().slice(0, max)
  : "";

export function normalizeDelegationInput(value: unknown): DelegationInput {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    sourceBotId: clean(raw.sourceBotId, 100) || null,
    targetBotId: clean(raw.targetBotId, 100),
    task: clean(raw.task, 4_000),
    context: clean(raw.context, 6_000),
    expectedOutput: clean(raw.expectedOutput, 1_000),
  };
}

export function delegationPrompt(input: Pick<DelegationInput, "task" | "context" | "expectedOutput">, sourceName: string): string {
  return [
    `Delegated by: ${clean(sourceName, 80) || "the user"}`,
    `Assignment:\n${input.task}`,
    input.context ? `Bounded handoff context:\n${input.context}` : "",
    input.expectedOutput ? `Expected output:\n${input.expectedOutput}` : "",
    "Complete this assignment independently. Use only the minimum necessary tools. External or destructive actions remain approval-gated. Return the result, evidence, unresolved risks, and recommended next step.",
  ].filter(Boolean).join("\n\n").slice(0, 12_000);
}

export interface DelegationMarker { targetName: string; task: string }
const DELEGATION_MARKER = /\[DELEGATE:\s*([^|\]\n]{1,80})\s*\|\s*([^\]]{1,4000})\]/i;

/** A reply may request at most one handoff. Additional text remains the
 * coordinator's user-visible explanation; the control marker is never shown. */
export function parseDelegationMarker(value: string): DelegationMarker | null {
  const match = value.match(DELEGATION_MARKER);
  if (!match) return null;
  const targetName = clean(match[1], 80).replace(/\s+/g, " ");
  const task = clean(match[2], 4_000);
  return targetName && task ? { targetName, task } : null;
}

export function stripDelegationMarker(value: string): string {
  return value.replace(DELEGATION_MARKER, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function parseDelegationCommand(value: string): DelegationMarker | null {
  const match = value.trim().match(/^\/delegate\s+([^|\n]{1,80})\s*\|\s*([\s\S]{1,4000})$/i);
  if (!match) return null;
  const targetName = clean(match[1], 80).replace(/\s+/g, " ");
  const task = clean(match[2], 4_000);
  return targetName && task ? { targetName, task } : null;
}
