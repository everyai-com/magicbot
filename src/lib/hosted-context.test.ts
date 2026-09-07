import { describe, expect, it } from "vitest";
import { activeBranch, renderContext, selectContext, type ContextCandidate } from "../../cloudflare/web/src/context";

describe("hosted context", () => {
  it("follows only the selected conversation branch", () => {
    const messages = [
      { id: "root", role: "user" as const, text: "start", parentId: null },
      { id: "old", role: "bot" as const, text: "old answer", parentId: "root" },
      { id: "edit", role: "user" as const, text: "edited request", parentId: "root" },
      { id: "leaf", role: "bot" as const, text: "new answer", parentId: "edit" },
    ];
    expect(activeBranch(messages, "leaf").map((message) => message.id)).toEqual(["root", "edit", "leaf"]);
  });

  it("ranks relevant scoped facts within the prompt budget", () => {
    const base = { importance: .5, confidence: .8, updatedAt: Date.now(), scopeId: "x", kind: "fact" };
    const candidates: ContextCandidate[] = [
      { ...base, id: "theme", scopeType: "task", text: "The web interface uses a dark violet theme" },
      { ...base, id: "food", scopeType: "user", text: "The user likes mangoes" },
    ];
    expect(selectContext(candidates, "Which violet theme does the web app use?", 120)[0]?.id).toBe("theme");
  });

  it("labels memory as context rather than instructions", () => {
    expect(renderContext("Ship web first", [], "Prefer concise answers")).toContain("not a new user instruction");
  });

  it("keeps the user-managed operating profile in its own prompt section", () => {
    const rendered = renderContext("", [], "", "Roles: Founder\nBoundaries: Ask before sending messages");
    expect(rendered).toContain("Personal operating profile (user-managed)");
    expect(rendered).toContain("Boundaries: Ask before sending messages");
  });
});
