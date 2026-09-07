import { describe, expect, it } from "vitest";
import { captureKey, normalizeCapture, readableCaptureText, safeCaptureUrl } from "../../shared/knowledge-capture";
describe("knowledge capture", () => {
  it("normalizes capture metadata", () => { expect(normalizeCapture({ title: " Note ", content: " Body ", tags: ["AI", "ai", " Work "] })).toEqual({ title: "Note", sourceUrl: "", content: "Body", tags: ["ai", "work"] }); });
  it("accepts public HTTPS and rejects unsafe URL shapes", () => { expect(safeCaptureUrl("https://example.com/read")).not.toBeNull(); expect(safeCaptureUrl("http://example.com")).toBeNull(); expect(safeCaptureUrl("https://127.0.0.1/a")).toBeNull(); expect(safeCaptureUrl("https://192.168.1.2/a")).toBeNull(); expect(safeCaptureUrl("https://user:pass@example.com")).toBeNull(); });
  it("extracts readable HTML and stable duplicate keys", () => { expect(readableCaptureText("<style>x</style><h1>Hello</h1><script>x</script><p>World &amp; us</p>", "text/html")).toBe("Hello World & us"); expect(captureKey(" Hello  WORLD ")).toBe("hello world"); });
});
