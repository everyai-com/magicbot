import { expect, it } from "vitest";
import { transferTwiml, verifyTwilioSignature } from "../hosted-fixes/transfer-helpers.ts";
import { createHmac } from "node:crypto";
it("dials in sequence and includes a callback on the last attempt", () => {
  expect(transferTwiml(["+15551234567", "+15557654321"], 1, "https://example.com/transfer-call?agent_id=a")).toContain("attempt=2");
  expect(transferTwiml(["+15551234567"], 1, "https://example.com")).toContain("<Hangup/>");
  expect(() => transferTwiml(["<Dial>"], 0, "https://example.com")).toThrow();
});
it("validates signed callbacks and rejects a changed attempt", async () => {
  const url = "https://example.com/transfer-call?attempt=1";
  const form = new URLSearchParams({ CallSid: "CA123", DialCallStatus: "busy" });
  const signature = createHmac("sha1", "secret").update(url + "CallSidCA123DialCallStatusbusy").digest("base64");
  expect(await verifyTwilioSignature(url, form, "secret", signature)).toBe(true);
  expect(await verifyTwilioSignature(url.replace("=1", "=2"), form, "secret", signature)).toBe(false);
});
