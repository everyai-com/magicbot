import { describe, expect, it } from "vitest";

import { hasBrowserIntent } from "./browser-intent";

describe("hosted browser intent", () => {
  it.each([
    "Open https://example.com",
    "visit vapi.com and inspect it",
    "vapi.ai",
    "go to the website",
    "research the latest updates online",
  ])("recognizes %s", (prompt) => expect(hasBrowserIntent(prompt)).toBe(true));

  it("does not open the browser for ordinary chat", () => {
    expect(hasBrowserIntent("write a short project update")).toBe(false);
  });
});
