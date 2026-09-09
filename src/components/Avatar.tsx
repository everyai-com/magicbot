// Bot avatar — a circular, expressive character wrapped in the app's
// historical MausAvatar API so no call site changes. Per-bot color paints the
// ring while live state drives the eyes, pose, and small ambient effects.
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { MAUS_COLORS, type MausColor, type MausMotion, type MausState } from "@/lib/mascot";
import { CircleBotAvatar, type CircleBotAvatarHandle } from "./CircleBotAvatar";
import { botAvatarProfile, type BotAvatarCrop } from "../../shared/bot-avatar";
import { normalizeBotPersonality, type BotPersonality } from "../../shared/bot-personality";

/**
 * Legacy face-placement knobs from the Maus body era. The cursor mascot
 * places its own face; these remain only so the preview harness's sliders
 * keep compiling — the matching props are accepted and ignored.
 */
export const FACE_X = 80;
export const FACE_Y = 102;
export const FACE_SCALE = 0.47;
export const EYE_SCALE = 1.12;
export const MOUTH_WEIGHT = 11;

/**
 * How far the pointer may pull the eyes. Facing forward the full range is
 * safe; with the expressions' authored gaze they already start off-centre.
 */
const POINTER_GAZE = { forward: 1, authored: 0.25 };

/** Ambient pointer attention is deliberately low priority. Important product
 * states keep their authored gaze instead of being interrupted by a cursor. */
const POINTER_ATTENTION_STATES = new Set<MausState>([
  "idle",
  "listening",
  "happy",
  "curious",
  "bored",
  "proud",
  "shy",
  "playful",
  "drowsy",
]);

/**
 * What a one-shot motion does while it plays: CursorAvatar animates the body
 * per state, so borrowing the state for a beat moves body and face together.
 */
interface MotionFaces
  extends Partial<
    Record<Exclude<MausMotion, "none">, { state?: MausState; blink?: boolean; spin?: number }>
  > {}

const MOTION_FACE: MotionFaces = {
  arrive: { state: "spawning", spin: 900 },
  switch: { state: "waking", spin: 620 },
  customize: { state: "proud", blink: true },
  alert: { state: "alerting" },
  thinking: { state: "thinking" },
  working: { state: "working" },
  launch: { state: "loading" },
  success: { state: "happy", blink: true },
  celebrate: { state: "celebrate", spin: 700 },
  blink: { blink: true },
  surprise: { state: "surprised", blink: true },
  failure: { state: "sad" },
};

/** How long a one-shot motion holds its state before the bot's own returns. */
const MOTION_FACE_MS = 1400;

/** Channel-wise mix of a hex color toward another, t in 0..1. */
function mix(hex: string, toward: string, t: number): string {
  const a = Number.parseInt(hex.slice(1), 16);
  const b = Number.parseInt(toward.slice(1), 16);
  const channel = (shift: number) => {
    const va = (a >> shift) & 0xff;
    const vb = (b >> shift) & 0xff;
    return Math.round(va + (vb - va) * t);
  };
  return `#${[channel(16), channel(8), channel(0)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Bot color -> the mascot's three-stop body gradient (highlight, base,
 * shadow), with the same light/dark spread as the pack's default green
 * ["#9FE6B5", "#3FAE6E", "#1C7A4C"].
 */
const gradientFor = (color: MausColor): [string, string, string] => {
  const fill = MAUS_COLORS[color] ?? MAUS_COLORS.green;
  return [mix(fill, "#ffffff", 0.55), fill, mix(fill, "#000000", 0.42)];
};

export type MausAvatarHandle = CircleBotAvatarHandle;

export type MausAvatarProps = {
  color: MausColor;
  /** Named behaviour — drives the expression pool, its cadence and blinking. */
  state?: MausState;
  /** Pin one of the 25 faces and stop the state's own drift. */
  expression?: number;
  size?: number;
  label?: string;
  motion?: MausMotion;
  motionKey?: number;
  /** Head turn in degrees. */
  turn?: number;
  gaze?: { x?: number; y?: number };
  spring?: number;
  eyeScale?: number;
  showMouth?: boolean;
  mouthStroke?: number;
  /**
   * Face the viewer at turn 0, cancelling each expression's authored gaze
   * direction. Off restores the engine's own drawn-in directions.
   */
  forward?: boolean;
  /** Let the eyes follow the pointer across this avatar. */
  trackPointer?: boolean;
  /** Run the animation. Off renders the state's resting face. */
  animated?: boolean;
  /** Legacy Maus face-placement knobs — accepted, ignored. */
  eyeSpacing?: number;
  faceX?: number;
  faceY?: number;
  faceScale?: number;
  personality?: BotPersonality;
};

function MausAvatarComponent(
  {
    color,
    state = "idle",
    expression,
    size = 44,
    label,
    motion = "none",
    motionKey = 0,
    turn,
    gaze,
    spring,
    eyeScale,
    showMouth,
    mouthStroke,
    forward = true,
    trackPointer = true,
    animated = true,
    personality = "friendly",
  }: MausAvatarProps,
  ref: React.Ref<MausAvatarHandle>,
) {
  const inner = useRef<CircleBotAvatarHandle>(null);
  useImperativeHandle(ref, () => ({
    blink: () => inner.current?.blink(),
    spin: (durationMs?: number) => inner.current?.spin(durationMs),
    setExpression: (index: number) => inner.current?.setExpression(index),
  }));

  // A one-shot motion borrows the state for a moment, then hands it back.
  const [motionState, setMotionState] = useState<MausState | null>(null);
  useEffect(() => {
    if (motion === "none" || !animated) return;
    const beat = MOTION_FACE[motion];
    if (!beat) return;
    if (beat.blink) inner.current?.blink();
    if (beat.spin) inner.current?.spin(beat.spin);
    if (!beat.state) return;
    setMotionState(beat.state);
    const timer = setTimeout(() => setMotionState(null), MOTION_FACE_MS);
    return () => clearTimeout(timer);
  }, [motion, motionKey, animated]);

  // Pointer-follow gaze, composed with any gaze the caller pins.
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const displayedState = motionState ?? state;
  const acceptsPointer = POINTER_ATTENTION_STATES.has(displayedState);
  useEffect(() => {
    if (!acceptsPointer) setPointer({ x: 0, y: 0 });
  }, [acceptsPointer]);
  const range = forward ? POINTER_GAZE.forward : POINTER_GAZE.authored;
  useEffect(() => {
    if (!trackPointer || !animated || !acceptsPointer) return;
    const onPointerMove = (event: PointerEvent) => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      const scaleX = Math.max(1, rect.width * 1.4);
      const scaleY = Math.max(1, rect.height * 1.4);
      const x = (event.clientX - (rect.left + rect.width / 2)) / scaleX;
      const y = (event.clientY - (rect.top + rect.height / 2)) / scaleY;
      setPointer({
        x: Math.max(-1, Math.min(1, x)) * range,
        y: Math.max(-1, Math.min(1, y)) * range,
      });
    };
    const resetPointer = () => setPointer({ x: 0, y: 0 });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", resetPointer);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", resetPointer);
    };
  }, [acceptsPointer, animated, range, trackPointer]);

  return (
    <span
      ref={wrapperRef}
      className="inline-flex shrink-0"
    >
      <CircleBotAvatar
        ref={inner}
        state={displayedState}
        expression={expression}
        size={size}
        gradient={gradientFor(color)}
        title={label ?? null}
        gaze={{ x: (gaze?.x ?? 0) + pointer.x, y: (gaze?.y ?? 0) + pointer.y }}
        turn={turn}
        spring={spring}
        eyeScale={eyeScale}
        showMouth={showMouth}
        mouthStroke={mouthStroke}
        paused={!animated}
        personality={personality}
      />
    </span>
  );
}

export const MausAvatar = memo(forwardRef(MausAvatarComponent));

export type BotAvatarProps = Omit<MausAvatarProps, "color"> & {
  bot: {
    name?: string;
    color: MausColor;
    avatarUrl?: string | null;
    avatarCrop?: BotAvatarCrop;
    personality?: BotPersonality;
  };
};

/**
 * The one renderer for a bot's chosen profile image. Malformed persisted
 * values and images that fail to load both fall back to the animated mascot,
 * so an old/corrupt profile can never leave a broken-image icon in the app.
 */
export function BotAvatar({ bot, size = 44, label, ...mascotProps }: BotAvatarProps) {
  const profile = botAvatarProfile(bot);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [profile.avatarUrl]);

  if (profile.avatarCrop === "mascot" || !profile.avatarUrl || imageFailed) {
    return (
      <MausAvatar
        {...mascotProps}
        color={bot.color}
        size={size}
        label={label ?? bot.name}
        personality={normalizeBotPersonality(bot.personality)}
      />
    );
  }

  const radius =
    profile.avatarCrop === "circle"
      ? "50%"
      : profile.avatarCrop === "rounded"
        ? "22%"
        : "0";
  return (
    <img
      src={profile.avatarUrl}
      alt={label ?? (bot.name ? `${bot.name} avatar` : "Bot avatar")}
      width={size}
      height={size}
      draggable={false}
      onError={() => setImageFailed(true)}
      className="block shrink-0 bg-raised object-cover"
      style={{ width: size, height: size, borderRadius: radius }}
    />
  );
}

export function InitialsAvatar({
  initials,
  size = 32,
}: {
  initials: string;
  size?: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary font-medium"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}
