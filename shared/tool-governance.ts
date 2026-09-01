import type { AutonomyRisk } from "./autonomy";

export type HostedToolKind = "computer" | "browser" | "connector" | "image";

export interface ToolClassification {
  action: string;
  risk: AutonomyRisk;
  persistable: boolean;
  preview: string;
}

const SECRET_KEY = /password|passcode|secret|token|api.?key|authorization|cookie|otp/i;
const SECRET_VALUE = /\b(?:password|passcode|otp|one[- ]time code|credit card|debit card|bank account|private key|seed phrase)\b/i;
const DESTRUCTIVE_SHELL = /(?:^|[;&|\s])(?:rm|rmdir|shred|mkfs|dd|wipefs|shutdown|reboot|killall|pkill)\b|git\s+(?:reset\s+--hard|clean\s+-[a-z]*f)|drop\s+(?:table|database)|truncate\s+table/i;
const READ_ONLY_COMMAND = /^(?:pwd|ls|rg|grep|cat|sed|head|tail|wc|stat|file|du|df|which|type)(?:\s|$)|^git\s+(?:status|log|diff|show|branch|rev-parse)(?:\s|$)/i;

function readOnlyShell(command: string): boolean {
  if (!command.trim() || /[;&><`]|\$\(|\n|\r/.test(command) || /\bfind\b[^|]*\s-(?:delete|exec|execdir|ok|okdir)\b/i.test(command)) return false;
  return command.split("|").every((part) => READ_ONLY_COMMAND.test(part.trim()));
}

function hasSecret(value: unknown, depth = 0): boolean {
  if (depth > 5 || value == null) return false;
  if (typeof value === "string") return SECRET_VALUE.test(value);
  if (Array.isArray(value)) return value.some((entry) => hasSecret(entry, depth + 1));
  if (typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => SECRET_KEY.test(key) || hasSecret(entry, depth + 1));
}

function compactPreview(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

export function classifyHostedTool(kind: HostedToolKind, toolName: string, args: Record<string, unknown>): ToolClassification {
  const action = `${kind}.${toolName}`;
  if (hasSecret(args)) return { action, risk: "sensitive", persistable: false, preview: "Sensitive arguments were withheld" };
  if (kind === "computer") {
    const command = String(args.command ?? "");
    if (DESTRUCTIVE_SHELL.test(command)) return { action, risk: "destructive", persistable: true, preview: compactPreview(command) };
    return { action, risk: readOnlyShell(command) ? "read" : "external", persistable: true, preview: compactPreview(command) };
  }
  if (kind === "browser") {
    if (["open_url", "browser_state", "browser_text", "browser_snapshot"].includes(toolName)) return { action, risk: "read", persistable: true, preview: compactPreview(args.url ?? toolName) };
    if (toolName === "browser_fill") return { action, risk: "sensitive", persistable: false, preview: "Browser form text was withheld" };
    return { action, risk: "external", persistable: true, preview: compactPreview(args) };
  }
  if (kind === "image") return { action, risk: "draft", persistable: true, preview: compactPreview(args.prompt) };
  if (/(?:^|_)(?:DELETE|REMOVE|DESTROY|REVOKE|CANCEL)(?:_|$)/i.test(toolName)) return { action, risk: "destructive", persistable: true, preview: compactPreview(args) };
  if (/(?:^|_)(?:GET|LIST|SEARCH|FETCH|READ)(?:_|$)/i.test(toolName)) return { action, risk: "read", persistable: true, preview: compactPreview(args) };
  return { action, risk: "external", persistable: true, preview: compactPreview(args) };
}
