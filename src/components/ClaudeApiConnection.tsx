import { useState } from "react";
import { Check, ExternalLink, Loader2, Unplug, X } from "lucide-react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { ProviderMark } from "./ProviderIcons";

type PendingLogin = { authorizeUrl: string; expiresAt: number };

export function ClaudeApiConnection() {
  const { state, dispatch, refreshInstances } = useStore();
  const [pending, setPending] = useState<PendingLogin | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anthropic = state.config?.anthropic;

  const refresh = async () => {
    const config: ConfigStatus = await api("/api/config");
    dispatch({ type: "configStatus", config });
    await refreshInstances();
  };

  const start = async () => {
    if (busy) return;
    const popup = window.open("about:blank", "magicbot-claude-auth");
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

  const complete = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api("/api/claude/complete", { method: "POST", body: JSON.stringify({ code: code.trim() }) });
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
    <div className="rounded-xl border border-hairline/40 bg-inset p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-control text-ink">
          <ProviderMark driverKind="claudeAgent" size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-ink">Claude Code subscription</span>
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">Claude OAuth</span>
            {anthropic?.runtimeReady && <span className="flex items-center gap-1 text-[11px] text-success"><Check size={11} /> Ready · {anthropic.modelCount} models</span>}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
            Sign in with the current Claude Code OAuth flow used by the working AIOS stack. MagicBot encrypts the connection tokens in Cloudflare; no API key is needed.
          </p>

          {pending ? (
            <div className="mt-3 rounded-lg border border-accent/25 bg-accent/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-ink-secondary">Approve in Claude, then paste the complete one-time code shown there.</span>
                <button type="button" onClick={() => void cancel()} disabled={busy} aria-label="Cancel Claude sign-in" className="rounded p-1 text-ink-secondary hover:bg-control hover:text-ink"><X size={13} /></button>
              </div>
              <a href={pending.authorizeUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
                Open Claude approval <ExternalLink size={12} />
              </a>
              <div className="mt-2 flex gap-2">
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && void complete()}
                  placeholder="Paste the complete Claude login code"
                  aria-label="Claude authorization code"
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-lg border border-hairline/40 bg-panel px-3 py-2 font-mono text-[12px] text-ink placeholder:font-sans placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
                />
                <button type="button" onClick={() => void complete()} disabled={busy || !code.trim()} className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-[12px] font-medium text-panel disabled:opacity-50">
                  {busy && <Loader2 size={12} className="animate-spin" />} Connect
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {!anthropic?.configured ? (
                <button type="button" onClick={() => void start()} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-panel disabled:opacity-50">
                  {busy && <Loader2 size={12} className="animate-spin" />} Connect Claude
                </button>
              ) : (
                <button type="button" onClick={() => void disconnect()} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-hairline/40 px-3 py-1.5 text-[12px] text-danger hover:bg-danger/5 disabled:opacity-50">
                  <Unplug size={12} /> Disconnect
                </button>
              )}
            </div>
          )}
          {error && <div role="alert" className="mt-2 text-[12px] leading-relaxed text-danger">{error}</div>}
        </div>
      </div>
    </div>
  );
}
