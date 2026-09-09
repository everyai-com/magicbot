import { afterEach, expect, it, vi } from "vitest";
import { isDemoCallConnected, joinDemoSession } from "./demo-call-connection";
class Session extends EventTarget {
  status = "disconnected";
  joinCall() { this.setStatus("connecting"); }
  setStatus(status: string) { this.status = status; this.dispatchEvent(new Event("status")); }
}
afterEach(() => vi.useRealTimers());
it("keeps loading until the connection is ready", async () => {
  const session = new Session();
  const ready = vi.fn();
  const joining = joinDemoSession(session, "wss://example.test").then(ready);
  await Promise.resolve();
  expect(ready).not.toHaveBeenCalled();
  expect(isDemoCallConnected("connecting")).toBe(false);
  session.setStatus("listening");
  await joining;
  expect(ready).toHaveBeenCalledOnce();
});
it("reports an early disconnect instead of opening call controls", async () => {
  const session = new Session();
  const joining = joinDemoSession(session, "wss://example.test");
  session.setStatus("disconnected");
  await expect(joining).rejects.toThrow("before connecting");
});
it("stops waiting when connection times out", async () => {
  vi.useFakeTimers();
  const joining = joinDemoSession(new Session(), "wss://example.test", 100);
  const assertion = expect(joining).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(100);
  await assertion;
});
