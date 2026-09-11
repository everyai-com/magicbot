import { track } from "@/lib/analytics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Clock, Mic, Paperclip, Square, Users, X } from "lucide-react";
import { isHostedChatSurface, useStore, visibleMessages, type Bot, type Group } from "@/state/store";
import { cn } from "@/lib/cn";
import { useComposerDraft } from "@/lib/drafts";
import { MascotAvatar } from "./Avatar";
import { ComposerAttachments } from "./ComposerAttachments";
import {
  composeMessage,
  imageAttachmentFromFile,
  attachmentsFromDroppedFiles,
  fileAttachmentFromFile,
  isImageFile,
  isLongPaste,
  pasteAttachment,
  type Attachment,
} from "@/lib/composer-attachments";
import { normalizeState } from "@/lib/mascot";
import { groupComposerHint, roomRespondersForComposer } from "@/lib/group-routing";
import { PendingApprovalActions, PendingApprovalPanel, pendingApprovals } from "./PendingApproval";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { speechInput } from "@/lib/speech-input";

/** The active @mention query at the caret: the text between an `@` that
 * starts a word and the caret. null = no mention being typed. */
function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null; // user@host, not a tag
  const query = upto.slice(at + 1);
  if (query.length > 24 || query.includes("@") || query.includes("\n")) return null;
  return { start: at, query };
}

type MentionChoice = { id: string; name: string; bot?: Bot };

export function Composer({
  bot,
  group,
  members,
  onEditLast,
  locked = false,
}: {
  bot?: Bot;
  group?: Group;
  members?: Bot[];
  onEditLast?: () => void;
  /** New rooms keep the composer inert until their setup is saved or skipped. */
  locked?: boolean;
}) {
  const { state, dispatch } = useStore();
  const { capabilities } = useDesktopCapabilities();
  // Unified target: a 1:1 bot thread or a room. In a room the @ picker
  // offers members plus @everyone; explicit mentions override the room's
  // configured default responder.
  const busy = group ? Boolean(group.busyBotId) : Boolean(bot?.busy);
  // an engine with a live session takes a message INTO the running turn;
  // for those the composer never locks — the server steers instead of 409
  const canSteer =
    !group && Boolean(bot) && state.instances.find((i) => i.instanceId === bot!.modelSelection.instanceId)?.capabilities?.queueing === true;
  // a pending approval blocks the prompt until it is answered
  const threadId = group?.threadId ?? bot?.threadId ?? "";
  // the VISIBLE branch only — an approval left on a branch you edited away
  // from must not keep blocking the composer
  const approvals = pendingApprovals(group ? group.messages : bot ? visibleMessages(bot) : []);
  const approval = approvals[0];
  const approvalBot = group
    ? members?.find((b) => b.id === approval?.message.from?.botId) ??
      members?.find((b) => b.id === group.busyBotId)
    : bot;
  const busyName = group
    ? (members?.find((b) => b.id === group.busyBotId)?.name ?? "A bot")
    : (bot?.name ?? "The bot");
  // Per-thread draft: switching bots unmounts this component, so both the
  // text and its attachment chips have to outlive it (see lib/drafts).
  const [text, setText, attachments, setAttachments] = useComposerDraft(
    group ? `group:${group.id}` : `bot:${bot?.id ?? ""}`,
  );
  const addAttachments = useCallback(
    (next: Attachment[]) => setAttachments((prev) => [...prev, ...next]),
    [setAttachments],
  );
  const removeAttachment = useCallback(
    (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id)),
    [setAttachments],
  );
  const [recording, setRecording] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null); // Esc'd this @
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // what was typed before the mic went on — partials append after it
  const baseText = useRef("");

  // image paste is offered only when every bot that will actually answer
  // can open one. sendGroup routes to mentions, else the room default —
  // `members.some` would let a mixed room send <attached-image> to Grok.
  const botSupportsImages = (candidate?: Bot) =>
    Boolean(
      candidate &&
        state.instances.find((i) => i.instanceId === candidate.modelSelection.instanceId)?.capabilities?.images,
    );
  const imageTargetsSupport = (message: string) => {
    if (!group) return botSupportsImages(bot);
    const responders = roomRespondersForComposer(message, members ?? [], group);
    return responders.length > 0 && responders.every(botSupportsImages);
  };
  const engineSupportsImages = imageTargetsSupport(text);

  // ── @mention picker (tag another bot; the agent reaches it via ask_bot) ──
  const mention = mentionQueryAt(text, caret);
  const candidates = useMemo(() => {
    if (!mention || mention.start === dismissedAt) return [];
    const pool: MentionChoice[] = group
      ? [
          { id: "__everyone__", name: "everyone" },
          ...(members ?? []).map((member) => ({ id: member.id, name: member.name, bot: member })),
        ]
      : state.bots
          .filter((member) => member.id !== bot?.id && !member.hidden)
          .map((member) => ({ id: member.id, name: member.name, bot: member }));
    const q = mention.query.trim().toLowerCase();
    // "@Scout " — the full name plus a space — is a COMPLETED tag, not a
    // search: keep the picker closed so Enter sends instead of re-picking
    if (mention.query.endsWith(" ") && pool.some((b) => b.name.toLowerCase() === q)) return [];
    return pool.filter((b) => !q || b.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mention, dismissedAt, state.bots, bot?.id, group, members]);
  const pickerOpen = candidates.length > 0;

  useEffect(() => setHighlight(0), [mention?.start, mention?.query]);

  // grow the textarea with its content (capped by max-h in the className)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const pickMention = (peer: MentionChoice) => {
    if (!mention) return;
    const after = text.slice(caret);
    const next = `${text.slice(0, mention.start)}@${peer.name} ${after}`;
    setText(next);
    const newCaret = mention.start + peer.name.length + 2;
    setCaret(newCaret);
    // picking completes this tag — close the popup so the next Enter sends
    setDismissedAt(mention.start);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newCaret, newCaret);
    });
  };

  // Rooms hold one message client-side while a member speaks; it auto-sends
  // the moment the room settles. 1:1 mid-turn sends still POST (the harness
  // queue), but stay off the transcript until drain — the chip here is the
  // pending row so they cannot become the active leaf mid-turn.
  const [queued, setQueued] = useState<string | null>(null);
  const pendingChip = group
    ? queued
    : bot
      ? state.pendingQueued?.[bot.threadId]?.map((entry) => entry.text).join("\n")
      : undefined;
  // a chip on its own is a message: the send control has to appear for it
  const hasContent = Boolean(text.trim()) || attachments.length > 0;
  const send = () => {
    if (locked) return;
    if (attachments.some((attachment) => attachment.kind === "image") && !imageTargetsSupport(text)) {
      dispatch({ type: "error", message: "The selected responder does not support image attachments." });
      return;
    }
    const t = composeMessage(text, attachments);
    if (!t) return;
    if (busy && group) {
      setQueued(t);
      setText("");
      setAttachments([]);
      return;
    }
    if (group) {
      dispatch({ type: "sendGroup", groupId: group.id, text: t });
      track("message_sent", { room: true });
    } else if (bot) {
      const optimistic = isHostedChatSurface(state.config?.hosted);
      dispatch({
        type: "send",
        botId: bot.id,
        text: t,
        ...(optimistic ? { clientMessageId: crypto.randomUUID(), sentAt: Date.now() } : {}),
      });
      track("message_sent", { driver: bot.modelSelection?.instanceId, queued: busy && !canSteer });
    }
    setText("");
    setAttachments([]);
  };
  useEffect(() => {
    if (busy || !queued) return;
    if (group) {
      if (queued.includes("<attached-image ") && !imageTargetsSupport(queued)) {
        dispatch({ type: "error", message: "The selected responder does not support image attachments." });
        setQueued(null);
        return;
      }
      dispatch({ type: "sendGroup", groupId: group.id, text: queued });
      track("message_sent", { room: true, queued: true });
    }
    setQueued(null);
  }, [busy, queued, group, members, state.instances, dispatch]);

  // Native Apple dictation and browser Web Speech share one input surface:
  // partials stream into the box and the final text remains editable.
  useEffect(() => {
    if (!recording) return;
    if (!speechInput.available()) {
      setRecording(false);
      return;
    }
    setSpeechError(null);
    const offTranscript = speechInput.onTranscript((line) => {
      if (typeof line.text === "string") {
        const base = baseText.current;
        setText(base ? `${base} ${line.text}` : line.text);
      }
    });
    const offEnd = speechInput.onEnd(({ code, reason }) => {
      setRecording(false);
      if (code === 2) {
        setSpeechError("Speech recognition does not support this language or browser.");
      } else if (code === 1) {
        setSpeechError(window.ogb
          ? "Dictation needs Microphone + Speech Recognition access — System Settings → Privacy & Security."
          : "Microphone access was blocked. Allow it in this site's browser permissions and try again.");
      } else if (reason && reason !== "no-speech") {
        setSpeechError(`Dictation stopped: ${reason}.`);
      }
    });
    void speechInput.start().catch(() => {
      setRecording(false);
      setSpeechError("The microphone couldn't start. Check this site's microphone permission.");
    });
    return () => {
      offTranscript();
      offEnd();
      void speechInput.stop();
    };
  }, [recording]);

  const toggleMic = () => {
    if (!capabilities.dictation.available || !speechInput.available()) {
      setSpeechError("Dictation isn't supported by this browser. Try Chrome, Edge, or the desktop app.");
      return;
    }
    baseText.current = text.trim();
    setRecording((r) => !r);
  };

  const attachPickedFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files);
    const images = engineSupportsImages ? selected.filter(isImageFile) : [];
    const rest = selected.filter((file) => !isImageFile(file));
    const next: Attachment[] = [];
    const failures: string[] = engineSupportsImages ? [] : selected.filter(isImageFile).map((file) => file.name);
    const dropped = await attachmentsFromDroppedFiles(
      rest,
      (file) => window.ogb?.getPathForFile?.(file) ?? "",
      fileAttachmentFromFile,
    );
    next.push(...dropped.attachments);
    failures.push(...dropped.rejectedNames);
    for (const file of images) {
      try {
        const image = await imageAttachmentFromFile(file);
        if (image) next.push(image);
      } catch {
        failures.push(file.name);
      }
    }
    if (next.length) addAttachments(next);
    if (failures.length) dispatch({ type: "error", message: `${failures.join(", ")} could not be attached. Files can be up to 25 MB.` });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="shrink-0 border-t border-hairline/30 bg-app/95 px-2.5 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-xl sm:px-5 sm:pb-5 sm:pt-3">
      {speechError && (
        <div className="mx-auto mb-2 max-w-[900px] rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          {speechError}
        </div>
      )}
      <div className="relative mx-auto max-w-[900px]">
        {pendingChip && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-hairline/40 bg-panel px-3 py-2 text-[12.5px] text-ink-secondary">
            <Clock size={13} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              Queued — sends when {busyName} finishes: “{pendingChip}”
            </span>
            {group && (
              <button
                onClick={() => setQueued(null)}
                aria-label="Discard queued message"
                className="rounded p-0.5 hover:bg-raised hover:text-ink"
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}
        {pickerOpen && (
          <div
            role="listbox"
            aria-label="Tag a bot"
            className="absolute bottom-full left-2 z-20 mb-2 w-72 overflow-hidden rounded-xl border border-hairline/40 bg-raised shadow-lg"
          >
            {candidates.map((peer, i) => (
              <button
                key={peer.id}
                role="option"
                aria-selected={i === highlight}
                onClick={() => pickMention(peer)}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left",
                  i === highlight ? "bg-raised-hover" : "",
                )}
              >
                {peer.bot ? (
                  <MascotAvatar
                    color={peer.bot.color}
                    state={normalizeState(peer.bot.mascotExpression) ?? "happy"}
                    personality={peer.bot.personality}
                    size={24}
                  />
                ) : (
                  <span className="flex size-6 items-center justify-center rounded-full bg-raised text-ink-secondary">
                    <Users size={14} aria-hidden="true" />
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{peer.name}</span>
                <span className="shrink-0 text-xs text-ink-secondary">{peer.bot ? "Agent" : "Team"}</span>
              </button>
            ))}
          </div>
        )}
        {/* An approval takes over the composer: you answer it before you
            can type again, so a waiting bot is impossible to miss. */}
        {approval && (
          <div className="mb-2 overflow-hidden rounded-2xl border border-accent/40 bg-card">
            <PendingApprovalPanel pending={approval} count={approvals.length} index={0} />
            <PendingApprovalActions
              pending={approval}
              threadId={threadId}
              bot={approvalBot}
              onCancelTurn={() => {
                if (group) dispatch({ type: "interruptGroup", groupId: group.id });
                else if (bot) dispatch({ type: "interrupt", botId: bot.id });
              }}
            />
          </div>
        )}
        <ComposerAttachments
          items={attachments}
          onAdd={addAttachments}
          onRemove={removeAttachment}
          allowImages={engineSupportsImages}
        />
        <div className="flex min-h-14 items-end gap-1 rounded-2xl border border-hairline/70 bg-card px-1.5 py-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.22)] transition focus-within:border-accent-border focus-within:shadow-[0_10px_30px_rgba(0,0,0,0.26),0_0_0_3px_color-mix(in_srgb,var(--color-accent)_16%,transparent)] sm:gap-2 sm:rounded-3xl sm:px-2 sm:py-2 sm:pl-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => void attachPickedFiles(event.currentTarget.files)}
        />
        {!locked && !busy && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files"
            title="Attach files (up to 25 MB each)"
            className="flex size-10 shrink-0 touch-manipulation items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink sm:size-9"
          >
            <Paperclip size={17} />
          </button>
        )}
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setDismissedAt(null);
          }}
          onPaste={(e) => {
            // an image from the clipboard becomes an uploaded attachment —
            // but only for engines that can open one; a grok bot politely
            // refuses instead of receiving a path it cannot read
            const imageFiles = Array.from(e.clipboardData.files).filter(isImageFile);
            if (imageFiles.length && engineSupportsImages) {
              e.preventDefault();
              void (async () => {
                for (const file of imageFiles) {
                  try {
                    const attachment = await imageAttachmentFromFile(file);
                    if (attachment) setAttachments((prev) => [...prev, attachment]);
                  } catch (err) {
                    dispatch({
                      type: "error",
                      message: err instanceof Error ? err.message : "image upload failed",
                    });
                  }
                }
              })();
              return;
            }
            // a wall of text becomes a chip instead of burying the input
            const pasted = e.clipboardData.getData("text/plain");
            if (!isLongPaste(pasted)) return;
            e.preventDefault();
            // Preserve native paste replacement semantics: if text was
            // selected, the attachment replaces that selection.
            const start = e.currentTarget.selectionStart;
            const end = e.currentTarget.selectionEnd;
            if (start !== end) {
              setText(`${text.slice(0, start)}${text.slice(end)}`);
              setCaret(start);
            }
            setAttachments((prev) => [...prev, pasteAttachment(pasted)]);
          }}
          onKeyUp={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (pickerOpen) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setHighlight((h) => (h + delta + candidates.length) % candidates.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickMention(candidates[highlight]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDismissedAt(mention?.start ?? null);
                return;
              }
            }
            // an empty composer + ArrowUp = edit your last message (like a chat app)
            if (e.key === "ArrowUp" && !hasContent && onEditLast) {
              e.preventDefault();
              onEditLast();
              return;
            }
            // Shift+Enter inserts a newline; plain Enter sends
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
            if (e.key === "Escape" && recording) setRecording(false);
          }}
          disabled={Boolean(approval) || locked}
          placeholder={
            locked
              ? "Finish team setup to start chatting"
              : approval
              ? "Answer the approval above to continue"
              : recording
              ? "Listening…"
              : busy && canSteer
                ? `${busyName} is working — Enter sends this into the running turn`
              : busy
                ? group
                  ? `${busyName} is working — Enter queues your message`
                  : `${busyName} is working — sends when this turn finishes`
                : group
                  ? `Message ${group.name} — ${groupComposerHint(group, members ?? [])}`
                  : `Message ${bot?.name ?? ""}`
          }
          aria-label={`Message ${group ? group.name : (bot?.name ?? "")}`}
          className="max-h-40 min-h-9 min-w-0 flex-1 resize-none self-center bg-transparent px-1.5 py-1.5 text-[16px] leading-6 text-ink caret-accent placeholder:text-ink-secondary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 sm:text-[15px]"
        />
        {busy && !locked && (
          <button
            onClick={() => {
              if (group) dispatch({ type: "interruptGroup", groupId: group.id });
              else if (bot) dispatch({ type: "interrupt", botId: bot.id });
            }}
            aria-label="Stop this turn"
            className="flex size-10 shrink-0 touch-manipulation items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink sm:size-9"
            title="Stop"
          >
            <Square size={14} className="fill-current" />
          </button>
        )}
        {!locked && !busy && !hasContent && capabilities.dictation.available && (
          <button
            onClick={toggleMic}
            aria-label={recording ? "Stop dictation" : "Start dictation"}
            className={cn(
              "flex size-10 shrink-0 touch-manipulation items-center justify-center rounded-full sm:size-9",
              recording
                ? "animate-pulse bg-danger/20 text-danger"
                : "text-ink-secondary hover:bg-raised hover:text-ink",
            )}
            title={recording ? "Stop dictation (Esc)" : "Dictate"}
          >
            <Mic size={18} />
          </button>
        )}
        {hasContent && !locked && (
          <button
            onClick={send}
            aria-label={busy && canSteer ? "Send into the running turn" : busy ? "Queue message" : "Send message"}
            title={busy && canSteer ? "Send into the running turn" : busy ? "Sends when the current turn finishes" : "Send"}
            className={cn(
              "flex size-10 shrink-0 touch-manipulation items-center justify-center rounded-full text-white sm:size-9",
              busy && !canSteer ? "bg-raised text-ink-secondary hover:bg-raised-hover" : "bg-accent hover:brightness-110",
            )}
          >
            {busy && !canSteer ? <Clock size={15} /> : <ArrowUp size={17} />}
          </button>
        )}
        </div>
      </div>
    </div>
  );
}
