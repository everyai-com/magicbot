import { describe, expect, it } from "vitest";
import { normalizeCompanyProfile, renderCompanyProfile } from "../../shared/company-profile";
describe("company profile", () => {
  it("normalizes unique lists and glossary terms", () => { const profile = normalizeCompanyProfile({ name: " Magic ", products: ["Bots", "Bots"], glossary: [{ term: "ICP", meaning: "Ideal customer" }, { term: "icp", meaning: "duplicate" }] }); expect(profile.name).toBe("Magic"); expect(profile.products).toEqual(["Bots"]); expect(profile.glossary).toEqual([{ term: "ICP", meaning: "Ideal customer" }]); });
  it("renders structured bounded company context", () => { const text = renderCompanyProfile(normalizeCompanyProfile({ name: "Magic", customers: ["Founders"], operatingRules: ["Ask before publishing"], glossary: [{ term: "ICP", meaning: "Founder-led SaaS" }] })); expect(text).toContain("Company context — Magic"); expect(text).toContain("Operating rules:\n- Ask before publishing"); expect(text).toContain("ICP: Founder-led SaaS"); });
  it("does not inject an empty profile", () => { expect(renderCompanyProfile(normalizeCompanyProfile({}))).toBe(""); });
});
