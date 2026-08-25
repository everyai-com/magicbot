import {
  forwardRef,
  memo,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import type { CursorState } from "./CursorAvatar";
import { normalizeBotPersonality, type BotPersonality } from "../../shared/bot-personality";

export type CircleBotAvatarHandle = {
  blink: () => void;
  spin: (durationMs?: number) => void;
  setExpression: (index: number) => void;
};

type Face =
  | "neutral"
  | "happy"
  | "excited"
  | "curious"
  | "thinking"
  | "surprised"
  | "focused"
  | "wink"
  | "tired"
  | "love"
  | "confused"
  | "error"
  | "sad";
type BlinkKind = "none" | "normal" | "soft" | "double" | "left" | "right";
type IdleAction = "still" | "glance-left" | "glance-right" | "glance-up" | "tilt" | "float" | "squash";
type RingMode = "idle" | "thinking" | "search" | "tool" | "listen" | "speak" | "success" | "error" | "progress";
type EyeMotion = "scan" | "read" | "code" | "follow-send" | "notice";

type CharacterBehavior = {
  face: Face;
  ring: RingMode;
  attention: number;
  eyeMotion?: EyeMotion;
};

const FACES: Face[] = [
  "neutral",
  "happy",
  "excited",
  "curious",
  "thinking",
  "surprised",
  "focused",
  "wink",
  "tired",
  "love",
  "confused",
  "error",
  "sad",
];

const BEHAVIOR_BY_STATE = {
  sleeping: { face: "tired", ring: "idle", attention: 10 },
  waking: { face: "surprised", ring: "progress", attention: 70 },
  idle: { face: "neutral", ring: "idle", attention: 10 },
  listening: { face: "curious", ring: "listen", attention: 85 },
  thinking: { face: "thinking", ring: "thinking", attention: 80, eyeMotion: "scan" },
  searching: { face: "curious", ring: "search", attention: 75, eyeMotion: "scan" },
  working: { face: "focused", ring: "tool", attention: 75, eyeMotion: "code" },
  excited: { face: "excited", ring: "success", attention: 80 },
  surprised: { face: "surprised", ring: "progress", attention: 80 },
  suspicious: { face: "focused", ring: "idle", attention: 60 },
  angry: { face: "error", ring: "error", attention: 100 },
  drowsy: { face: "tired", ring: "idle", attention: 10 },
  happy: { face: "happy", ring: "success", attention: 70 },
  curious: { face: "curious", ring: "idle", attention: 50 },
  confused: { face: "confused", ring: "idle", attention: 70 },
  bored: { face: "tired", ring: "idle", attention: 10 },
  proud: { face: "happy", ring: "success", attention: 65 },
  shy: { face: "wink", ring: "idle", attention: 40 },
  sad: { face: "sad", ring: "error", attention: 80 },
  laughing: { face: "happy", ring: "success", attention: 70 },
  scared: { face: "surprised", ring: "error", attention: 100 },
  playful: { face: "wink", ring: "idle", attention: 40 },
  celebrate: { face: "love", ring: "success", attention: 90 },
  orbit: { face: "neutral", ring: "thinking", attention: 60 },
  radar: { face: "focused", ring: "search", attention: 65, eyeMotion: "scan" },
  progress: { face: "neutral", ring: "progress", attention: 75 },
  spawning: { face: "surprised", ring: "progress", attention: 75 },
  humming: { face: "happy", ring: "speak", attention: 70 },
  loading: { face: "thinking", ring: "progress", attention: 75 },
  dictating: { face: "curious", ring: "speak", attention: 85 },
  writing: { face: "focused", ring: "tool", attention: 75, eyeMotion: "read" },
  sending: { face: "neutral", ring: "progress", attention: 90, eyeMotion: "follow-send" },
  receiving: { face: "curious", ring: "progress", attention: 80, eyeMotion: "notice" },
  uploading: { face: "thinking", ring: "progress", attention: 75, eyeMotion: "read" },
  notifying: { face: "surprised", ring: "idle", attention: 65, eyeMotion: "notice" },
  alerting: { face: "error", ring: "error", attention: 100 },
  dragging: { face: "focused", ring: "idle", attention: 90 },
  bouncing: { face: "happy", ring: "success", attention: 70 },
  "powering-down": { face: "tired", ring: "idle", attention: 90 },
} satisfies Record<CursorState, CharacterBehavior>;

const ACTIVE_STATES = new Set<CursorState>(["working", "searching", "writing", "loading", "uploading", "progress"]);
const SUCCESS_STATES = new Set<CursorState>(["happy", "proud", "celebrate", "bouncing"]);
const BLINK_DELAYS = [2200, 3000, 3000, 3800, 3800, 3800, 4500, 4500, 5500, 7000];

function weightedBlink(): BlinkKind {
  const roll = Math.random() * 100;
  if (roll < 70) return "normal";
  if (roll < 85) return "soft";
  if (roll < 95) return "double";
  return Math.random() > 0.5 ? "left" : "right";
}

function ClosedEye({ x, soft = false }: { x: number; soft?: boolean }) {
  return <path d={soft ? `M${x - 5} 50c3 2 7 2 10 0` : `M${x - 5} 51h10`} />;
}

function FaceArtwork({ face, blink }: { face: Face; blink: BlinkKind }) {
  const closeLeft = blink !== "none" && blink !== "right";
  const closeRight = blink !== "none" && blink !== "left";
  const soft = blink === "soft";
  if (closeLeft || closeRight) {
    return (
      <g className={`circle-bot__eyes circle-bot__eyes--blink circle-bot__eyes--blink-${blink}`} aria-hidden="true">
        {closeLeft ? <ClosedEye x={40} soft={soft} /> : <rect x="35" y="41" width="10" height="21" rx="5" />}
        {closeRight ? <ClosedEye x={64} soft={soft} /> : <rect x="59" y="41" width="10" height="21" rx="5" />}
      </g>
    );
  }

  switch (face) {
    case "happy":
      return <g className="circle-bot__eyes circle-bot__eyes--stroke" aria-hidden="true"><path d="M34 53c2-7 11-7 14 0M56 53c2-7 11-7 14 0" /></g>;
    case "excited":
      return <g className="circle-bot__eyes" aria-hidden="true"><ellipse cx="41" cy="50" rx="7" ry="10" /><ellipse cx="63" cy="50" rx="7" ry="10" /><circle className="circle-bot__glint" cx="39" cy="46" r="2" /><circle className="circle-bot__glint" cx="61" cy="46" r="2" /></g>;
    case "curious":
      return <g className="circle-bot__eyes" aria-hidden="true"><ellipse cx="40" cy="52" rx="5.5" ry="7.5" /><ellipse cx="64" cy="48" rx="7" ry="9.5" /><circle className="circle-bot__glint" cx="62" cy="45" r="1.8" /></g>;
    case "thinking":
      return <g className="circle-bot__eyes" aria-hidden="true"><rect x="35" y="42" width="10" height="19" rx="5" /><rect x="58" y="42" width="10" height="19" rx="5" /><path className="circle-bot__brow" d="M58 36c5-3 9-2 12 1" /></g>;
    case "surprised":
      return <g className="circle-bot__eyes" aria-hidden="true"><rect x="34" y="39" width="11" height="23" rx="5.5" /><rect x="59" y="39" width="11" height="23" rx="5.5" /></g>;
    case "focused":
      return <g className="circle-bot__eyes" aria-hidden="true"><path d="M33 43l15 5-3 13H34z" /><path d="M56 48l15-5-1 18H59z" /></g>;
    case "wink":
      return <g className="circle-bot__eyes" aria-hidden="true"><rect x="34" y="41" width="11" height="21" rx="5.5" /><path className="circle-bot__wink" d="M58 52l12-7M58 52l12 7" /></g>;
    case "tired":
      return <g className="circle-bot__eyes circle-bot__eyes--stroke" aria-hidden="true"><path d="M34 50c4 2 9 2 13 0M57 50c4 2 9 2 13 0" /></g>;
    case "love":
      return <g className="circle-bot__eyes" aria-hidden="true"><path d="M41 60S31 52 31 45c0-7 9-9 11-3 3-6 11-4 11 3 0 7-12 15-12 15z" /><path d="M65 60S55 52 55 45c0-7 9-9 11-3 3-6 11-4 11 3 0 7-12 15-12 15z" /></g>;
    case "confused":
      return <g className="circle-bot__eyes" aria-hidden="true"><rect x="34" y="41" width="11" height="21" rx="5.5" /><path className="circle-bot__wink" d="M58 53h12" /></g>;
    case "error":
      return <g className="circle-bot__eyes circle-bot__eyes--stroke" aria-hidden="true"><path d="M34 50h13M57 50h13" /></g>;
    case "sad":
      return <g className="circle-bot__eyes circle-bot__eyes--stroke" aria-hidden="true"><path d="M34 54c3-6 10-6 13 0M57 54c3-6 10-6 13 0" /></g>;
    default:
      return <g className="circle-bot__eyes" aria-hidden="true"><rect x="35" y="41" width="10" height="21" rx="5" /><rect x="59" y="41" width="10" height="21" rx="5" /></g>;
  }
}

function RingArtwork({ mode }: { mode: RingMode }) {
  return (
    <g className={`circle-bot__energy circle-bot__energy--${mode}`} aria-hidden="true">
      <circle className="circle-bot__halo" cx="52" cy="51" r="44" />
      {(mode === "thinking" || mode === "search" || mode === "progress") && <circle className="circle-bot__energy-arc" cx="52" cy="51" r="44" pathLength="100" />}
      {mode === "tool" && <circle className="circle-bot__energy-segments" cx="52" cy="51" r="44" pathLength="100" />}
      {(mode === "listen" || mode === "speak") && (
        <>
          <circle className="circle-bot__energy-ripple circle-bot__energy-ripple--one" cx="52" cy="51" r="47" />
          <circle className="circle-bot__energy-ripple circle-bot__energy-ripple--two" cx="52" cy="51" r="47" />
        </>
      )}
      {mode === "error" && (
        <>
          <path className="circle-bot__energy-break circle-bot__energy-break--left" d="M15 72a44 44 0 0 1 4-49" />
          <path className="circle-bot__energy-break circle-bot__energy-break--right" d="M85 18a44 44 0 0 1 5 57" />
        </>
      )}
    </g>
  );
}

function StateEffects({ state, compact }: { state: CursorState; compact: boolean }) {
  if (compact) return null;
  if (state === "sending") return <path className="circle-bot__speed" d="M1 41h16M-3 50h20M3 59h14" />;
  if (state === "listening" || state === "dictating" || state === "humming") return <path className="circle-bot__signal" d="M8 43c-5 5-5 13 0 18M3 37c-9 9-9 23 0 31M96 43c5 5 5 13 0 18M101 37c9 9 9 23 0 31" />;
  if (state === "notifying") return <g className="circle-bot__badge"><circle cx="86" cy="17" r="9" /><text x="86" y="21" textAnchor="middle">1</text></g>;
  if (state === "confused" || state === "alerting") return <g className="circle-bot__question"><path d="M84 15c0-7 12-8 13-1 1 6-7 6-7 11" /><circle cx="90" cy="31" r="1.5" /></g>;
  if (state === "celebrate" || state === "happy" || state === "proud") return <path className="circle-bot__spark" d="M86 12v8M82 16h8M16 18v6M13 21h6" />;
  if (state === "thinking") return <g className="circle-bot__thoughts"><circle cx="83" cy="22" r="2" /><circle cx="90" cy="16" r="3" /><circle cx="99" cy="10" r="4" /></g>;
  if (state === "loading") return <g className="circle-bot__loader-dots"><circle cx="42" cy="51" r="4" /><circle cx="52" cy="51" r="4" /><circle cx="62" cy="51" r="4" /></g>;
  return null;
}

export type CircleBotAvatarProps = {
  state?: CursorState;
  expression?: number;
  size?: number;
  gradient?: [string, string, string];
  title?: string | null;
  gaze?: { x?: number; y?: number };
  turn?: number;
  paused?: boolean;
  spring?: number;
  eyeScale?: number;
  showMouth?: boolean;
  mouthStroke?: number;
  audioLevel?: number;
  personality?: BotPersonality;
};

function CircleBotAvatarComponent(
  {
    state = "idle",
    expression,
    size = 44,
    gradient = ["#9FE6B5", "#3FAE6E", "#1C7A4C"],
    title,
    gaze,
    turn = 0,
    paused = false,
    eyeScale = 1,
    audioLevel = 0,
    personality = "friendly",
  }: CircleBotAvatarProps,
  ref: React.Ref<CircleBotAvatarHandle>,
) {
  const titleId = useId();
  const [blinkKey, setBlinkKey] = useState(0);
  const [blink, setBlink] = useState<BlinkKind>("none");
  const [spinMs, setSpinMs] = useState(0);
  const [forcedExpression, setForcedExpression] = useState<number | null>(null);
  const [idleAction, setIdleAction] = useState<IdleAction>("still");
  const [thinkingPhase, setThinkingPhase] = useState(0);
  const behavior: CharacterBehavior = BEHAVIOR_BY_STATE[state];
  const face = FACES[(expression ?? forcedExpression ?? FACES.indexOf(behavior.face)) % FACES.length] ?? behavior.face;
  const compact = size < 32;
  const motionPersonality = normalizeBotPersonality(personality);

  useImperativeHandle(ref, () => ({
    blink: () => setBlinkKey((value) => value + 1),
    spin: (durationMs = 700) => setSpinMs(durationMs),
    setExpression: (index: number) => setForcedExpression(index),
  }));

  useEffect(() => {
    if (paused || face === "tired") return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const speed = motionPersonality === "energetic" ? 0.62 : motionPersonality === "calm" ? 1.65 : motionPersonality === "analytical" ? 1.35 : motionPersonality === "friendly" ? 0.88 : 1;
      const delay = (BLINK_DELAYS[Math.floor(Math.random() * BLINK_DELAYS.length)] ?? 3800) * speed;
      timer = setTimeout(() => {
        setBlinkKey((value) => value + 1);
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [face, motionPersonality, paused]);

  useEffect(() => {
    if (!blinkKey) return;
    const kind = weightedBlink();
    setBlink(kind);
    const duration = kind === "double" ? 380 : kind === "soft" ? 230 : 180;
    const timer = setTimeout(() => setBlink("none"), duration);
    return () => clearTimeout(timer);
  }, [blinkKey]);

  useEffect(() => {
    if (paused || state !== "idle") {
      setIdleAction("still");
      return;
    }
    let resetTimer: ReturnType<typeof setTimeout>;
    const timer = setInterval(() => {
      const signature = {
        calm: ["float", "still", "glance-up"],
        energetic: ["squash", "float", "glance-left", "glance-right"],
        curious: ["glance-left", "glance-right", "tilt", "glance-up"],
        analytical: ["glance-left", "glance-right", "still"],
        creative: ["tilt", "squash", "float", "glance-up"],
        friendly: ["still", "float", "glance-left", "glance-right"],
      } satisfies Record<BotPersonality, IdleAction[]>;
      const choices = signature[motionPersonality];
      setIdleAction(choices[Math.floor(Math.random() * choices.length)] ?? "still");
      resetTimer = setTimeout(() => setIdleAction("still"), 900);
    }, (motionPersonality === "energetic" ? 2200 : motionPersonality === "calm" ? 5600 : 3600) + Math.random() * 1800);
    return () => {
      clearInterval(timer);
      clearTimeout(resetTimer);
    };
  }, [motionPersonality, paused, state]);

  useEffect(() => {
    if (state !== "thinking") {
      setThinkingPhase(0);
      return;
    }
    setThinkingPhase(1);
    const timers = [
      setTimeout(() => setThinkingPhase(2), 2000),
      setTimeout(() => setThinkingPhase(3), 5000),
      setTimeout(() => setThinkingPhase(4), 10000),
      setTimeout(() => setThinkingPhase(5), 20000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [state]);

  useEffect(() => {
    if (!spinMs) return;
    const timer = setTimeout(() => setSpinMs(0), spinMs);
    return () => clearTimeout(timer);
  }, [spinMs]);

  const className = useMemo(() => {
    const classes = [
      "circle-bot",
      `circle-bot--${state}`,
      `circle-bot--ring-${behavior.ring}`,
      `circle-bot--idle-${idleAction}`,
      `circle-bot--think-${thinkingPhase}`,
      `circle-bot--personality-${motionPersonality}`,
      compact ? "circle-bot--compact" : size < 56 ? "circle-bot--medium" : "circle-bot--large",
    ];
    if (behavior.eyeMotion) classes.push(`circle-bot--eyes-${behavior.eyeMotion}`);
    if (ACTIVE_STATES.has(state)) classes.push("circle-bot--active");
    if (SUCCESS_STATES.has(state)) classes.push("circle-bot--success");
    if (paused) classes.push("circle-bot--paused");
    if (spinMs) classes.push("circle-bot--spin");
    return classes.join(" ");
  }, [behavior.eyeMotion, behavior.ring, compact, idleAction, motionPersonality, paused, size, spinMs, state, thinkingPhase]);

  const smoothedAudio = Math.max(0, Math.min(1, audioLevel));
  const style: CSSProperties & Record<`--circle-bot-${string}`, string> = {
    width: size,
    height: size,
    "--circle-bot-color": gradient[1],
    "--circle-bot-light": gradient[0],
    "--circle-bot-dark": gradient[2],
    "--circle-bot-spin-ms": `${spinMs || 700}ms`,
    "--circle-bot-audio": `${smoothedAudio}`,
    "--circle-bot-audio-opacity": `${0.7 + smoothedAudio * 0.3}`,
    "--circle-bot-audio-scale": `${1.04 + smoothedAudio * 0.04}`,
    "--circle-bot-audio-stroke": `${2 + smoothedAudio * 2}px`,
    "--circle-bot-tempo": motionPersonality === "energetic" ? ".68" : motionPersonality === "calm" ? "1.55" : motionPersonality === "analytical" ? "1.18" : motionPersonality === "creative" ? ".86" : "1",
  };
  const gazeX = Math.max(-1, Math.min(1, gaze?.x ?? 0)) * 3.2 + turn * 0.05;
  const gazeY = Math.max(-1, Math.min(1, gaze?.y ?? 0)) * 2.4;
  const bodyX = gazeX * 0.2;
  const bodyY = gazeY * 0.2;

  return (
    <svg
      viewBox="-8 -8 120 120"
      width={size}
      height={size}
      className={className}
      style={style}
      role={title ? "img" : undefined}
      aria-labelledby={title ? titleId : undefined}
      aria-hidden={title ? undefined : "true"}
      data-attention-priority={behavior.attention}
    >
      {title && <title id={titleId}>{title}</title>}
      <defs>
        <radialGradient id={`${titleId}-face`} cx="38%" cy="28%" r="75%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#f3f3f1" />
        </radialGradient>
        <filter id={`${titleId}-shadow`} x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="5" stdDeviation="4" floodColor={gradient[2]} floodOpacity="0.2" />
        </filter>
      </defs>

      <ellipse className="circle-bot__shadow" cx="52" cy="99" rx="31" ry="5" />
      <StateEffects state={state} compact={compact} />
      <g className="circle-bot__attention-follow" style={{ transform: `translate(${bodyX}px, ${bodyY}px)` }}>
        <g className="circle-bot__body" filter={`url(#${titleId}-shadow)`}>
          <RingArtwork mode={behavior.ring} />
          <circle className="circle-bot__face" cx="52" cy="51" r="39" fill={`url(#${titleId}-face)`} />
          <g className="circle-bot__ears" aria-hidden="true">
            <rect x="7" y="40" width="8" height="22" rx="4" />
            <rect x="89" y="40" width="8" height="22" rx="4" />
            <path d="M15 45h3M86 45h3" />
          </g>
          <g className="circle-bot__eye-motion">
            <g
              className="circle-bot__face-art"
              style={{ transform: `translate(${gazeX}px, ${gazeY}px) scale(${Math.max(0.8, eyeScale)})` }}
            >
              <FaceArtwork face={face} blink={blink} />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}

export const CircleBotAvatar = memo(forwardRef(CircleBotAvatarComponent));
