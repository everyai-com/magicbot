export const AUTONOMY_MODES = ["never", "observe", "draft", "ask", "act"] as const;
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

export const AUTONOMY_RISKS = ["read", "draft", "external", "sensitive", "destructive"] as const;
export type AutonomyRisk = (typeof AUTONOMY_RISKS)[number];
export type AutonomyVerdict = "allow" | "draft" | "ask" | "deny";

export interface AutonomyPolicy {
  id?: string;
  mode: AutonomyMode;
  maxPerHour?: number | null;
  maxPerDay?: number | null;
}

export interface AutonomyRequest {
  action: string;
  risk: AutonomyRisk;
  unattended: boolean;
  countLastHour?: number;
  countLastDay?: number;
}

export interface AutonomyDecision {
  verdict: AutonomyVerdict;
  reason: string;
  policyMode: AutonomyMode;
  policyId?: string;
}

export function isAutonomyMode(value: unknown): value is AutonomyMode {
  return typeof value === "string" && (AUTONOMY_MODES as readonly string[]).includes(value);
}

/** A single deterministic gate shared by connector actions. Sensitive and
 * destructive operations always require a person even when a policy says
 * act; containment must not depend on prompt wording or model judgment. */
export function decideAutonomy(policy: AutonomyPolicy, request: AutonomyRequest): AutonomyDecision {
  const result = (verdict: AutonomyVerdict, reason: string): AutonomyDecision => ({
    verdict,
    reason,
    policyMode: policy.mode,
    ...(policy.id ? { policyId: policy.id } : {}),
  });

  if (policy.mode === "never") return result("deny", "policy blocks this action");
  if (request.risk === "destructive") return result("ask", "destructive actions always require approval");
  if (request.risk === "sensitive") return result("ask", "sensitive content always requires approval");
  if (request.risk === "read") {
    return policy.mode === "observe" || policy.mode === "draft" || policy.mode === "ask" || policy.mode === "act"
      ? result("allow", "policy allows read-only observation")
      : result("deny", "policy does not allow observation");
  }
  if (request.risk === "draft") {
    return policy.mode === "observe"
      ? result("deny", "observe-only policy does not create drafts")
      : result("draft", "policy allows preparing a draft but not sending it");
  }
  if (policy.mode === "observe") return result("deny", "observe-only policy blocks external actions");
  if (policy.mode === "draft") return result("draft", "draft policy requires review before sending");
  if (policy.mode === "ask") return result("ask", "policy requires approval before external actions");

  const hourLimit = policy.maxPerHour ?? null;
  if (hourLimit !== null && (request.countLastHour ?? 0) >= hourLimit) {
    return result("ask", `hourly autonomy limit of ${hourLimit} reached`);
  }
  const dayLimit = policy.maxPerDay ?? null;
  if (dayLimit !== null && (request.countLastDay ?? 0) >= dayLimit) {
    return result("ask", `daily autonomy limit of ${dayLimit} reached`);
  }
  return result("allow", request.unattended ? "policy explicitly allows unattended action" : "policy allows this action");
}

export function legacyWhatsAppMode(mode: string): AutonomyMode {
  if (mode === "off") return "observe";
  if (mode === "autonomous") return "act";
  return "draft";
}
