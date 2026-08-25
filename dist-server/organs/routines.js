// AIOS organ #2 — routines (scheduled recurring bot tasks).
//
// Fills OpenMausBot's "Routines are a placeholder" gap. A routine is a saved
// prompt a bot runs on an interval. The scheduler is a single in-harness tick
// (the local Mac app's harness is a long-lived process); when this same core
// runs hosted in a Cloudflare Durable Object later, the tick is replaced by a
// DO alarm — the record shape and runDue() logic stay identical.
//
// AIOS lineage: routines are the workspace's scheduled-loop lane. Default
// execution is the bot's own model (the "Quick" lane); no separate agent tier.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.js";
const ROUTINES_FILE = join(DATA_DIR, "routines.json");
function loadAll() {
    try {
        return JSON.parse(readFileSync(ROUTINES_FILE, "utf8"));
    }
    catch {
        return [];
    }
}
function saveAll(list) {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(ROUTINES_FILE, JSON.stringify(list, null, 2));
}
export function forBot(botId) {
    return loadAll().filter((r) => r.botId === botId);
}
export function get(id) {
    return loadAll().find((r) => r.id === id) ?? null;
}
export function create(botId, prompt, everyMinutes) {
    const clean = prompt.trim();
    const minutes = Math.max(1, Math.floor(everyMinutes) || 1);
    const now = Date.now();
    const routine = {
        id: `r_${botId.slice(0, 6)}_${now.toString(36)}`,
        botId,
        prompt: clean,
        everyMinutes: minutes,
        enabled: true,
        createdAt: now,
        nextRunAt: now + minutes * 60_000,
    };
    const list = loadAll();
    list.push(routine);
    saveAll(list);
    return routine;
}
export function patch(id, p) {
    const list = loadAll();
    const routine = list.find((r) => r.id === id);
    if (!routine)
        return null;
    if (p.prompt !== undefined)
        routine.prompt = p.prompt.trim();
    if (p.everyMinutes !== undefined)
        routine.everyMinutes = Math.max(1, Math.floor(p.everyMinutes) || 1);
    if (p.enabled !== undefined)
        routine.enabled = p.enabled;
    // recompute the next fire from now so an edit takes effect promptly
    routine.nextRunAt = Date.now() + routine.everyMinutes * 60_000;
    saveAll(list);
    return routine;
}
export function remove(id) {
    const list = loadAll();
    const next = list.filter((r) => r.id !== id);
    if (next.length === list.length)
        return false;
    saveAll(next);
    return true;
}
let timer = null;
/** Fire every routine whose nextRunAt has passed. Skips ones whose run throws
 *  (bot busy/unavailable) without advancing the clock, so they retry. */
export async function runDue(runner, now = Date.now()) {
    const list = loadAll();
    let changed = false;
    for (const routine of list) {
        if (!routine.enabled || routine.nextRunAt > now)
            continue;
        try {
            await runner(routine.botId, `[routine] ${routine.prompt}`);
            routine.lastRunAt = now;
            routine.nextRunAt = now + routine.everyMinutes * 60_000;
            changed = true;
        }
        catch {
            // bot busy or unavailable — leave nextRunAt so the next tick retries,
            // but nudge it forward a minute to avoid a hot loop on a stuck bot
            routine.nextRunAt = now + 60_000;
            changed = true;
        }
    }
    if (changed)
        saveAll(list);
}
/** Start the in-harness scheduler tick (every 30s). Idempotent. */
export function startScheduler(runner) {
    if (timer)
        return;
    timer = setInterval(() => {
        void runDue(runner);
    }, 30_000);
    if (typeof timer.unref === "function")
        timer.unref();
}
