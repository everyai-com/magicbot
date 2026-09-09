const xml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
export function transferTwiml(numbers: string[], attempt: number, callback: string): string {
  if (!Number.isInteger(attempt) || attempt < 0) throw new Error("Invalid transfer attempt");
  if (attempt >= numbers.length) return '<Response><Say>Sorry, no one is available to take your call.</Say><Hangup/></Response>';
  const target = numbers[attempt];
  if (!/^\+[1-9]\d{6,14}$/.test(target)) throw new Error("Invalid forwarding phone number");
  const url = new URL(callback); url.searchParams.set("attempt", String(attempt + 1));
  return `<Response><Dial action="${xml(url.href)}" method="POST" timeout="15"><Number>${target}</Number></Dial></Response>`;
}
export async function verifyTwilioSignature(url: string, form: URLSearchParams, token: string, signature: string): Promise<boolean> {
  if (!token || !signature) return false;
  const text = url + [...new Set(form.keys())].sort().map((key) => [...new Set(form.getAll(key))].sort().map((value) => key + value).join("")).join("");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["verify"]);
  try { return await crypto.subtle.verify("HMAC", key, Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)), encoder.encode(text)); } catch { return false; }
}
