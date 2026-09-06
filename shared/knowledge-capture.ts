export interface KnowledgeCaptureInput { title: string; sourceUrl: string; content: string; tags: string[] }
const cleanText = (value: unknown, limit: number) => typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, limit) : "";
export function normalizeCapture(value: unknown): KnowledgeCaptureInput {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { title: cleanText(record.title, 240), sourceUrl: cleanText(record.sourceUrl, 2_000), content: cleanText(record.content, 500_000), tags: Array.isArray(record.tags) ? [...new Set(record.tags.map((item) => cleanText(item, 60).toLowerCase()).filter(Boolean))].slice(0, 20) : [] };
}
export function safeCaptureUrl(value: string): URL | null {
  try {
    const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) { const parts = host.split(".").map(Number); if (parts.some((part) => part > 255) || parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || parts[0] >= 224 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)) return null; }
    if (host.includes(":")) return null;
    return url;
  } catch { return null; }
}
export function readableCaptureText(text: string, contentType: string): string {
  if (/html/i.test(contentType)) return text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#39;/g, "'").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim().slice(0, 500_000);
  return text.replace(/\u0000/g, "").trim().slice(0, 500_000);
}
export function captureKey(content: string): string { return content.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 1_000); }
