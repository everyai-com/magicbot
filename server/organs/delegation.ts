// AIOS organ — bot-to-bot delegation (the "team of bots" orchestration the
// Grok-bot reviews praised, made a real feature).
//
// A bot delegates by writing [DELEGATE: <bot name> | <task>] in its reply.
// The harness runs that target bot's turn, collects its final answer, feeds
// the result back into the orchestrator's thread, and re-runs the orchestrator
// so it can continue with the result. Driver-agnostic (same marker approach as
// the memory organ) — works for grok/claude/codex/pi without a tool contract.
//
// Loops are bounded: a delegation chain may hop at most MAX_HOPS times before
// it stops (reset when the human sends a fresh message).
import type { EventBus } from "../harness/bus.ts";
import type { RuntimeEvent } from "../contracts.ts";

export const MAX_HOPS = 5;

export interface Delegation {
  to: string;
  task: string;
}

const DELEGATE_RE = /\[DELEGATE:\s*([^|\]]+)\|\s*([^\]]+)\]/gi;

/** Pull [DELEGATE: name | task] markers out of a reply. */
export function parse(text: string): Delegation[] {
  const out: Delegation[] = [];
  let m: RegExpExecArray | null;
  DELEGATE_RE.lastIndex = 0;
  while ((m = DELEGATE_RE.exec(text)) !== null) {
    const to = m[1].trim();
    const task = m[2].trim();
    if (to && task) out.push({ to, task });
  }
  return out;
}

/** The reply with delegation markers removed (for display). */
export function strip(text: string): string {
  return text.replace(DELEGATE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Run a bot's turn and resolve with the assistant text it produces, by
 *  watching the bus for that bot's thread until the turn completes. Rejects
 *  on runtime.error or a timeout so a stuck delegate can't hang forever. */
export function collectTurn(
  bus: EventBus,
  startTurn: (botId: string, text: string) => Promise<unknown>,
  botId: string,
  threadId: string,
  task: string,
  timeoutMs = 180_000,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let text = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      unsub();
      clearTimeout(timer);
      fn();
    };
    const unsub = bus.subscribe((event: RuntimeEvent) => {
      if (event.threadId !== threadId) return;
      if (event.type === "item.completed" && event.itemType === "assistant_text") {
        text += (text ? "\n" : "") + event.text;
      } else if (event.type === "turn.completed") {
        finish(() => resolve(text.trim() || "(the delegated bot produced no text)"));
      } else if (event.type === "runtime.error") {
        finish(() => reject(new Error(event.message)));
      }
    });
    const timer = setTimeout(() => finish(() => reject(new Error("delegate timed out"))), timeoutMs);
    startTurn(botId, task).catch((e) => finish(() => reject(e instanceof Error ? e : new Error(String(e)))));
  });
}
