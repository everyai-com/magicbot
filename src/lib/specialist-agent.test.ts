import { describe, expect, it } from "vitest";
import { SPECIALIST_AGENTS, SPECIALIST_BUNDLES, normalizeSpecialistAgent, specialistById, specialistCharter } from "../../shared/specialist-agent";
describe("specialist agent catalog",()=>{
  it("ships five unique specialists in every bundle",()=>{ expect(new Set(SPECIALIST_AGENTS.map((item)=>item.id)).size).toBe(30); for(const bundle of SPECIALIST_BUNDLES) expect(SPECIALIST_AGENTS.filter((item)=>item.bundle===bundle)).toHaveLength(5); });
  it("renders visible bounded charters",()=>{ const agent=specialistById("security-reviewer")!; const charter=specialistCharter(agent); expect(charter).toContain("Expected deliverables"); expect(charter).toContain("Operating guardrails"); expect(charter.length).toBeLessThanOrEqual(4_000); });
  it("validates portable manifests without elevating recommendations",()=>{ const agent=normalizeSpecialistAgent({...SPECIALIST_AGENTS[0], recommendedCapabilities:["browser",42]}); expect(agent?.recommendedCapabilities).toEqual(["browser"]); expect(normalizeSpecialistAgent({name:"No charter"})).toBeNull(); });
});
