// AIOS organ #1 — per-bot memory.
//
// Mirrors the AIOS Desktop pattern (AIOS_REMEMBER → store → injected block):
// each bot keeps a small set of durable facts about its user/work that persist
// across threads and turns, independent of the rolling transcript. Facts are
// injected into the system prompt every turn, and the bot writes new ones by
// emitting a [REMEMBER: …] marker in its reply — the harness extracts, stores,
// and strips the marker before the text is shown. Driver-agnostic on purpose:
// it works for every provider (grok/claude/codex/pi) without a tool contract.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "../config.ts";

export interface MemoryFact {
  id: string;
  text: string;
  at: number;
}

const memoryFile = (botId: string) => join(DATA_DIR, `memory-${botId}.json`);
const MAX_FACTS = 50;

function load(botId: string): MemoryFact[] {
  try {
    return JSON.parse(readFileSync(memoryFile(botId), "utf8"));
  } catch {
    return [];
  }
}

function save(botId: string, facts: MemoryFact[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(memoryFile(botId), JSON.stringify(facts, null, 2));
}

/** Facts this bot remembers, newest last. */
export function recall(botId: string): MemoryFact[] {
  return load(botId);
}

/** The block injected into the system prompt, or "" when nothing is stored. */
export function memoryBlock(botId: string): string {
  const facts = load(botId);
  if (!facts.length) return "";
  const lines = facts.map((f) => `- ${f.text}`).join("\n");
  return `\n\nWhat you remember (persists across every conversation with this user):\n${lines}`;
}

/** Store a fact, de-duplicated on exact text; caps at MAX_FACTS (drops oldest). */
export function remember(botId: string, text: string): MemoryFact | null {
  const clean = text.trim();
  if (!clean) return null;
  const facts = load(botId);
  if (facts.some((f) => f.text === clean)) return null;
  const fact: MemoryFact = {
    id: `m_${botId.slice(0, 6)}_${facts.length}_${clean.length}`,
    text: clean,
    at: Date.now(),
  };
  facts.push(fact);
  save(botId, facts.slice(-MAX_FACTS));
  return fact;
}

export function forget(botId: string, factId: string): void {
  save(
    botId,
    load(botId).filter((f) => f.id !== factId),
  );
}

const REMEMBER_RE = /\[REMEMBER:\s*([^\]]+)\]/gi;

/** Extract [REMEMBER: …] markers, persist each, return the text with markers
 *  stripped and the facts captured (for a runtime event / UI chip). */
export function captureFromText(botId: string, text: string): { stripped: string; captured: MemoryFact[] } {
  const captured: MemoryFact[] = [];
  let m: RegExpExecArray | null;
  REMEMBER_RE.lastIndex = 0;
  while ((m = REMEMBER_RE.exec(text)) !== null) {
    const fact = remember(botId, m[1]);
    if (fact) captured.push(fact);
  }
  const stripped = text.replace(REMEMBER_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  return { stripped, captured };
}
