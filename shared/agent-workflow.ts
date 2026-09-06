export type WorkflowFailurePolicy = "stop" | "continue";
export type WorkflowStatus = "draft" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type WorkflowStepStatus = "pending" | "running" | "reviewing" | "completed" | "failed" | "skipped";

export type WorkflowTriggerKind = "once" | "daily" | "webhook";
export interface WorkflowTriggerInput {
  kind: WorkflowTriggerKind;
  enabled: boolean;
  at: number | null;
  time: string;
  weekdays: number[];
  utcOffsetMinutes: number;
}

export interface WorkflowStepInput {
  id: string;
  targetBotId: string;
  task: string;
  expectedOutput: string;
  acceptanceCriteria: string;
  maxAttempts: number;
  dependsOn: string[];
}

export interface AgentWorkflowInput {
  name: string;
  goal: string;
  coordinatorBotId: string | null;
  failurePolicy: WorkflowFailurePolicy;
  maxAgentRuns: number;
  maxDurationMinutes: number;
  steps: WorkflowStepInput[];
}

const clean = (value: unknown, max: number): string => typeof value === "string"
  ? value.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim().slice(0, max)
  : "";

export function normalizeAgentWorkflow(value: unknown): AgentWorkflowInput {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const sourceSteps = Array.isArray(raw.steps) ? raw.steps.slice(0, 8) : [];
  const steps = sourceSteps.map((entry, index) => {
    const step = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const id = clean(step.id, 80) || `step-${index + 1}`;
    return {
      id,
      targetBotId: clean(step.targetBotId, 100),
      task: clean(step.task, 4_000),
      expectedOutput: clean(step.expectedOutput, 1_000),
      acceptanceCriteria: clean(step.acceptanceCriteria, 2_000),
      maxAttempts: Number.isFinite(Number(step.maxAttempts)) ? Math.max(1, Math.min(3, Math.floor(Number(step.maxAttempts)))) : 2,
      dependsOn: Array.isArray(step.dependsOn)
        ? [...new Set(step.dependsOn.map((item) => clean(item, 80)).filter(Boolean))].slice(0, 7)
        : [],
    };
  });
  const requestedRuns = Number(raw.maxAgentRuns);
  const requestedMinutes = Number(raw.maxDurationMinutes);
  return {
    name: clean(raw.name, 120),
    goal: clean(raw.goal, 4_000),
    coordinatorBotId: clean(raw.coordinatorBotId, 100) || null,
    failurePolicy: raw.failurePolicy === "continue" ? "continue" : "stop",
    maxAgentRuns: Number.isFinite(requestedRuns) ? Math.max(1, Math.min(24, Math.floor(requestedRuns))) : Math.max(1, steps.length + 2),
    maxDurationMinutes: Number.isFinite(requestedMinutes) ? Math.max(1, Math.min(120, Math.floor(requestedMinutes))) : 30,
    steps,
  };
}

export function validateAgentWorkflow(input: AgentWorkflowInput): string | null {
  if (!input.name || !input.goal) return "Name and goal are required";
  if (!input.steps.length) return "Add at least one workflow step";
  if (input.steps.some((step) => !step.id || !step.targetBotId || !step.task)) return "Every step needs an agent and assignment";
  if (input.steps.some((step) => step.acceptanceCriteria && !input.coordinatorBotId)) return "Choose a coordinator to review acceptance criteria";
  const ids = input.steps.map((step) => step.id);
  if (new Set(ids).size !== ids.length) return "Workflow step IDs must be unique";
  const known = new Set(ids);
  if (input.steps.some((step) => step.dependsOn.includes(step.id) || step.dependsOn.some((id) => !known.has(id)))) return "Every dependency must reference another workflow step";
  if (input.maxAgentRuns < input.steps.length) return "The run budget must cover every workflow step";
  const visiting = new Set<string>(); const visited = new Set<string>();
  const dependencies = new Map(input.steps.map((step) => [step.id, step.dependsOn]));
  const cycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) if (cycle(dependency)) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  if (ids.some(cycle)) return "Workflow dependencies cannot contain a cycle";
  return null;
}

export function normalizeWorkflowTrigger(value: unknown): WorkflowTriggerInput {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const kind: WorkflowTriggerKind = raw.kind === "once" || raw.kind === "daily" ? raw.kind : "webhook";
  const at = Number(raw.at);
  const offset = Number(raw.utcOffsetMinutes);
  const weekdays = Array.isArray(raw.weekdays)
    ? [...new Set(raw.weekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
    : [];
  return {
    kind,
    enabled: raw.enabled !== false,
    at: Number.isFinite(at) && at > 0 ? Math.floor(at) : null,
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(clean(raw.time, 5)) ? clean(raw.time, 5) : "09:00",
    weekdays: weekdays.length ? weekdays : [0, 1, 2, 3, 4, 5, 6],
    utcOffsetMinutes: Number.isFinite(offset) ? Math.max(-840, Math.min(840, Math.floor(offset))) : 0,
  };
}

export function validateWorkflowTrigger(input: WorkflowTriggerInput, now = Date.now()): string | null {
  if (input.kind === "once" && (!input.at || input.at <= now)) return "Choose a future date and time";
  if (input.kind === "daily" && !input.weekdays.length) return "Choose at least one weekday";
  return null;
}

export function nextWorkflowTriggerAt(input: WorkflowTriggerInput, after = Date.now()): number | null {
  if (!input.enabled || input.kind === "webhook") return null;
  if (input.kind === "once") return input.at && input.at > after ? input.at : null;
  const [hour, minute] = input.time.split(":").map(Number);
  const localAfter = new Date(after - input.utcOffsetMinutes * 60_000);
  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = new Date(localAfter);
    candidate.setUTCDate(candidate.getUTCDate() + offset);
    candidate.setUTCHours(hour, minute, 0, 0);
    const timestamp = candidate.getTime() + input.utcOffsetMinutes * 60_000;
    if (timestamp > after && input.weekdays.includes(candidate.getUTCDay())) return timestamp;
  }
  return null;
}

export type WorkflowReviewDecision = { verdict: "accept" | "revise"; feedback: string };

export function workflowReviewPrompt(goal: string, step: { targetBotName: string; task: string; expectedOutput: string; acceptanceCriteria: string; result: string | null; attempts: number; maxAttempts: number }): string {
  return [
    "You are the quality reviewer for one step in a multi-agent workflow. Do not use tools and do not delegate.",
    `Workflow goal:\n${clean(goal, 3_000)}`,
    `Agent: ${clean(step.targetBotName, 80)}\nAssignment: ${clean(step.task, 3_000)}\nExpected output: ${clean(step.expectedOutput, 1_000) || "Not specified"}\nAcceptance criteria: ${clean(step.acceptanceCriteria, 2_000)}`,
    `Candidate result (attempt ${step.attempts} of ${step.maxAttempts}):\n${clean(step.result, 8_000)}`,
    "Judge only against the stated acceptance criteria and supplied evidence. Reply with exactly [ACCEPT] followed by one short reason, or [REVISE: specific actionable feedback]. Do not accept merely because text was returned.",
  ].join("\n\n").slice(0, 18_000);
}

export function parseWorkflowReview(value: string): WorkflowReviewDecision {
  const text = clean(value, 4_000);
  if (/^\[ACCEPT\]/i.test(text)) return { verdict: "accept", feedback: text.replace(/^\[ACCEPT\]\s*/i, "").trim().slice(0, 2_000) || "Acceptance criteria met" };
  const revision = text.match(/^\[REVISE:\s*([\s\S]*?)\]\s*$/i);
  if (revision?.[1]?.trim()) return { verdict: "revise", feedback: revision[1].trim().slice(0, 2_000) };
  return { verdict: "revise", feedback: `Reviewer did not explicitly accept the result: ${text || "No review returned"}`.slice(0, 2_000) };
}

export function readyWorkflowSteps(steps: Array<{ id: string; status: WorkflowStepStatus; dependsOn: string[] }>): string[] {
  const status = new Map(steps.map((step) => [step.id, step.status]));
  return steps.filter((step) => step.status === "pending" && step.dependsOn.every((id) => status.get(id) === "completed")).map((step) => step.id);
}

export function workflowCompletionPrompt(goal: string, steps: Array<{ targetBotName: string; task: string; result: string | null }>): string {
  const evidence = steps.map((step, index) => `Step ${index + 1} — ${clean(step.targetBotName, 80)}\nAssignment: ${clean(step.task, 1_000)}\nResult:\n${clean(step.result, 6_000)}`).join("\n\n");
  return [
    "You are the coordinating agent completing a multi-agent workflow. Do not use tools and do not delegate again.",
    `Shared goal:\n${clean(goal, 4_000)}`,
    `Completed specialist evidence:\n${evidence}`,
    "Produce one concise, decision-ready final deliverable. Reconcile conflicts, preserve uncertainty, cite which specialist result supports important claims, list unresolved risks, and state the recommended next action. Never claim work outside the supplied evidence.",
  ].join("\n\n").slice(0, 24_000);
}

export function fallbackWorkflowBrief(goal: string, steps: Array<{ targetBotName: string; result: string | null }>): string {
  return [`Workflow outcome: ${clean(goal, 1_000)}`, ...steps.map((step) => `${clean(step.targetBotName, 80) || "Agent"}: ${clean(step.result, 4_000) || "No written result"}`)].join("\n\n").slice(0, 20_000);
}
