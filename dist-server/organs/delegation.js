export const MAX_HOPS = 5;
const DELEGATE_RE = /\[DELEGATE:\s*([^|\]]+)\|\s*([^\]]+)\]/gi;
/** Pull [DELEGATE: name | task] markers out of a reply. */
export function parse(text) {
    const out = [];
    let m;
    DELEGATE_RE.lastIndex = 0;
    while ((m = DELEGATE_RE.exec(text)) !== null) {
        const to = m[1].trim();
        const task = m[2].trim();
        if (to && task)
            out.push({ to, task });
    }
    return out;
}
/** The reply with delegation markers removed (for display). */
export function strip(text) {
    return text.replace(DELEGATE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}
/** Run a bot's turn and resolve with the assistant text it produces, by
 *  watching the bus for that bot's thread until the turn completes. Rejects
 *  on runtime.error or a timeout so a stuck delegate can't hang forever. */
export function collectTurn(bus, startTurn, botId, threadId, task, timeoutMs = 180_000) {
    return new Promise((resolve, reject) => {
        let text = "";
        let settled = false;
        const finish = (fn) => {
            if (settled)
                return;
            settled = true;
            unsub();
            clearTimeout(timer);
            fn();
        };
        const unsub = bus.subscribe((event) => {
            if (event.threadId !== threadId)
                return;
            if (event.type === "item.completed" && event.itemType === "assistant_text") {
                text += (text ? "\n" : "") + event.text;
            }
            else if (event.type === "turn.completed") {
                finish(() => resolve(text.trim() || "(the delegated bot produced no text)"));
            }
            else if (event.type === "runtime.error") {
                finish(() => reject(new Error(event.message)));
            }
        });
        const timer = setTimeout(() => finish(() => reject(new Error("delegate timed out"))), timeoutMs);
        startTurn(botId, task).catch((e) => finish(() => reject(e instanceof Error ? e : new Error(String(e)))));
    });
}
