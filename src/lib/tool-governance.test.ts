import { describe, expect, it } from "vitest";
import { classifyHostedTool } from "../../shared/tool-governance";

describe("hosted tool governance", () => {
  it("allows classification of read-only tools", () => {
    expect(classifyHostedTool("computer", "computer_exec", { command: "ls -la" }).risk).toBe("read");
    expect(classifyHostedTool("connector", "GITHUB_LIST_REPOS", {}).risk).toBe("read");
    expect(classifyHostedTool("browser", "browser_text", {}).risk).toBe("read");
  });

  it("holds writes and destructive operations", () => {
    expect(classifyHostedTool("computer", "computer_exec", { command: "git push origin main" }).risk).toBe("external");
    expect(classifyHostedTool("computer", "computer_exec", { command: "curl -X POST https://example.com" }).risk).toBe("external");
    expect(classifyHostedTool("computer", "computer_exec", { command: "python -c 'open(\"x\",\"w\").write(\"y\")'" }).risk).toBe("external");
    expect(classifyHostedTool("computer", "computer_exec", { command: "rm -rf build" }).risk).toBe("destructive");
    expect(classifyHostedTool("connector", "GMAIL_SEND_EMAIL", { to: "qa@example.com" }).risk).toBe("external");
  });

  it("never makes secret-bearing arguments persistable", () => {
    const result = classifyHostedTool("connector", "CUSTOM_ACTION", { apiKey: "secret" });
    expect(result).toMatchObject({ risk: "sensitive", persistable: false });
    expect(result.preview).not.toContain("secret");
  });
});
