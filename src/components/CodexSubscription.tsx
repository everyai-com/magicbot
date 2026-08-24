import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Unplug } from "lucide-react";
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

  return (
    <div className="rounded-xl border border-hairline/40 bg-inset p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-control text-ink">
          <ProviderMark driverKind="codex" size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-ink">Codex with ChatGPT</span>
            <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning">Cloudflare blocked</span>
            {codex?.runtimeReady ? <span className="text-[11px] text-success">Ready</span> : codex?.configured ? <span className="text-[11px] text-ink-secondary">Account connected</span> : null}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
            Your ChatGPT account can be connected and stored encrypted, but ChatGPT currently blocks Codex inference from Cloudflare Workers. This engine will not appear in bot model pickers until that upstream restriction changes.
          </p>

          {pending ? (
            <div className="mt-3 rounded-lg border border-accent/25 bg-accent/5 p-3">
              <div className="text-[11px] text-ink-secondary">Enter this one-time code on the ChatGPT page</div>
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
            <div className="mt-3 flex flex-wrap gap-2">
              {!codex?.configured ? (
                <button type="button" onClick={() => void start()} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-panel disabled:opacity-50">
                  {busy && <Loader2 size={12} className="animate-spin" />} Connect ChatGPT
                </button>
              ) : !codex.runtimeReady ? (
                <button type="button" onClick={() => void start()} disabled={busy} className="rounded-lg border border-hairline/40 px-3 py-1.5 text-[12px] text-ink-secondary hover:text-ink">Reconnect account</button>
              ) : null}
              {codex?.configured && (
                <button type="button" onClick={() => void disconnect()} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-hairline/40 px-3 py-1.5 text-[12px] text-danger hover:bg-danger/5 disabled:opacity-50">
                  <Unplug size={12} /> Disconnect
                </button>
              )}
            </div>
          )}
          {error && <div role="alert" className="mt-2 text-[12px] leading-relaxed text-warning">{error}</div>}
        </div>
      </div>
    </div>
  );
}
