export function cfConfigured(cfg) {
    return Boolean(cfg.cfComputer?.url && cfg.cfComputer?.token);
}
async function call(cfg, botId, action, body) {
    const base = cfg.cfComputer.url.replace(/\/+$/, "");
    const res = await fetch(`${base}/computer/${botId}/${action}`, {
        method: "POST",
        headers: {
            authorization: `Bearer ${cfg.cfComputer.token}`,
            "content-type": "application/json",
        },
        body: JSON.stringify(body ?? {}),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.ok === false) {
        throw new Error(json?.error ?? `cf-computer ${action} failed (${res.status})`);
    }
    return json;
}
export function exec(cfg, botId, command) {
    return call(cfg, botId, "exec", { command });
}
export function runCode(cfg, botId, code, language = "python") {
    return call(cfg, botId, "run", { code, language });
}
export function writeFile(cfg, botId, path, content) {
    return call(cfg, botId, "writeFile", { path, content });
}
export function readFile(cfg, botId, path) {
    return call(cfg, botId, "readFile", { path });
}
export function exposePort(cfg, botId, port) {
    return call(cfg, botId, "expose", { port });
}
export function destroy(cfg, botId) {
    return call(cfg, botId, "destroy", {});
}
