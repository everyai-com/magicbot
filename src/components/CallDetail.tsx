import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clock, Copy, Download, Loader2, Pause, Phone, Play, User, X } from "lucide-react";
import { api } from "@/state/store";
import {
  extractCallId,
  formatBilled,
  formatDuration,
  formatTime,
  needsLiveRefresh,
  normalizeLiveCall,
  withAuthToken,
  type LiveCall,
  type LiveMessage,
  type Row,
} from "@/lib/ultravox-calls";

const text = (value: unknown): string =>
  value == null || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);

const isLive = (status: string): boolean => status === "in-progress";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">{label}</div>
      <div className="mt-1 break-words text-[13px] text-ink">{children}</div>
    </div>
  );
}

function LivePill({ status }: { status: string }) {
  if (isLive(status)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">
        <span className="size-1.5 animate-pulse rounded-full bg-success" />Live
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full bg-control px-2.5 py-0.5 text-xs font-medium text-ink-secondary">{status}</span>
  );
}

/** Seconds like "1.632s" → "00:00:02". */
function hms(value: string): string {
  const match = value.trim().match(/^([\d.]+)s$/i);
  if (!match) return "";
  const total = Math.round(Number(match[1]));
  if (!Number.isFinite(total)) return "";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatPlayerTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(Math.floor(totalSeconds % 60)).padStart(2, "0")}`;
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function RecordingPlayer({ src, filename }: { src: string; filename: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <p className="text-[13px] text-ink-secondary">No recording is available for this call yet.</p>;
  }
  return (
    <div className="flex items-center gap-3 rounded-full bg-black px-4 py-3">
      <button
        type="button"
        aria-label={playing ? "Pause recording" : "Play recording"}
        onClick={() => {
          const el = audioRef.current;
          if (!el) return;
          if (el.paused) void el.play();
          else el.pause();
        }}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-white transition-opacity hover:opacity-80"
      >
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
      </button>
      <span className="shrink-0 text-xs tabular-nums text-white/80">{formatPlayerTime(current)}</span>
      <input
        type="range"
        aria-label="Seek recording"
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(current, duration || 0)}
        onChange={(e) => {
          const el = audioRef.current;
          const next = Number(e.target.value);
          if (el && Number.isFinite(next)) {
            el.currentTime = next;
            setCurrent(next);
            // Seeking jumps straight back into playback from the new position.
            if (el.paused) void el.play().catch(() => undefined);
          }
        }}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-white"
      />
      <span className="shrink-0 text-xs tabular-nums text-white/80">{formatPlayerTime(duration)}</span>
      <a
        href={src}
        download={filename}
        aria-label="Download recording"
        title="Download recording"
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-white transition-opacity hover:opacity-80"
      >
        <Download size={16} />
      </a>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

const SYSTEM_MESSAGE = /^\(New Call\)/i;

function TranscriptView({ messages }: { messages: LiveMessage[] }) {
  const [expanded, setExpanded] = useState(false);
  const turns = messages.filter((message) => !SYSTEM_MESSAGE.test(message.text.trim()));
  const shown = expanded ? turns : turns.slice(0, 3);
  return (
    <div className="space-y-4">
      {shown.map((message, index) =>
        message.role === "agent" ? (
          <div key={index}>
            <div className="mb-1 text-[12px] text-ink-secondary">
              Agent{message.start && <span className="ml-2 tabular-nums">{hms(message.start)}</span>}
            </div>
            <div className="max-w-[85%] rounded-xl rounded-tl-sm border border-hairline/40 bg-inset px-4 py-3 text-[13.5px] leading-relaxed text-ink">
              {message.text}
            </div>
          </div>
        ) : (
          <div key={index} className="flex flex-col items-end">
            <div className="mb-1 text-[12px] text-ink-secondary">
              {message.start && <span className="mr-2 tabular-nums">{hms(message.start)}</span>}User
            </div>
            <div className="max-w-[85%] rounded-xl rounded-tr-sm border border-hairline/40 bg-raised px-4 py-3 text-[13.5px] leading-relaxed text-ink">
              {message.text}
            </div>
          </div>
        ),
      )}
      {turns.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="text-[13px] font-medium text-accent hover:underline"
        >
          {expanded ? "Show less" : `View more (${turns.length - 3} more)`}
        </button>
      )}
    </div>
  );
}

export function CallDetail({ row, raw, live, onClose, onLiveUpdate }: {
  row: Row;
  raw: Row;
  live: LiveCall | null;
  onClose: () => void;
  onLiveUpdate: (live: LiveCall) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState<LiveCall | null>(live);
  const [messages, setMessages] = useState<LiveMessage[] | null>(null);
  const [messagesError, setMessagesError] = useState("");
  const [messagesLoading, setMessagesLoading] = useState(false);

  useEffect(() => {
    setCurrent(live);
  }, [live]);

  const callId = current?.callId || extractCallId(raw);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const loadMessages = useCallback(async () => {
    if (!callId) return;
    setMessagesLoading(true);
    setMessagesError("");
    try {
      const data = await api(`/api/ultravox/calls/${encodeURIComponent(callId)}/messages`);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (error) {
      setMessagesError(error instanceof Error ? error.message : "Could not load transcript.");
      setMessages(null);
    } finally {
      setMessagesLoading(false);
    }
  }, [callId]);

  useEffect(() => {
    setMessages(null);
    setMessagesError("");
    void loadMessages();
  }, [loadMessages]);

  // While the call is still live, poll the provider so the Result pill flips
  // to the final outcome on its own. Stops automatically once finalized.
  useEffect(() => {
    if (!current || !needsLiveRefresh(current.status) || !current.callId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const data = await api(`/api/ultravox/calls/${encodeURIComponent(current.callId)}`);
        if (!alive || !data || typeof data.call !== "object" || !data.call) return;
        const next = normalizeLiveCall(data.call as Row);
        setCurrent(next);
        onLiveUpdate(next);
        if (!needsLiveRefresh(next.status)) {
          void loadMessages();
          return;
        }
      } catch {
        // Keep polling through transient failures; manual refresh still works.
      }
      if (alive) timer = setTimeout(poll, 8000);
    };
    timer = setTimeout(poll, 8000);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // Re-arm only when the call identity or its status bucket changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.callId, current?.status]);

  const status = current?.status ?? text(row.Result);
  const duration = current?.durationSeconds ?? null;
  const created = current?.created || current?.joined || (typeof row.Time === "string" ? row.Time : "");
  const contact = current?.to || text(row.Contact);
  const transcript = typeof row.Transcript === "string" && row.Transcript ? row.Transcript : "";
  const summary = current?.summary || (typeof row["AI Summary"] === "string" ? row["AI Summary"] : "");
  const [copied, setCopied] = useState<"transcript" | "summary" | null>(null);

  const transcriptTurns = (messages ?? []).filter((message) => !SYSTEM_MESSAGE.test(message.text.trim()));
  const transcriptExport = transcriptTurns.length
    ? transcriptTurns
      .map((message) => `${message.role === "agent" ? "Agent" : "User"}${message.start ? ` [${hms(message.start) || message.start}]` : ""}: ${message.text}`)
      .join("\n\n")
    : transcript;

  const downloadTranscript = () => {
    if (!transcriptExport) return;
    const blob = new Blob([transcriptExport], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `transcript-${callId || "call"}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copySection = async (kind: "transcript" | "summary", value: string) => {
    if (!value) return;
    if (await copyText(value)) {
      setCopied(kind);
      setTimeout(() => setCopied((previous) => (previous === kind ? null : previous)), 2000);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-0 sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Call details"
        tabIndex={-1}
        className="flex h-[100dvh] w-full max-w-[640px] flex-col overflow-hidden bg-panel shadow-2xl outline-none sm:h-auto sm:max-h-[85vh] sm:rounded-2xl sm:border sm:border-hairline/50"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline/40 p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <Phone size={16} className="shrink-0 text-accent" />
              <span className="truncate">{text(row.Agent)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-secondary">
              <span className="inline-flex items-center gap-1"><Clock size={12} />{formatTime(created)}</span>
              <LivePill status={status} />
              {current && !isLive(status) && (
                <span className="inline-block rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">Live from provider</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close call details"
              className="flex size-9 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-raised hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Created">{formatTime(created)}</Field>
            <Field label="Contact">
              <span className="inline-flex items-center gap-1.5"><User size={13} className="text-ink-secondary" />{contact}</span>
            </Field>
            <Field label="Duration">{duration != null ? formatDuration(duration) : text(row.Duration)}</Field>
            <Field label="Result">{isLive(status) ? "Live" : status}</Field>
            <Field label="Billed">{current ? formatBilled(current.billedDuration) : formatBilled(row["Billed seconds"])}</Field>
            <Field label="Ended">{current?.ended ? formatTime(current.ended) : "—"}</Field>
          </div>
          {current?.endReason && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="End reason">{current.endReason}</Field>
              {current.from && <Field label="From">{current.from}</Field>}
            </div>
          )}

          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-ink">Recording</h3>
            {callId ? (
              <RecordingPlayer
                key={callId}
                src={withAuthToken(`/api/ultravox/calls/${encodeURIComponent(callId)}/recording`)}
                filename={`call-${callId}.wav`}
              />
            ) : (
              <p className="text-[13px] text-ink-secondary">
                This history entry has no provider call id, so no recording can be loaded.
              </p>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-ink">Transcript</h3>
              {transcriptExport ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void copySection("transcript", transcriptExport)}
                    aria-label="Copy transcript"
                    title={copied === "transcript" ? "Copied" : "Copy transcript"}
                    className="flex size-8 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-raised hover:text-ink"
                  >
                    {copied === "transcript" ? <Check size={15} className="text-success" /> : <Copy size={15} />}
                  </button>
                  <button
                    type="button"
                    onClick={downloadTranscript}
                    aria-label="Download transcript"
                    title="Download transcript"
                    className="flex size-8 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-raised hover:text-ink"
                  >
                    <Download size={15} />
                  </button>
                </div>
              ) : null}
            </div>
            {messagesLoading && !messages ? (
              <p role="status" className="flex items-center gap-2 text-[13px] text-ink-secondary">
                <Loader2 size={14} className="animate-spin" />Loading live transcript…
              </p>
            ) : messages && messages.length > 0 ? (
              <TranscriptView messages={messages} />
            ) : (
              <>
                {messagesError && <p role="alert" className="mb-2 text-[13px] text-danger">{messagesError}</p>}
                {transcript ? (
                  <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">{transcript}</p>
                ) : (
                  <p className="text-[13px] text-ink-secondary">No transcript available for this call.</p>
                )}
              </>
            )}
          </section>

          {summary && (
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-ink">AI summary</h3>
                <button
                  type="button"
                  onClick={() => void copySection("summary", summary)}
                  aria-label="Copy AI summary"
                  title={copied === "summary" ? "Copied" : "Copy AI summary"}
                  className="flex size-8 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-raised hover:text-ink"
                >
                  {copied === "summary" ? <Check size={15} className="text-success" /> : <Copy size={15} />}
                </button>
              </div>
              <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">{summary}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
