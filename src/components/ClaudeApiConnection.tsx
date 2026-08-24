import { useState } from "react";
import { ExternalLink, Loader2, Unplug, X } from "lucide-react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { ProviderMark } from "./ProviderIcons";

type PendingLogin = { authorizeUrl: string; expiresAt: number };

function looksLikeClaudeCode(value: string) {
  return /^[\w-]{10,}#[\w-]{6,}$/.test(value.trim());
}

export function ClaudeApiConnection() {
  const { state, dispatch, refreshInstances } = useStore();
  const [pending, setPending] = useState<PendingLogin | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anthropic = state.config?.anthropic;
  const isDefault = state.config?.defaultEngine?.instanceId === "claude-subscription";

  const refresh = async () => {
    const config: ConfigStatus = await api("/api/config");
    dispatch({ type: "configStatus", config });
    if (config.defaultEngine) {
      for (const bot of state.bots) dispatch({ type: "botPatched", bot: { ...bot, modelSelection: config.defaultEngine } });
    }
    await refreshInstances();
  };

  const start = async () => {
    if (busy) return;
    const popup = window.open("about:blank", "magicbot-claude-auth", "popup,width=600,height=760");
    if (popup) {
      popup.document.title = "Opening Claude…";
      popup.document.body.textContent = "Opening secure Claude sign-in…";
      popup.opener = null;
    }
    setBusy(true);
    setError(null);
    try {
      const result: PendingLogin = await api("/api/claude/login", { method: "POST", body: "{}" });
      setPending(result);
      if (popup && !popup.closed) popup.location.href = result.authorizeUrl;
      else window.open(result.authorizeUrl, "_blank", "noopener,noreferrer");
    } catch (caught) {
      popup?.close();
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const complete = async (nextCode = code) => {
    if (!nextCode.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api("/api/claude/complete", { method: "POST", body: JSON.stringify({ code: nextCode.trim() }) });
      if (result.status !== "connected") throw new Error("Claude sign-in did not finish. Start again.");
      setPending(null);
      setCode("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await api("/api/claude/login", { method: "DELETE" });
      setPending(null);
      setCode("");
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/claude", { method: "DELETE" });
      setPending(null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-hairline/45 bg-inset/70">
      <div className="flex items-start gap-3.5 px-4 pb-3 pt-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-control text-ink shadow-sm">
          <ProviderMark driverKind="claudeAgent" size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[14px] font-semibold tracking-[-0.01em] text-ink">Claude Code</div>
              <div className="mt-0.5 text-[11.5px] text-ink-secondary">Your Claude subscription</div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-ink-secondary">
              <span className={`size-1.5 rounded-full ${anthropic?.runtimeReady ? "bg-success" : anthropic?.configured ? "bg-warning" : "bg-hairline"}`} />
              {isDefault ? "Default" : anthropic?.runtimeReady ? "Ready" : anthropic?.configured ? "Reconnect" : "Not connected"}
            </div>
          </div>
          <p className="mt-2 max-w-[58ch] text-[12.5px] leading-relaxed text-ink-secondary">
            Use Claude Code access from the subscription you already have. Sign in once with Claude; MagicTeams encrypts the connection in Cloudflare and never asks for an API key.
          </p>

          {anthropic?.configured && (
            <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-hairline/30 text-[11px] sm:grid-cols-3">
              <div className="bg-panel/70 px-2.5 py-2"><span className="text-ink-secondary">Account</span><div className="mt-0.5 font-medium text-ink">Connected</div></div>
              <div className="bg-panel/70 px-2.5 py-2"><span className="text-ink-secondary">Models</span><div className="mt-0.5 font-medium tabular-nums text-ink">{anthropic.modelCount || "Checking"}</div></div>
              <div className="col-span-2 bg-panel/70 px-2.5 py-2 sm:col-span-1"><span className="text-ink-secondary">Access</span><div className="mt-0.5 font-medium text-ink">Claude OAuth</div></div>
            </div>
          )}

          {pending ? (
            <div className="mt-3 rounded-xl border border-accent/25 bg-accent/5 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] leading-relaxed text-ink-secondary">Approve in Claude, copy the complete code it shows, then paste it below. A valid code connects immediately.</span>
                <button type="button" onClick={() => void cancel()} disabled={busy} aria-label="Cancel Claude sign-in" className="rounded p-1 text-ink-secondary hover:bg-control hover:text-ink"><X size={13} /></button>
              </div>
              <a href={pending.authorizeUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
                Open Claude approval <ExternalLink size={12} />
              </a>
              <div className="mt-2 flex gap-2">
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  onPaste={(event) => {
                    const pasted = event.clipboardData.getData("text").trim();
                    if (!looksLikeClaudeCode(pasted)) return;
                    event.preventDefault();
                    setCode(pasted);
                    void complete(pasted);
                  }}
                  onKeyDown={(event) => event.key === "Enter" && void complete()}
                  placeholder="Paste code#state from Claude"
                  aria-label="Claude authorization code"
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-lg border border-hairline/40 bg-panel px-3 py-2 font-mono text-[12px] text-ink placeholder:font-sans placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
                />
                <button type="button" onClick={() => void complete()} disabled={busy || !code.trim()} className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-[12px] font-medium text-panel disabled:opacity-50">
                  {busy && <Loader2 size={12} className="animate-spin" />} Finish
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              {!anthropic?.configured ? (
                <button type="button" onClick={() => void start()} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[12px] font-medium text-panel transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50">
                  {busy && <Loader2 size={12} className="animate-spin" />} Use Claude subscription
                </button>
              ) : (
                <button type="button" onClick={() => void disconnect()} disabled={busy} className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[12px] text-ink-secondary transition hover:bg-danger/5 hover:text-danger disabled:opacity-50">
                  <Unplug size={12} /> Disconnect
                </button>
              )}
            </div>
          )}
          {error && <div role="alert" className="mt-2 text-[12px] leading-relaxed text-danger">{error}</div>}
        </div>
      </div>
      <div className="border-t border-hairline/30 bg-panel/35 px-4 py-2 text-[10.5px] text-ink-secondary">Once connected, this subscription becomes the default for every bot. Subscription limits still apply.</div>
    </section>
  );
}
