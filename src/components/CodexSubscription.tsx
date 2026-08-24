import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, RefreshCw, Unplug } from "lucide-react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { ProviderMark } from "./ProviderIcons";

type PendingLogin = {
  userCode: string;
  verificationUrl: string;
  interval: number;
  expiresAt: number;
};

export function CodexSubscription() {
  const { state, dispatch, refreshInstances } = useStore();
  const [pending, setPending] = useState<PendingLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codex = state.config?.codex;

  const refresh = async () => {
    const config: ConfigStatus = await api("/api/config");
    dispatch({ type: "configStatus", config });
    await refreshInstances();
  };

  useEffect(() => {
    if (window.ogb) return;
    void api("/api/codex/status")
      .then((status) => {
        if (status.pending) setPending(status.pending);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!pending) return;
    const delay = Math.max(2, pending.interval) * 1000;
    const timer = window.setTimeout(() => {
      void api("/api/codex/poll", { method: "POST", body: "{}" })
        .then(async (result) => {
          if (result.status !== "connected") {
            setPending((current) => current ? {
              ...current,
              interval: result.interval ?? current.interval,
              expiresAt: result.expiresAt ?? current.expiresAt,
            } : null);
            return;
          }
          setPending(null);
          if (result.warning) setError(result.warning);
          await refresh();
        })
        .catch((caught: Error) => {
          setError(caught.message);
          setPending((current) => current && current.expiresAt > Date.now() ? { ...current } : null);
        });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [pending]);

  if (window.ogb) return null;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api("/api/codex/login", {
        method: "POST",
        body: JSON.stringify({ consentVersion: codex?.consentVersion ?? "2026-08-24" }),
      });
      setPending(result);
      window.open(result.verificationUrl, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await api("/api/codex/login", { method: "DELETE" });
      setPending(null);
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
      await api("/api/codex", { method: "DELETE" });
      setPending(null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api("/api/codex/check", { method: "POST", body: "{}" });
      if (!result.runtimeReady) setError(result.warning || "Codex could not finish its cloud runtime check. Try again shortly.");
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
          <ProviderMark driverKind="codex" size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[14px] font-semibold tracking-[-0.01em] text-ink">Codex</div>
              <div className="mt-0.5 text-[11.5px] text-ink-secondary">Your ChatGPT subscription</div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-ink-secondary">
              <span className={`size-1.5 rounded-full ${codex?.runtimeReady ? "bg-success" : codex?.configured ? "bg-warning" : "bg-hairline"}`} />
              {codex?.runtimeReady ? "Ready" : codex?.configured ? "Setup needed" : "Not connected"}
            </div>
          </div>
          <p className="mt-2 max-w-[58ch] text-[12.5px] leading-relaxed text-ink-secondary">
            Use the Codex access included with your ChatGPT plan. MagicBot runs the official Codex CLI inside your private Cloudflare Computer—no API key or separate API billing.
          </p>

          {codex?.configured && (
            <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-hairline/30 text-[11px] sm:grid-cols-3">
              <div className="bg-panel/70 px-2.5 py-2"><span className="text-ink-secondary">Account</span><div className="mt-0.5 font-medium text-ink">Connected</div></div>
              <div className="bg-panel/70 px-2.5 py-2"><span className="text-ink-secondary">Models</span><div className="mt-0.5 font-medium tabular-nums text-ink">{codex.modelCount || "Checking"}</div></div>
              <div className="col-span-2 bg-panel/70 px-2.5 py-2 sm:col-span-1"><span className="text-ink-secondary">Runs on</span><div className="mt-0.5 font-medium text-ink">Cloudflare Computer</div></div>
            </div>
          )}

          {pending ? (
            <div className="mt-3 rounded-xl border border-accent/25 bg-accent/5 p-3.5">
              <div className="text-[11.5px] font-medium text-ink">Enter this one-time code in ChatGPT</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="rounded-md bg-panel px-3 py-1.5 text-[16px] font-semibold tracking-widest text-ink">{pending.userCode}</code>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(pending.userCode).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })}
                  className="rounded-md p-2 text-ink-secondary hover:bg-control hover:text-ink"
                  aria-label="Copy sign-in code"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <a href={pending.verificationUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
                  Open ChatGPT <ExternalLink size={12} />
                </a>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-ink-secondary">
                <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Waiting for approval…</span>
                <button type="button" onClick={() => void cancel()} disabled={busy} className="hover:text-ink">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              {!codex?.configured ? (
                <button type="button" onClick={() => void start()} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[12px] font-medium text-panel transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50">
                  {busy && <Loader2 size={12} className="animate-spin" />} Use ChatGPT subscription
                </button>
              ) : !codex.runtimeReady ? (
                <>
                  <button type="button" onClick={() => void check()} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[12px] font-medium text-panel transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50">
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Finish setup
                  </button>
                  <button type="button" onClick={() => void start()} disabled={busy} className="rounded-lg px-2.5 py-2 text-[12px] text-ink-secondary transition hover:bg-control hover:text-ink">Reconnect</button>
                </>
              ) : null}
              {codex?.configured && (
                <button type="button" onClick={() => void disconnect()} disabled={busy} className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[12px] text-ink-secondary transition hover:bg-danger/5 hover:text-danger disabled:opacity-50">
                  <Unplug size={12} /> Disconnect
                </button>
              )}
            </div>
          )}
          {error && <div role="alert" className="mt-2 text-[12px] leading-relaxed text-warning">{error}</div>}
        </div>
      </div>
      <div className="border-t border-hairline/30 bg-panel/35 px-4 py-2 text-[10.5px] text-ink-secondary">Subscription limits and workspace policies still apply.</div>
    </section>
  );
}
