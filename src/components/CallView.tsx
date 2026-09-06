// Call mode — the bot on the line.
//
// The loop is deliberately HALF-DUPLEX: the microphone is live only when
// the bot is not speaking. The dictation helper is Apple's SFSpeechRecognizer
// running on raw AVAudioEngine input with no acoustic echo cancellation, so
// a mic left open through playback transcribes the bot's own voice back into
// the conversation and the two of them talk forever. Interrupting is a tap
// or Escape instead, which is honest and cannot feed back. (Full-duplex
// barge-in needs AEC on the capture path — a follow-up, not a footnote.)
//
// Turn-taking uses a small silence endpointer in the native helper. Apple's
// buffer-backed recognizer does not finalize on silence by itself: the helper
// has to end the audio stream, which then produces the final transcript.
//
// The other half of making a call bearable is narration. An agent turn is
// 5-60 seconds of tool calls; silence that long reads as a dropped call. So
// every activity chip the harness narrates (`tool.spoken`) is read aloud as
// it happens, which is why waiting feels like listening to someone work
// rather than listening to nothing.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, Loader2, Mic, MicOff, MonitorSmartphone, Phone, PhoneOff, Volume2, X } from "lucide-react";

import { api, useStore, visibleMessages, type Bot } from "@/state/store";
import { currentCall, deferCallCleanup, endCall, useOnCall } from "@/lib/call";
import { speaker } from "@/lib/tts";
import { useSpeech } from "@/lib/tts/useSpeech";
import { usePushToTalk } from "@/lib/push-to-talk";
import { MausAvatar } from "./Avatar";
import { pendingApprovals } from "./PendingApproval";
import { cn } from "@/lib/cn";
import { track } from "@/lib/analytics";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { speechInput } from "@/lib/speech-input";
import type { Transcript, UltravoxSession } from "ultravox-client";

/** Spoken answers to a permission card. Anything else is read as a reply
 * to the bot, not as consent — an approval must never be granted by a
 * sentence that merely contained the word "sure". */
const YES = /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|allow|approve|approved|fine|please do)\b/i;
const NO = /^(no|nope|don'?t|do not|stop|deny|denied|cancel|never|skip it)\b/i;

type Phase = "listening" | "sending" | "working" | "speaking";
const CALL_ENDPOINT_MS = 850;

type DemoCallStatus = "disconnected" | "disconnecting" | "connecting" | "idle" | "listening" | "thinking" | "speaking";
type DemoTranscriptItem = Pick<Transcript, "ordinal" | "text" | "speaker" | "isFinal" | "medium">;

type OutboundCaller = {
  id: string;
  phoneNumber: string;
  provider?: string;
  friendlyName?: string;
};

type OutboundAgentOption = {
  id: string;
  name: string;
  remoteAgentId: string;
  phoneConfigId?: string;
};

type DemoAgentOption = {
  id: string;
  name: string;
  remoteAgentId?: string;
  voice?: string;
  maxDurationSeconds?: number;
};

function normalizeOutboundCaller(row: unknown): OutboundCaller | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const id = String(record.id ?? record._id ?? "");
  const phoneNumber = String(record.phone_number ?? record.phoneNumber ?? "");
  if (!id || !phoneNumber) return null;
  return {
    id,
    phoneNumber,
    provider: typeof record.provider === "string" ? record.provider : undefined,
    friendlyName: typeof record.friendly_name === "string" ? record.friendly_name : typeof record.friendlyName === "string" ? record.friendlyName : undefined,
  };
}

function providerLabel(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "twilio") return "Twilio";
  if (normalized === "telnyx") return "Telnyx";
  return value?.trim() || "";
}

function serializeDemoTranscripts(transcripts: Transcript[]): DemoTranscriptItem[] {
  return transcripts
    .map((item) => ({
      ordinal: item.ordinal,
      text: item.text,
      speaker: item.speaker,
      isFinal: item.isFinal,
      medium: item.medium,
    }))
    .sort((a, b) => a.ordinal - b.ordinal);
}

function demoStatusLabel(status: DemoCallStatus): string {
  if (status === "idle") return "Listening";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function CallButton({ bot }: { bot: Bot }) {
  return (
    <CallTargetButton
      targetId={bot.id}
      targetName={bot.name}
      voices={[bot.agentConfig?.voices || bot.voice]}
      setupBotId={bot.id}
      remoteAgentId={bot.remoteAgentId}
      phoneConfigId={bot.agentConfig?.phoneNumberId}
      callerNumber={bot.agentConfig?.phoneNumber}
      requireExplicitVoices={false}
      onStart={() => track("call_started", { driver: bot.modelSelection?.instanceId })}
    />
  );
}

export function CallTargetButton({
  targetId,
  targetName,
  voices,
  setupBotId,
  remoteAgentId,
  phoneConfigId,
  callerNumber,
  requireExplicitVoices,
  onStart,
}: {
  targetId: string;
  targetName: string;
  voices: Array<string | undefined>;
  /** Agent profile to open when voice setup is missing (rooms choose a member). */
  setupBotId?: string;
  /** Hosted MagicTeams agent id used for real outbound phone calls. */
  remoteAgentId?: string;
  /** Hosted phone configuration assigned to the agent. */
  phoneConfigId?: string;
  /** Human-readable caller number assigned to the agent. */
  callerNumber?: string;
  /** Rooms cannot rely on one workspace fallback for multiple speakers. */
  requireExplicitVoices: boolean;
  onStart: () => void;
}) {
  const { state, dispatch } = useStore();
  const { capabilities, ready: capabilitiesReady } = useDesktopCapabilities();
  const active = useOnCall() === targetId;
  const supported = capabilities.dictation.available && speechInput.available();
  const legacyTtsConfigured = Boolean(state.config?.tts?.configured);
  const everyTargetHasVoice = voices.length > 0 && voices.every((voice) => Boolean(voice));
  const voiceReady =
    legacyTtsConfigured &&
    (requireExplicitVoices
      ? everyTargetHasVoice
      : Boolean(state.config?.tts?.ready || everyTargetHasVoice));
  const legacyCallUnavailable = !active && (!capabilitiesReady || !supported || !voiceReady);
  const voiceSetupRequired = capabilitiesReady && supported && !voiceReady;
  const [helpOpen, setHelpOpen] = useState(false);
  const [callOptionsOpen, setCallOptionsOpen] = useState(false);
  const [callMode, setCallMode] = useState<"choose" | "demo" | "outbound">("choose");
  const [outboundRecipient, setOutboundRecipient] = useState("");
  const [outboundSaving, setOutboundSaving] = useState(false);
  const [outboundError, setOutboundError] = useState("");
  const [outboundCaller, setOutboundCaller] = useState<OutboundCaller | null>(null);
  const [outboundCallers, setOutboundCallers] = useState<OutboundCaller[]>([]);
  const [outboundCallerLoading, setOutboundCallerLoading] = useState(false);
  const [outboundCallerError, setOutboundCallerError] = useState("");
  const [selectedDemoAgentId, setSelectedDemoAgentId] = useState(targetId);
  const [selectedOutboundAgentId, setSelectedOutboundAgentId] = useState(remoteAgentId ?? "");
  const [selectedOutboundPhoneConfigId, setSelectedOutboundPhoneConfigId] = useState(phoneConfigId ?? "");
  const [demoStatus, setDemoStatus] = useState<DemoCallStatus>("disconnected");
  const [demoTranscripts, setDemoTranscripts] = useState<DemoTranscriptItem[]>([]);
  const [demoStartedAt, setDemoStartedAt] = useState<string | null>(null);
  const [demoCallId, setDemoCallId] = useState<string | null>(null);
  const [demoLogId, setDemoLogId] = useState<string | null>(null);
  const [demoError, setDemoError] = useState("");
  const [demoStarting, setDemoStarting] = useState(false);
  const [demoEnding, setDemoEnding] = useState(false);
  const [demoMicMuted, setDemoMicMuted] = useState(false);
  const [demoSpeakerMuted, setDemoSpeakerMuted] = useState(false);
  const [demoInCallOpen, setDemoInCallOpen] = useState(false);
  const demoSessionRef = useRef<UltravoxSession | null>(null);
  const demoCleanupRef = useRef<(() => void) | null>(null);
  const demoStartedAtMsRef = useRef<number | null>(null);
  const demoCallIdRef = useRef<string | null>(null);
  const demoLogIdRef = useRef<string | null>(null);
  const demoTranscriptsRef = useRef<DemoTranscriptItem[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const helpId = useId();
  const outboundAgents = useMemo<OutboundAgentOption[]>(
    () =>
      state.bots
        .filter((candidate) => candidate.remoteAgentId && !candidate.hidden)
        .map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          remoteAgentId: candidate.remoteAgentId ?? "",
          phoneConfigId: candidate.agentConfig?.phoneNumberId,
        })),
    [state.bots],
  );
  const demoAgents = useMemo<DemoAgentOption[]>(
    () =>
      state.bots
        .filter((candidate) => !candidate.hidden)
        .map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          remoteAgentId: candidate.remoteAgentId,
          voice: candidate.agentConfig?.voices || candidate.voice,
          maxDurationSeconds: candidate.agentConfig?.maxDuration,
        })),
    [state.bots],
  );
  const selectedDemoAgent = demoAgents.find((candidate) => candidate.id === selectedDemoAgentId);
  const selectedDemoBot = state.bots.find((candidate) => candidate.id === selectedDemoAgentId);
  const selectedOutboundAgent = outboundAgents.find((candidate) => candidate.remoteAgentId === selectedOutboundAgentId);
  const selectedOutboundCaller = outboundCallers.find((candidate) => candidate.id === selectedOutboundPhoneConfigId) ?? outboundCaller;
  const browserCanJoinDemo = Boolean(navigator.mediaDevices && "getUserMedia" in navigator.mediaDevices && "WebSocket" in window);
  const selectedDemoRemoteAgentId = selectedDemoAgent?.remoteAgentId ?? (selectedDemoAgent?.id === targetId ? remoteAgentId : undefined);
  const demoAvailable = Boolean(selectedDemoRemoteAgentId && browserCanJoinDemo);
  const demoUnavailableReason = !selectedDemoRemoteAgentId
    ? "Demo calls need a hosted MagicTeams agent connected to Ultravox."
    : !browserCanJoinDemo
      ? "This browser cannot open the microphone/WebRTC session needed for demo calls."
      : "";
  const label = active
    ? `Hang up on ${targetName}`
    : !capabilitiesReady
      ? "Checking call availability"
      : `Call ${targetName}`;

  const reason = !capabilitiesReady
    ? "Checking whether this device can make calls."
    : !capabilities.dictation.available
      ? "This browser does not provide speech recognition. Try Chrome, Edge, or the desktop app."
      : !speechInput.available()
        ? "The speech service is unavailable. Reload the page or restart MagicTeams."
        : !legacyTtsConfigured
          ? "Local fallback calls need a text-to-speech key. Demo calls use the hosted Ultravox browser session."
          : !voiceReady
            ? voices.length > 1
              ? "Give every team member a MagicTeams voice before starting a team call."
              : "Choose a MagicTeams voice before starting a call."
            : "";

  useEffect(() => {
    if (!helpOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setHelpOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setHelpOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [helpOpen]);

  useEffect(() => {
    if (!callOptionsOpen || callMode !== "outbound") return;
    if (!selectedOutboundAgentId && outboundAgents[0]?.remoteAgentId) {
      setSelectedOutboundAgentId(outboundAgents[0].remoteAgentId);
      if (outboundAgents[0].phoneConfigId) setSelectedOutboundPhoneConfigId(outboundAgents[0].phoneConfigId);
    }
    if (!selectedOutboundPhoneConfigId && outboundCallers[0]?.id) {
      setSelectedOutboundPhoneConfigId(outboundCallers[0].id);
    }
  }, [callOptionsOpen, callMode, outboundAgents, outboundCallers, selectedOutboundAgentId, selectedOutboundPhoneConfigId]);

  useEffect(() => {
    if (!callOptionsOpen || callMode !== "outbound") {
      setOutboundCaller(null);
      setOutboundCallers([]);
      setOutboundCallerLoading(false);
      setOutboundCallerError("");
      return;
    }
    let alive = true;
    setOutboundCallerLoading(true);
    setOutboundCallerError("");
    api("/api/platform/phone-configs")
      .then((result: { phoneConfigs?: unknown }) => {
        if (!alive) return;
        const rows = Array.isArray(result.phoneConfigs) ? result.phoneConfigs : [];
        const callers = rows.map(normalizeOutboundCaller).filter((config): config is OutboundCaller => Boolean(config));
        const caller =
          callers.find((config) => config.id === selectedOutboundPhoneConfigId) ??
          callers.find((config) => config.id === phoneConfigId) ??
          null;
        setOutboundCallers(callers);
        setOutboundCaller(caller);
        if (!selectedOutboundPhoneConfigId && caller) setSelectedOutboundPhoneConfigId(caller.id);
      })
      .catch((error) => {
        if (!alive) return;
        setOutboundCallerError(error instanceof Error ? error.message : "Could not load calling number.");
      })
      .finally(() => {
        if (alive) setOutboundCallerLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [callOptionsOpen, callMode, phoneConfigId, selectedOutboundPhoneConfigId]);

  const finalizeDemoCall = useCallback(async (finalStatus: "completed" | "failed" | "cancelled") => {
    const logId = demoLogIdRef.current;
    if (!logId) return;
    const duration = demoStartedAtMsRef.current ? Math.max(0, Math.round((Date.now() - demoStartedAtMsRef.current) / 1000)) : 0;
    try {
      await api("/api/platform/demo-calls/finalize", {
        method: "POST",
        body: JSON.stringify({
          log_id: logId,
          status: finalStatus,
          ended_at: new Date().toISOString(),
          duration,
          transcript: demoTranscriptsRef.current,
          ultravox_call_id: demoCallIdRef.current ?? undefined,
        }),
      });
    } catch (error) {
      setDemoError(error instanceof Error ? error.message : "Demo call finalization failed.");
    }
  }, []);

  const resetDemoCall = useCallback(() => {
    demoCleanupRef.current?.();
    demoCleanupRef.current = null;
    demoSessionRef.current = null;
    demoStartedAtMsRef.current = null;
    demoCallIdRef.current = null;
    demoLogIdRef.current = null;
    demoTranscriptsRef.current = [];
    setDemoStatus("disconnected");
    setDemoTranscripts([]);
    setDemoStartedAt(null);
    setDemoCallId(null);
    setDemoLogId(null);
    setDemoMicMuted(false);
    setDemoSpeakerMuted(false);
    setDemoStarting(false);
    setDemoEnding(false);
    setDemoInCallOpen(false);
  }, []);

  const endDemoCall = useCallback(async (finalStatus: "completed" | "failed" | "cancelled" = "completed") => {
    const session = demoSessionRef.current;
    setDemoEnding(true);
    setDemoError("");
    try {
      await session?.leaveCall();
      await finalizeDemoCall(finalStatus);
    } catch (error) {
      setDemoError(error instanceof Error ? error.message : "Demo call could not be ended.");
    } finally {
      resetDemoCall();
    }
  }, [finalizeDemoCall, resetDemoCall]);

  const startDemoCall = useCallback(async () => {
    const agent = demoAgents.find((candidate) => candidate.id === selectedDemoAgentId);
    const remoteId = agent?.remoteAgentId ?? (agent?.id === targetId ? remoteAgentId : undefined);
    if (!remoteId) {
      setDemoError("Select a hosted MagicTeams agent before starting a demo call.");
      return;
    }
    if (!browserCanJoinDemo) {
      setDemoError("This browser cannot open the microphone/WebRTC session needed for demo calls.");
      return;
    }

    setDemoStarting(true);
    setDemoError("");
    setDemoTranscripts([]);
    demoTranscriptsRef.current = [];
    try {
      await endDemoCall("cancelled").catch(() => undefined);
      const created = await api(`/api/platform/agents/${encodeURIComponent(remoteId)}/demo-call`, {
        method: "POST",
        body: JSON.stringify({
          voice: agent?.voice || undefined,
          maxDurationSeconds: agent?.maxDurationSeconds,
        }),
      }) as { joinUrl?: string; callId?: string | null; logId?: string | null };
      if (!created.joinUrl) throw new Error("Demo call did not return a join URL.");

      const { UltravoxSession } = await import("ultravox-client");
      const session = new UltravoxSession();
      const onStatus = () => {
        setDemoStatus(session.status as DemoCallStatus);
        if (session.status === "disconnected") setDemoEnding(false);
      };
      const onTranscripts = () => {
        const items = serializeDemoTranscripts(session.transcripts);
        demoTranscriptsRef.current = items;
        setDemoTranscripts(items);
      };
      const onError = (event: Event) => {
        const detail = event as Event & { error?: Error };
        setDemoError(detail.error?.message || "Demo call ended unexpectedly.");
        void finalizeDemoCall("failed");
      };
      session.addEventListener("status", onStatus);
      session.addEventListener("transcripts", onTranscripts);
      session.addEventListener("error", onError);
      demoCleanupRef.current = () => {
        session.removeEventListener("status", onStatus);
        session.removeEventListener("transcripts", onTranscripts);
        session.removeEventListener("error", onError);
      };
      demoSessionRef.current = session;
      demoStartedAtMsRef.current = Date.now();
      demoCallIdRef.current = created.callId ?? null;
      demoLogIdRef.current = created.logId ?? null;
      setDemoStartedAt(new Date().toISOString());
      setDemoCallId(created.callId ?? null);
      setDemoLogId(created.logId ?? null);
      setDemoStatus(session.status as DemoCallStatus);
      session.joinCall(created.joinUrl);
      setCallOptionsOpen(false);
      setDemoInCallOpen(true);
      onStart();
    } catch (error) {
      setDemoError(error instanceof Error ? error.message : "Demo call could not be started.");
      resetDemoCall();
    } finally {
      setDemoStarting(false);
    }
  }, [browserCanJoinDemo, demoAgents, endDemoCall, finalizeDemoCall, onStart, remoteAgentId, resetDemoCall, selectedDemoAgentId, targetId]);

  useEffect(() => {
    return () => {
      void demoSessionRef.current?.leaveCall();
      demoCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!demoInCallOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void endDemoCall("completed");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [demoInCallOpen, endDemoCall]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        onClick={() => {
          if (active) return endCall(targetId);
          setHelpOpen(false);
          setCallMode("choose");
          setOutboundError("");
          setSelectedDemoAgentId(targetId);
          setSelectedOutboundAgentId(remoteAgentId ?? "");
          setSelectedOutboundPhoneConfigId(phoneConfigId ?? "");
          setCallOptionsOpen(true);
        }}
        aria-expanded={legacyCallUnavailable ? helpOpen : undefined}
        aria-controls={legacyCallUnavailable ? helpId : undefined}
        aria-label={label}
        title={label}
        className={cn(
          "relative flex size-9 items-center justify-center rounded-full transition-colors",
          active
            ? "bg-danger text-white hover:brightness-110"
            : legacyCallUnavailable
              ? "text-ink-secondary/50 hover:bg-raised hover:text-ink-secondary"
              : "text-ink-secondary hover:bg-raised hover:text-ink",
        )}
      >
        {active ? <PhoneOff size={17} /> : <Phone size={17} />}
        {legacyCallUnavailable && (
          <span className="absolute right-1 top-1 size-1.5 rounded-full bg-warning ring-2 ring-app" aria-hidden="true" />
        )}
      </button>

      {legacyCallUnavailable && helpOpen && (
        <div
          id={helpId}
          role="group"
          aria-label="Call unavailable"
          className="animate-pop-in absolute right-0 z-30 mt-1.5 w-[280px] rounded-xl border border-hairline bg-panel p-3 text-left shadow-2xl"
        >
          <div className="text-[13px] font-medium text-ink">Call unavailable</div>
          <div className="mt-1 text-[12px] leading-[1.45] text-ink-secondary">{reason}</div>
          {voiceSetupRequired && (
            <button
              type="button"
              onClick={() => {
                setHelpOpen(false);
                if (setupBotId && setupBotId !== targetId) dispatch({ type: "select", id: setupBotId });
                dispatch({ type: "toggleSettings", open: true });
              }}
              className="mt-2.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:brightness-110"
            >
              Open agent settings
            </button>
          )}
        </div>
      )}

      {callOptionsOpen && (
        <CallOptionsDialog
          targetName={targetName}
          mode={callMode}
          recipient={outboundRecipient}
          demoAgents={demoAgents}
          selectedDemoAgentId={selectedDemoAgentId}
          agents={outboundAgents}
          selectedAgentId={selectedOutboundAgentId}
          callerOptions={outboundCallers}
          selectedCallerId={selectedOutboundPhoneConfigId}
          callerNumber={selectedOutboundCaller?.phoneNumber || callerNumber}
          callerProvider={providerLabel(selectedOutboundCaller?.provider)}
          callerName={selectedOutboundCaller?.friendlyName}
          callerLoading={outboundCallerLoading}
          callerError={outboundCallerError}
          outboundSaving={outboundSaving}
          outboundError={outboundError}
          outboundAvailable={Boolean(selectedOutboundAgentId && selectedOutboundPhoneConfigId)}
          demoAvailable={demoAvailable}
          demoUnavailableReason={demoUnavailableReason || reason}
          voiceSetupRequired={voiceSetupRequired}
          demoStatus={demoStatus}
          demoTranscripts={demoTranscripts}
          demoStartedAt={demoStartedAt}
          demoCallId={demoCallId}
          demoLogId={demoLogId}
          demoError={demoError}
          demoStarting={demoStarting}
          demoEnding={demoEnding}
          demoMicMuted={demoMicMuted}
          demoSpeakerMuted={demoSpeakerMuted}
          onDemoAgentChange={(nextAgentId) => {
            setSelectedDemoAgentId(nextAgentId);
            setOutboundError("");
            setDemoError("");
          }}
          onAgentChange={(nextAgentId) => {
            setSelectedOutboundAgentId(nextAgentId);
            setOutboundError("");
            const nextAgent = outboundAgents.find((candidate) => candidate.remoteAgentId === nextAgentId);
            if (nextAgent?.phoneConfigId) setSelectedOutboundPhoneConfigId(nextAgent.phoneConfigId);
          }}
          onCallerChange={(nextCallerId) => {
            setSelectedOutboundPhoneConfigId(nextCallerId);
            setOutboundError("");
          }}
          onModeChange={(mode) => {
            setCallMode(mode);
            setOutboundError("");
          }}
          onRecipientChange={setOutboundRecipient}
          onClose={() => {
            if (outboundSaving) return;
            setCallOptionsOpen(false);
          }}
          onOpenVoiceSettings={() => {
            setCallOptionsOpen(false);
            if (setupBotId && setupBotId !== targetId) dispatch({ type: "select", id: setupBotId });
            dispatch({ type: "toggleSettings", open: true });
          }}
          onDemoCall={startDemoCall}
          onEndDemoCall={() => void endDemoCall("completed")}
          onToggleDemoMic={() => {
            const session = demoSessionRef.current;
            if (!session) return;
            session.toggleMicMute();
            setDemoMicMuted(session.isMicMuted);
          }}
          onToggleDemoSpeaker={() => {
            const session = demoSessionRef.current;
            if (!session) return;
            session.toggleSpeakerMute();
            setDemoSpeakerMuted(session.isSpeakerMuted);
          }}
          onOutboundCall={async () => {
            const recipient = outboundRecipient.trim();
            if (!recipient) {
              setOutboundError("Enter the phone number to call.");
              return;
            }
            if (!selectedOutboundAgentId || !selectedOutboundPhoneConfigId) {
              setOutboundError("Assign a hosted agent phone number before starting an outbound call.");
              return;
            }
            setOutboundSaving(true);
            setOutboundError("");
            try {
              await api(`/api/platform/agents/${encodeURIComponent(selectedOutboundAgentId)}/outbound-call`, {
                method: "POST",
                body: JSON.stringify({
                  phone_config_id: selectedOutboundPhoneConfigId,
                  recipient_number: recipient,
                }),
              });
              track("outbound_call_started", { targetId, agentId: selectedOutboundAgent?.id });
              setCallOptionsOpen(false);
              setOutboundRecipient("");
            } catch (error) {
              setOutboundError(error instanceof Error ? error.message : "Outbound call could not be started.");
            } finally {
              setOutboundSaving(false);
            }
          }}
        />
      )}

      {demoInCallOpen && (
        <DemoCallOverlay
          bot={selectedDemoBot}
          fallbackName={selectedDemoAgent?.name || targetName}
          status={demoStatus}
          transcripts={demoTranscripts}
          error={demoError}
          ending={demoEnding}
          micMuted={demoMicMuted}
          speakerMuted={demoSpeakerMuted}
          onEnd={() => void endDemoCall("completed")}
          onToggleMic={() => {
            const session = demoSessionRef.current;
            if (!session) return;
            session.toggleMicMute();
            setDemoMicMuted(session.isMicMuted);
          }}
          onToggleSpeaker={() => {
            const session = demoSessionRef.current;
            if (!session) return;
            session.toggleSpeakerMute();
            setDemoSpeakerMuted(session.isSpeakerMuted);
          }}
        />
      )}
    </div>
  );
}

function DemoCallOverlay({
  bot,
  fallbackName,
  status,
  transcripts,
  error,
  ending,
  micMuted,
  speakerMuted,
  onEnd,
  onToggleMic,
  onToggleSpeaker,
}: {
  bot?: Bot;
  fallbackName: string;
  status: DemoCallStatus;
  transcripts: DemoTranscriptItem[];
  error: string;
  ending: boolean;
  micMuted: boolean;
  speakerMuted: boolean;
  onEnd: () => void;
  onToggleMic: () => void;
  onToggleSpeaker: () => void;
}) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const connected = status !== "disconnected" && status !== "disconnecting";
  const busy = status === "connecting" || status === "thinking" || status === "disconnecting";
  const mascotState =
    status === "listening"
      ? "listening"
      : status === "speaking"
        ? "sending"
        : status === "thinking" || status === "connecting"
          ? "thinking"
          : status === "idle"
            ? "happy"
            : "idle";

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [transcripts]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-app/95 px-5 py-8 backdrop-blur-sm">
      <button
        type="button"
        onClick={onEnd}
        disabled={ending}
        aria-label="Hang up"
        className="absolute right-5 top-5 rounded-md p-2 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-60"
      >
        <X size={18} />
      </button>

      <MausAvatar
        color={bot?.color ?? "pink"}
        state={mascotState}
        size={220}
        animated
        trackPointer
        personality={bot?.personality}
      />

      <div className="flex flex-col items-center gap-1.5 text-center">
        <div className="text-[20px] font-medium text-ink">{bot?.name || fallbackName}</div>
        <div className="flex min-h-5 items-center gap-2 text-[13.5px] text-ink-secondary">
          {busy && <Loader2 size={13} className="animate-spin" />}
          {demoStatusLabel(status)}
        </div>
      </div>

      <div className="flex w-full max-w-[640px] flex-col items-center gap-2">
        <div className="text-[12px] font-semibold uppercase text-ink-secondary">Live Transcript</div>
        <div
          ref={transcriptRef}
          className="max-h-[220px] min-h-[110px] w-full overflow-y-auto rounded-2xl border border-hairline bg-card/85 p-3 shadow-xl"
        >
          {transcripts.length === 0 ? (
            <div className="flex min-h-[84px] items-center justify-center text-center text-[14px] text-ink-secondary">
              {connected ? "Say something..." : "Connecting..."}
            </div>
          ) : (
            <div className="space-y-2">
              {transcripts.map((item) => (
                <div
                  key={item.ordinal}
                  className={cn(
                    "max-w-[88%] rounded-xl px-3 py-2",
                    item.speaker === "agent" ? "ml-auto bg-accent/15" : "bg-raised",
                  )}
                >
                  <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase text-ink-secondary">
                    <span>{item.speaker === "agent" ? bot?.name || fallbackName : "You"}</span>
                    {!item.isFinal && <span className="rounded-full bg-control px-1.5 py-0.5 normal-case">Live</span>}
                  </div>
                  <div className="whitespace-pre-wrap text-[13px] leading-[1.45] text-ink">{item.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <div className="max-w-[520px] text-center text-[12.5px] text-danger">{error}</div>}

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onToggleMic}
          disabled={!connected || ending}
          className="flex items-center gap-2 rounded-full border border-hairline px-4 py-2 text-[13.5px] text-ink hover:bg-raised disabled:opacity-60"
        >
          {micMuted ? <MicOff size={16} /> : <Mic size={16} />}
          {micMuted ? "Unmute mic" : "Mute mic"}
        </button>
        <button
          type="button"
          onClick={onToggleSpeaker}
          disabled={!connected || ending}
          className="flex items-center gap-2 rounded-full border border-hairline px-4 py-2 text-[13.5px] text-ink hover:bg-raised disabled:opacity-60"
        >
          <Volume2 size={16} />
          {speakerMuted ? "Unmute speaker" : "Mute speaker"}
        </button>
        <button
          type="button"
          onClick={onEnd}
          disabled={ending}
          className="flex min-w-[124px] items-center justify-center gap-2 rounded-full bg-danger px-5 py-2.5 text-[14px] font-medium text-white hover:brightness-110 disabled:opacity-70"
        >
          {ending ? <Loader2 size={16} className="animate-spin" /> : <PhoneOff size={16} />}
          {ending ? "Ending..." : "Hang up"}
        </button>
      </div>

      <div className="text-[11.5px] text-ink-secondary/70">Esc hangs up</div>
    </div>
  );
}

function CallOptionsDialog({
  targetName,
  mode,
  recipient,
  demoAgents,
  selectedDemoAgentId,
  agents,
  selectedAgentId,
  callerOptions,
  selectedCallerId,
  callerNumber,
  callerProvider,
  callerName,
  callerLoading,
  callerError,
  outboundSaving,
  outboundError,
  outboundAvailable,
  demoAvailable,
  demoUnavailableReason,
  voiceSetupRequired,
  demoStatus,
  demoTranscripts,
  demoStartedAt,
  demoCallId,
  demoLogId,
  demoError,
  demoStarting,
  demoEnding,
  demoMicMuted,
  demoSpeakerMuted,
  onDemoAgentChange,
  onAgentChange,
  onCallerChange,
  onModeChange,
  onRecipientChange,
  onClose,
  onOpenVoiceSettings,
  onDemoCall,
  onEndDemoCall,
  onToggleDemoMic,
  onToggleDemoSpeaker,
  onOutboundCall,
}: {
  targetName: string;
  mode: "choose" | "demo" | "outbound";
  recipient: string;
  demoAgents: DemoAgentOption[];
  selectedDemoAgentId: string;
  agents: OutboundAgentOption[];
  selectedAgentId: string;
  callerOptions: OutboundCaller[];
  selectedCallerId: string;
  callerNumber?: string;
  callerProvider?: string;
  callerName?: string;
  callerLoading: boolean;
  callerError: string;
  outboundSaving: boolean;
  outboundError: string;
  outboundAvailable: boolean;
  demoAvailable: boolean;
  demoUnavailableReason: string;
  voiceSetupRequired: boolean;
  demoStatus: DemoCallStatus;
  demoTranscripts: DemoTranscriptItem[];
  demoStartedAt: string | null;
  demoCallId: string | null;
  demoLogId: string | null;
  demoError: string;
  demoStarting: boolean;
  demoEnding: boolean;
  demoMicMuted: boolean;
  demoSpeakerMuted: boolean;
  onDemoAgentChange: (value: string) => void;
  onAgentChange: (value: string) => void;
  onCallerChange: (value: string) => void;
  onModeChange: (mode: "choose" | "demo" | "outbound") => void;
  onRecipientChange: (value: string) => void;
  onClose: () => void;
  onOpenVoiceSettings: () => void;
  onDemoCall: () => void;
  onEndDemoCall: () => void;
  onToggleDemoMic: () => void;
  onToggleDemoSpeaker: () => void;
  onOutboundCall: () => void;
}) {
  const title = mode === "outbound" ? "Place a Call" : mode === "demo" ? "Demo Call" : "Call options";
  const selectedDemoAgent = demoAgents.find((agent) => agent.id === selectedDemoAgentId);
  const demoLive = demoStatus !== "disconnected" && demoStatus !== "disconnecting";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6">
      <div
        className={cn(
          "animate-pop-in flex max-h-[86vh] w-full flex-col overflow-hidden rounded-2xl border border-hairline bg-panel shadow-2xl",
          mode === "demo" ? "max-w-[980px]" : "max-w-[560px]",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-5">
          <div className="flex min-w-0 items-start gap-3">
            {mode !== "choose" && (
              <button
                type="button"
                onClick={() => onModeChange("choose")}
                disabled={outboundSaving}
                className="mt-[-3px] flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-60"
                aria-label="Back to call options"
                title="Back"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            <div className="min-w-0">
              <div className="text-[18px] font-semibold text-ink">{title}</div>
              <div className="mt-1 text-[13px] text-ink-secondary">{targetName}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={outboundSaving}
            className="rounded-lg p-1.5 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-60"
            aria-label="Close call options"
          >
            <X size={18} />
          </button>
        </div>

        {mode === "choose" ? (
          <div className="space-y-3 px-6 py-5">
            <button
              type="button"
              onClick={() => onModeChange("demo")}
              className="flex w-full items-center gap-4 rounded-xl border border-hairline bg-card p-4 text-left hover:border-accent/60 hover:bg-raised"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white">
                <Phone size={18} />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold text-ink">Demo Call</span>
                <span className="mt-1 block text-[13px] leading-[1.4] text-ink-secondary">
                  {demoAvailable ? "Start a browser call with this agent." : demoUnavailableReason}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => onModeChange("outbound")}
              className="flex w-full items-center gap-4 rounded-xl border border-hairline bg-card p-4 text-left hover:border-accent/60 hover:bg-raised"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-raised text-ink">
                <Phone size={18} />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold text-ink">Outbound Call</span>
                <span className="mt-1 block text-[13px] leading-[1.4] text-ink-secondary">
                  Dial a phone number using this agent's calling setup.
                </span>
              </span>
            </button>
          </div>
        ) : mode === "demo" ? (
          <div className="space-y-5 overflow-y-auto px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[22px] font-semibold text-ink">
                  <MonitorSmartphone size={24} />
                  <span>Start Demo Call</span>
                </div>
                <div className="mt-1 text-[14px] text-ink-secondary">Use your microphone to talk to the selected agent without placing a phone call.</div>
              </div>
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-[12px] font-semibold",
                  demoLive ? "bg-success/15 text-success" : "bg-raised text-ink-secondary",
                )}
              >
                {demoStarting ? "Connecting" : demoStatusLabel(demoStatus)}
              </span>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
              <label className="block">
                <span className="text-[13px] font-medium text-ink">Agent</span>
                <select
                  value={selectedDemoAgentId}
                  onChange={(event) => onDemoAgentChange(event.target.value)}
                  disabled={demoAgents.length === 0}
                  className="mt-2 h-11 w-full rounded-xl border border-hairline bg-card px-4 text-[14px] text-ink outline-none focus:border-accent disabled:opacity-60"
                >
                  {!selectedDemoAgentId && <option value="">Select an agent</option>}
                  {demoAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="rounded-xl border border-hairline bg-card p-4">
                <div className="text-[14px] font-semibold text-ink">Selected Agent</div>
                <div className="mt-2 text-[13px] leading-[1.45] text-ink-secondary">
                  {selectedDemoAgent ? selectedDemoAgent.name : "Choose an agent to start the browser demo call."}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onDemoCall}
                disabled={!demoAvailable || !selectedDemoAgentId || demoLive || demoStarting || demoEnding}
                className="inline-flex min-w-[150px] items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-white hover:brightness-110 disabled:bg-raised disabled:text-ink-secondary"
              >
                {demoStarting ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
                {demoStarting ? "Starting..." : "Start Demo Call"}
              </button>
              <button
                type="button"
                onClick={onEndDemoCall}
                disabled={!demoLive || demoEnding}
                className="inline-flex min-w-[140px] items-center justify-center gap-2 rounded-xl border border-hairline px-4 py-2.5 text-[13px] font-semibold text-ink-secondary disabled:opacity-60"
              >
                {demoEnding ? <Loader2 size={16} className="animate-spin" /> : <MicOff size={16} />}
                {demoEnding ? "Ending..." : "End Demo Call"}
              </button>
              <button
                type="button"
                onClick={onToggleDemoMic}
                disabled={!demoLive}
                className="inline-flex min-w-[120px] items-center justify-center gap-2 rounded-xl border border-hairline px-4 py-2.5 text-[13px] font-semibold text-ink-secondary disabled:opacity-60"
              >
                {demoMicMuted ? <MicOff size={16} /> : <Mic size={16} />}
                {demoMicMuted ? "Unmute Mic" : "Mute Mic"}
              </button>
              <button
                type="button"
                onClick={onToggleDemoSpeaker}
                disabled={!demoLive}
                className="inline-flex min-w-[140px] items-center justify-center gap-2 rounded-xl border border-hairline px-4 py-2.5 text-[13px] font-semibold text-ink-secondary disabled:opacity-60"
              >
                <Volume2 size={16} />
                {demoSpeakerMuted ? "Unmute Speaker" : "Mute Speaker"}
              </button>
            </div>

            {demoError && (
              <div className="rounded-xl border border-danger/35 bg-danger/10 px-4 py-3 text-[13px] leading-[1.45] text-danger">
                {demoError}
              </div>
            )}
            {!demoAvailable && demoUnavailableReason && (
              <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-[13px] leading-[1.45] text-warning">
                {demoUnavailableReason}
              </div>
            )}
            {!demoAvailable && demoUnavailableReason && voiceSetupRequired && (
              <button
                type="button"
                onClick={onOpenVoiceSettings}
                className="w-fit rounded-lg bg-control px-3 py-2 text-[13px] font-medium text-ink hover:bg-raised"
              >
                Open agent settings
              </button>
            )}

            <div className="grid gap-4 border-t border-hairline pt-5 lg:grid-cols-[260px_1fr]">
              <div className="rounded-xl border border-hairline bg-card p-4">
                <div className="text-[14px] font-semibold text-ink">Session Details</div>
                <div className="mt-5 text-[13px] text-ink-secondary">Agent</div>
                <div className="mt-1 text-[14px] font-semibold text-ink">{selectedDemoAgent?.name || "Not selected"}</div>
                <div className="mt-5 text-[13px] text-ink-secondary">Started At</div>
                <div className="mt-1 text-[14px] font-semibold text-ink">
                  {demoStartedAt ? new Date(demoStartedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Not started"}
                </div>
                <div className="mt-5 text-[13px] text-ink-secondary">Transcript Items</div>
                <div className="mt-1 text-[14px] font-semibold text-ink">{demoTranscripts.length}</div>
                {(demoCallId || demoLogId) && (
                  <>
                    <div className="mt-5 text-[13px] text-ink-secondary">Call</div>
                    <div className="mt-1 break-all text-[12px] font-semibold text-ink">{demoCallId || demoLogId}</div>
                  </>
                )}
              </div>
              <div className="rounded-xl border border-hairline bg-card">
                <div className="border-b border-hairline px-4 py-3">
                  <div className="text-[14px] font-semibold text-ink">Live Transcript</div>
                  <div className="mt-1 text-[12px] text-ink-secondary">Real-time conversation updates appear here while the demo call is active.</div>
                </div>
                {demoTranscripts.length === 0 ? (
                  <div className="flex min-h-[180px] items-center justify-center p-6 text-center text-[13px] text-ink-secondary">
                    {demoLive ? "Listening for conversation..." : "Start a demo call to see the transcript stream in real time."}
                  </div>
                ) : (
                  <div className="max-h-[300px] space-y-2 overflow-y-auto p-4">
                    {demoTranscripts.map((item) => (
                      <div key={item.ordinal} className="rounded-lg bg-raised px-3 py-2">
                        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
                          <span>{item.speaker === "agent" ? "Agent" : "You"}</span>
                          {!item.isFinal && <span className="rounded-full bg-control px-1.5 py-0.5 normal-case tracking-normal">Live</span>}
                        </div>
                        <div className="whitespace-pre-wrap text-[13px] leading-[1.45] text-ink">{item.text}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 px-6 py-5">
            <label className="block">
              <span className="text-[13px] font-medium text-ink-secondary">Recipient Phone Number</span>
              <input
                value={recipient}
                onChange={(event) => onRecipientChange(event.target.value)}
                placeholder="+1 555 123 4567"
                className="mt-2 h-11 w-full rounded-xl border border-hairline bg-card px-4 text-[14px] text-ink outline-none focus:border-accent"
              />
            </label>
            <div className="rounded-xl border border-hairline bg-card p-4">
              <label className="block">
                <span className="text-[13px] font-medium text-ink-secondary">Agent</span>
                <select
                  value={selectedAgentId}
                  onChange={(event) => onAgentChange(event.target.value)}
                  disabled={outboundSaving || agents.length === 0}
                  className="mt-2 h-11 w-full rounded-xl border border-hairline bg-raised px-4 text-[14px] font-semibold text-ink outline-none focus:border-accent disabled:opacity-60"
                >
                  {!selectedAgentId && <option value="">Select an agent</option>}
                  {agents.map((agent) => (
                    <option key={agent.remoteAgentId} value={agent.remoteAgentId}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-4 block">
                <span className="text-[13px] font-medium text-ink-secondary">Phone Number (Caller ID)</span>
                <select
                  value={selectedCallerId}
                  onChange={(event) => onCallerChange(event.target.value)}
                  disabled={outboundSaving || callerLoading || callerOptions.length === 0}
                  className="mt-2 h-11 w-full rounded-xl border border-hairline bg-raised px-4 text-[14px] text-ink outline-none focus:border-accent disabled:opacity-60"
                >
                  {!selectedCallerId && <option value="">Select a phone number</option>}
                  {callerOptions.map((caller) => {
                    const label = [caller.phoneNumber, providerLabel(caller.provider)].filter(Boolean).join(" - ");
                    return (
                      <option key={caller.id} value={caller.id}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </label>
              <div className="mt-2 flex min-h-5 flex-wrap items-center gap-2">
                {callerLoading ? (
                  <span className="inline-flex items-center gap-2 text-[14px] text-ink-secondary">
                    <Loader2 size={14} className="animate-spin" />
                    Loading phone numbers...
                  </span>
                ) : (
                  <>
                    <span className={cn("text-[14px]", callerNumber ? "text-ink" : "text-ink-secondary")}>
                      {callerNumber || "No phone number assigned"}
                    </span>
                    {callerProvider ? (
                      <span className="rounded-full border border-hairline bg-raised px-2 py-0.5 text-[11px] font-semibold text-ink">
                        {callerProvider}
                      </span>
                    ) : null}
                    {callerName ? <span className="text-[12px] text-ink-secondary">{callerName}</span> : null}
                  </>
                )}
              </div>
            </div>
            {!outboundAvailable && (
              <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-[13px] leading-[1.45] text-warning">
                Assign a hosted phone number to this agent before starting outbound calls.
              </div>
            )}
            {callerError && (
              <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-[13px] leading-[1.45] text-warning">
                {callerError}
              </div>
            )}
            {outboundError && (
              <div className="rounded-xl border border-danger/35 bg-danger/10 px-4 py-3 text-[13px] leading-[1.45] text-danger">
                {outboundError}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-hairline px-6 py-4">
          {mode === "choose" ? (
            <button type="button" onClick={onClose} className="rounded-xl border border-hairline px-4 py-2 text-[13px] font-medium text-ink hover:bg-raised">
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onModeChange("choose")}
              disabled={outboundSaving}
              className="rounded-xl border border-hairline px-4 py-2 text-[13px] font-medium text-ink hover:bg-raised disabled:opacity-60"
            >
              Back
            </button>
          )}
          {mode === "outbound" && (
            <button
              type="button"
              onClick={onOutboundCall}
              disabled={outboundSaving || !recipient.trim() || !outboundAvailable}
              className="inline-flex min-w-[112px] items-center justify-center rounded-xl bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110 disabled:bg-raised disabled:text-ink-secondary"
            >
              {outboundSaving ? <Loader2 size={16} className="animate-spin" /> : "Place Call"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function CallOverlay({ bot }: { bot: Bot }) {
  const active = useOnCall() === bot.id;
  if (!active) return null;
  return <Call bot={bot} />;
}

function Call({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const speech = useSpeech();
  const initialPhase: Phase = bot.busy ? "working" : "listening";
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [heard, setHeard] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const pushToTalk = usePushToTalk(bot.id, phase === "listening", () => {
    setNote("Push to talk couldn't start. Check Microphone and Speech Recognition access.");
  });

  const messages = visibleMessages(bot);
  const approval = pendingApprovals(messages)[0];
  const question = messages.find(
    (message) =>
      message.kind === "options" &&
      message.card?.requestId &&
      !message.card.tool &&
      !message.card.answered &&
      !message.card.dismissed,
  );

  // Everything already on screen when the call starts has been read or
  // ignored — a call must not open by reciting the backlog.
  const spokenIds = useRef<Set<string>>(new Set());
  const started = useRef(false);
  if (!started.current) {
    started.current = true;
    for (const m of messages) spokenIds.current.add(m.id);
  }

  // the approval we last asked about aloud, so a card that stays open
  // while the user thinks is not re-read every render
  const askedApproval = useRef<string | null>(null);
  const askedQuestion = useRef<{ requestId: string; messageId: string } | null>(null);
  const phaseRef = useRef<Phase>(initialPhase);
  const alive = useRef(true);
  const sayGeneration = useRef(0);

  /** Change the rendered phase and the synchronous phase used by native
   * callbacks together. React state alone is too late: the helper can exit
   * in the same tick as a final transcript or an intentional mute. */
  const move = useCallback((next: Phase) => {
    phaseRef.current = next;
    if (alive.current) setPhase(next);
  }, []);

  const hush = useCallback(() => {
    void speechInput.stop();
  }, []);

  const listen = useCallback(() => {
    if (!alive.current || currentCall() !== bot.id) return;
    move("listening");
    setHeard("");
    setNote(null);
    void speechInput.start({ endpointMs: CALL_ENDPOINT_MS }).catch(() => {
      if (alive.current && currentCall() === bot.id) {
        setNote("The microphone couldn't start. Check microphone permission for this app or site.");
      }
    });
  }, [bot.id, move]);

  /** Speak, with the microphone closed for the duration (see the header
   * comment — an open mic during playback is a feedback loop). */
  const say = useCallback(
    async (text: string) => {
      if (!alive.current || currentCall() !== bot.id) return false;
      const mine = ++sayGeneration.current;
      // Move first. stopSpeech() finishes asynchronously, and its close must
      // never observe an old "listening" phase and reopen the mic.
      move("speaking");
      hush();
      await speaker.speak(text, { botId: bot.id, voiceId: bot.voice });
      return alive.current && currentCall() === bot.id && sayGeneration.current === mine;
    },
    [bot.id, bot.voice, hush, move],
  );

  const sayThenListen = useCallback(
    async (text: string) => {
      const stillMine = await say(text);
      if (stillMine && phaseRef.current === "speaking") listen();
    },
    [listen, say],
  );

  // Navigating away from this bot hangs up. Without ownership checking, the
  // overlay disappeared but `currentCall()` remained set and auto-speak was
  // permanently disabled for a call nobody could see.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sayGeneration.current += 1;
      // StrictMode immediately remounts effects once in development. A
      // microtask distinguishes that probe from real navigation: the probe
      // has set alive=true again before this runs; a genuine unmount has not.
      deferCallCleanup(bot.id, () => alive.current);
    };
  }, [bot.id]);

  // ── the microphone ───────────────────────────────────────────────────
  useEffect(() => {
    const offTranscript = speechInput.onTranscript((line) => {
      if (!alive.current || currentCall() !== bot.id || phaseRef.current !== "listening") return;
      if (line.error) {
        setNote("Dictation stopped unexpectedly. Check Microphone and Speech Recognition access.");
        return;
      }
      if (typeof line.text !== "string") return;
      setHeard(line.text);
      if (line.partial !== false) return;
      // final result — Apple's recognizer decided the turn ended
      const said = line.text.trim();
      if (!said) return listen();

      const open = askedApproval.current;
      if (open) {
        if (YES.test(said) || NO.test(said)) {
          const allow = YES.test(said);
          askedApproval.current = null;
          dispatch({
            type: "decideRequest",
            threadId: bot.threadId,
            requestId: open,
            behavior: allow ? "allow" : "deny",
            message: allow ? undefined : "Denied by the user, on a call.",
          });
          move("working");
          return;
        }
        // not a decision — leave the card up and say so rather than
        // guessing consent from an ambiguous sentence
        void sayThenListen("Sorry — is that a yes or a no?");
        return;
      }

      const openQuestion = askedQuestion.current;
      if (openQuestion) {
        askedQuestion.current = null;
        dispatch({ type: "answerCard", botId: bot.id, messageId: openQuestion.messageId, answer: said });
        move("working");
        return;
      }

      move("sending");
      dispatch({ type: "send", botId: bot.id, text: said });
    });
    const offEnd = speechInput.onEnd(({ code, reason }) => {
      if (!alive.current || currentCall() !== bot.id) return;
      if (code === 2) {
        setNote("Speech recognition does not support this language or browser.");
        return;
      }
      if (code === 1) {
        setNote(
          reason === "helper-build-failed"
            ? "The dictation helper couldn't be built. Install Apple's Command Line Tools and try again."
            : window.ogb
              ? "Dictation needs Microphone + Speech Recognition access in System Settings."
              : "Allow microphone access in this site's browser permissions, then try again.",
        );
        return;
      }
      // the helper exits after every final result; if we are still meant
      // to be listening, that means the user's turn ended — start the next
      if (phaseRef.current === "listening") listen();
    });
    if (bot.busy && !approval && !question) move("working");
    else listen();
    return () => {
      offTranscript();
      offEnd();
      void speechInput.stop();
    };
    // busy/approval are intentionally initial snapshots. Their live changes
    // are handled below without tearing down native event listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id, bot.threadId, dispatch, listen, move, sayThenListen]);

  // ── narrate the work, speak the answer, read the approvals ───────────
  useEffect(() => {
    // The request may be resolved from the normal approval UI or by another
    // client while this call is open. Do not keep treating future speech as
    // an answer to a card that no longer exists.
    if (askedApproval.current && approval?.requestId !== askedApproval.current) {
      askedApproval.current = null;
    }
    if (askedQuestion.current && question?.card?.requestId !== askedQuestion.current.requestId) {
      askedQuestion.current = null;
    }
    if (!approval && !question && bot.busy && phaseRef.current === "listening") {
      move("working");
      hush();
    }
    if (approval && askedApproval.current !== approval.requestId && phase !== "speaking") {
      askedApproval.current = approval.requestId;
      spokenIds.current.add(approval.message.id);
      void sayThenListen(`${bot.name} wants to ${approval.tool}. ${approval.detail}. Should I allow it?`);
      return;
    }
    if (
      question?.card?.requestId &&
      askedQuestion.current?.requestId !== question.card.requestId &&
      phase !== "speaking"
    ) {
      askedQuestion.current = { requestId: question.card.requestId, messageId: question.id };
      spokenIds.current.add(question.id);
      const detail = question.card.subtitle.trim();
      const choices = question.card.options.length
        ? ` The options are ${question.card.options.join(", ")}.`
        : "";
      void sayThenListen(`${bot.name} asks: ${detail}${/[.!?]$/.test(detail) ? "" : "."}${choices}`);
      return;
    }
    const fresh = messages.filter((m) => !spokenIds.current.has(m.id));
    if (!fresh.length) return;
    // only the newest of each kind matters: a burst of tool chips should
    // not queue thirty seconds of narration behind the actual answer
    const reply = [...fresh].reverse().find((m) => m.role === "bot" && m.kind === "text" && m.text?.trim());
    const chip = [...fresh].reverse().find((m) => m.kind === "activity" && m.tool?.spoken);
    for (const m of fresh) spokenIds.current.add(m.id);

    if (reply?.text) {
      void sayThenListen(reply.text);
    } else if (chip?.tool?.spoken && phase === "working") {
      void say(chip.tool.spoken).then((stillMine) => {
        if (stillMine && phaseRef.current === "speaking") move("working");
      });
    }
  }, [messages, approval, question, phase, bot.busy, bot.name, hush, move, say, sayThenListen]);

  // busy is the harness's word for "a turn is running"
  useEffect(() => {
    if (bot.busy) {
      // An open approval deliberately keeps the mic live for yes/no. Every
      // other busy phase is half-duplex and must close capture.
      if (phaseRef.current !== "speaking" && !askedApproval.current && !askedQuestion.current) {
        move("working");
        hush();
      }
    } else if (
      phaseRef.current === "working" &&
      !askedApproval.current &&
      !askedQuestion.current &&
      !speaker.isSpeaking()
    ) {
      // A failed/cancelled turn may have no reply to trigger the normal
      // speak-then-listen path. Recover the call instead of staying stuck.
      listen();
    }
  }, [bot.busy, hush, listen, move]);

  // Escape hangs up; space interrupts whatever is being said
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        endCall(bot.id);
      } else if (e.code === "Space" && speaker.isSpeaking()) {
        e.preventDefault();
        sayGeneration.current += 1;
        speaker.stop();
        listen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bot.id, listen]);

  const mascotState =
    phase === "listening" ? "listening" : phase === "speaking" ? "sending" : phase === "sending" ? "thinking" : "working";
  const status =
    phase === "listening"
      ? pushToTalk
        ? "Push to talk"
        : "Listening"
      : phase === "sending"
        ? "One moment"
        : phase === "speaking"
          ? bot.name
          : "Working";

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-app/95 backdrop-blur-sm">
      <button
        onClick={() => endCall(bot.id)}
        aria-label="Hang up"
        className="absolute right-5 top-5 rounded-md p-2 text-ink-secondary hover:bg-raised hover:text-ink"
      >
        <X size={18} />
      </button>

      <MausAvatar color={bot.color} state={mascotState} size={220} animated trackPointer personality={bot.personality} />

      <div className="flex flex-col items-center gap-1.5 text-center">
        <div className="text-[20px] font-medium text-ink">{bot.name}</div>
        <div className="flex items-center gap-2 text-[13.5px] text-ink-secondary">
          {(phase === "working" || phase === "sending") && <Loader2 size={13} className="animate-spin" />}
          {status}
        </div>
      </div>

      {/* one line, whichever is current: what you're saying, or what it is */}
      <div className="min-h-[3.5rem] max-w-[560px] px-6 text-center text-[15px] leading-relaxed text-ink">
        {phase === "listening" ? (
          heard || (
            <span className="text-ink-secondary">
              {pushToTalk ? "Release Control + Option to send…" : "Say something…"}
            </span>
          )
        ) : (
          speech.caption
        )}
      </div>

      {note && (
        <div className="flex max-w-[460px] flex-col items-center gap-2 text-center text-[12.5px] text-warning">
          <span>{note}</span>
          <button
            onClick={listen}
            className="rounded-full border border-warning/40 px-3 py-1.5 text-[12px] hover:bg-warning/10"
          >
            Try microphone again
          </button>
        </div>
      )}
      {speech.error && <div className="max-w-[420px] text-center text-[12.5px] text-danger">{speech.error}</div>}

      <div className="flex items-center gap-3">
        {speaker.isSpeaking() && (
          <button
            onClick={() => {
              sayGeneration.current += 1;
              speaker.stop();
              listen();
            }}
            className="rounded-full border border-hairline/50 px-4 py-2 text-[13.5px] text-ink hover:bg-raised"
          >
            Interrupt
          </button>
        )}
        <button
          onClick={() => endCall(bot.id)}
          className="flex items-center gap-2 rounded-full bg-danger px-5 py-2.5 text-[14px] font-medium text-white hover:brightness-110"
        >
          <PhoneOff size={16} /> Hang up
        </button>
      </div>

      <div className="text-[11.5px] text-ink-secondary/70">
        Hold Control + Option to talk · Space interrupts · Esc hangs up
      </div>
    </div>
  );
}
