import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, useStore } from "@/state/store";
import { Card } from "./SettingsPrimitives";

type Mode = "off" | "draft" | "autonomous";
type StatusResponse = {
  connection?: { status?: string; account_name?: string; default_bot_id?: string; default_mode?: Mode };
  runtime?: { state?: { status?: string; qr?: string; me?: { name?: string } } };
};
type Chat = {
  jid: string; title?: string; display_name?: string; is_group: number; agent_mode: "inherit" | Mode;
  bot_id?: string; inbound_count?: number; outbound_count?: number; relationship_score?: number;
};
type Draft = { id: string; chat_jid: string; body: string; created_at: number };

export function WhatsAppSettings() {
  const { state } = useStore();
  const [status, setStatus] = useState<StatusResponse>({});
  const [chats, setChats] = useState<Chat[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await api("/api/whatsapp/status") as StatusResponse;
      setStatus(next);
      const runtimeStatus = next.runtime?.state?.status;
      if (["starting", "pairing", "connected", "reconnecting"].includes(runtimeStatus ?? "")) {
        await api("/api/whatsapp/sync", { method: "POST", body: "{}" });
      }
      if (runtimeStatus === "connected") {
        const [chatResult, draftResult] = await Promise.all([
          api("/api/whatsapp/chats") as Promise<{ chats: Chat[] }>,
          api("/api/whatsapp/drafts") as Promise<{ drafts: Draft[] }>,
        ]);
        setChats(chatResult.chats ?? []);
        setDrafts(draftResult.drafts ?? []);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh WhatsApp");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const connect = async () => {
    setBusy(true); setError("");
    try { await api("/api/whatsapp/connect", { method: "POST", body: "{}" }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start pairing"); }
    finally { setBusy(false); }
  };

  const setPolicy = async (mode: Mode | "inherit", botId: string | null, chatJid?: string) => {
    setBusy(true); setError("");
    try {
      await api("/api/whatsapp/policy", { method: "PATCH", body: JSON.stringify({ mode, botId, chatJid }) });
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save policy"); }
    finally { setBusy(false); }
  };

  const approve = async (id: string) => {
    setBusy(true); setError("");
    try { await api(`/api/whatsapp/drafts/${encodeURIComponent(id)}/approve`, { method: "POST", body: "{}" }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send draft"); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect WhatsApp? Imported relationship history will be preserved.")) return;
    setBusy(true); setError("");
    try { await api("/api/whatsapp", { method: "DELETE" }); setChats([]); setDrafts([]); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not disconnect WhatsApp"); }
    finally { setBusy(false); }
  };

  const runtime = status.runtime?.state;
  const connected = runtime?.status === "connected";
  const selectClass = "min-w-0 rounded-lg border border-hairline/40 bg-inset px-2.5 py-2 text-[13px] text-ink focus:outline-none";

  return (
    <Card title="WhatsApp agent" subtitle="Pair your personal account, import chat history, identify senders, and build a private relationship graph for your agents.">
      <div className="flex flex-col gap-4">
        {error && <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}
        {!connected && runtime?.qr ? (
          <div className="flex flex-col items-center gap-3 rounded-xl bg-white p-4 text-center text-slate-900 sm:flex-row sm:text-left">
            <QRCodeSVG value={runtime.qr} size={156} level="M" />
            <div className="text-[13px] leading-relaxed">
              <div className="font-semibold">Scan with WhatsApp</div>
              <div>Settings → Linked devices → Link a device.</div>
              <div className="mt-2 text-[11px] text-slate-600">This uses Baileys, an unofficial linked-device client. WhatsApp may restrict unofficial clients.</div>
            </div>
          </div>
        ) : connected ? (
          <div className="rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-[13px] text-success">
            Connected{runtime.me?.name ? ` as ${runtime.me.name}` : ""} · {chats.length} chats indexed
          </div>
        ) : (
          <button type="button" disabled={busy} onClick={() => void connect()} className="self-start rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50">
            {busy || runtime?.status === "starting" ? "Starting…" : "Connect WhatsApp"}
          </button>
        )}

        {connected && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
                Default agent
                <select className={selectClass} value={status.connection?.default_bot_id ?? ""} onChange={(event) => void setPolicy(status.connection?.default_mode ?? "draft", event.target.value || null)}>
                  <option value="">No agent</option>
                  {state.bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
                Default behavior
                <select className={selectClass} value={status.connection?.default_mode ?? "draft"} onChange={(event) => void setPolicy(event.target.value as Mode, status.connection?.default_bot_id ?? null)}>
                  <option value="off">Observe only</option>
                  <option value="draft">Draft for approval</option>
                  <option value="autonomous">Reply autonomously</option>
                </select>
              </label>
            </div>
            <div className="text-[11px] leading-relaxed text-ink-secondary">Groups never auto-reply. Passwords, OTPs, payments, legal, and medical messages always fall back to approval.</div>
            {drafts.length > 0 && (
              <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
                <div className="mb-2 text-[13px] font-medium text-ink">Replies awaiting approval · {drafts.length}</div>
                <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                  {drafts.map((draft) => {
                    const chat = chats.find((item) => item.jid === draft.chat_jid);
                    return (
                      <div key={draft.id} className="rounded-lg bg-card p-2.5">
                        <div className="mb-1 truncate text-[11px] font-medium text-ink-secondary">{chat?.title || chat?.display_name || draft.chat_jid.split("@")[0]}</div>
                        <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{draft.body}</div>
                        <button type="button" disabled={busy} onClick={() => void approve(draft.id)} className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50">Approve and send</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="max-h-72 overflow-y-auto rounded-xl border border-hairline/40">
              {chats.slice(0, 100).map((chat) => (
                <div key={chat.jid} className="flex flex-col gap-2 border-b border-hairline/30 px-3 py-2.5 last:border-b-0 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink">{chat.title || chat.display_name || chat.jid.split("@")[0]}</div>
                    <div className="text-[11px] text-ink-secondary">{chat.is_group ? "Group · approval only" : `${chat.inbound_count ?? 0} in · ${chat.outbound_count ?? 0} out · relationship ${Math.round(chat.relationship_score ?? 0)}`}</div>
                  </div>
                  <select
                    aria-label={`Agent behavior for ${chat.title || chat.jid}`}
                    disabled={busy || Boolean(chat.is_group)}
                    className={`${selectClass} w-full sm:w-auto`}
                    value={chat.agent_mode}
                    onChange={(event) => void setPolicy(event.target.value as Mode | "inherit", chat.bot_id ?? status.connection?.default_bot_id ?? null, chat.jid)}
                  >
                    <option value="inherit">Use default</option>
                    <option value="off">Observe</option>
                    <option value="draft">Draft</option>
                    {!chat.is_group && <option value="autonomous">Autonomous</option>}
                  </select>
                </div>
              ))}
              {!chats.length && <div className="px-3 py-5 text-center text-[12px] text-ink-secondary">History is syncing. Keep this panel open for the initial import.</div>}
            </div>
            <button type="button" disabled={busy} onClick={() => void disconnect()} className="self-start rounded-lg border border-danger/30 px-3 py-1.5 text-[12px] text-danger hover:bg-danger/10 disabled:opacity-50">Disconnect WhatsApp</button>
          </>
        )}
      </div>
    </Card>
  );
}
