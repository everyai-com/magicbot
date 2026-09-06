import { useEffect, useMemo, useState } from "react";
import { Brain, Globe2, ListChecks } from "lucide-react";
import { cn } from "@/lib/cn";

const ORB_CELLS = Array.from({ length: 9 }, (_, index) => index);

type AgentOrbVariant = "thinking" | "searching" | "finalizing";

function orbDelay(index: number, variant: AgentOrbVariant) {
  const x = index % 3;
  const y = Math.floor(index / 3);
  if (variant === "thinking") return Math.round(Math.hypot(x - 1, y - 1) * 150) - (index === 4 ? 160 : 0);
  if (variant === "searching") return x * 150 + y * 35;
  const perimeter = [0, 1, 2, 5, 8, 7, 6, 3];
  const ringIndex = perimeter.indexOf(index);
  return ringIndex < 0 ? 0 : -(ringIndex / perimeter.length) * 1_280;
}

function AgentOrb({ variant, label }: { variant: AgentOrbVariant; label: string }) {
  return (
    <span className="agent-orb" data-variant={variant} role="img" aria-label={label}>
      {ORB_CELLS.map((cell) => (
        <span key={cell} data-center={cell === 4 ? "" : undefined} style={{ animationDelay: `${orbDelay(cell, variant)}ms` }} />
      ))}
    </span>
  );
}

export function InlineSignalLoader({ label = "Running" }: { label?: string }) {
  return (
    <span className="inline-signal-loader" role="status" aria-label={label}>
      <span /><span /><span /><span />
    </span>
  );
}

export function BrowserFrameLoader() {
  return (
    <div className="browser-frame-loader" role="status" aria-label="Waiting for browser activity">
      <div className="browser-frame-loader__chrome"><span /><span /><span /></div>
      <div className="browser-frame-loader__canvas">
        <span className="browser-frame-loader__block browser-frame-loader__block--hero" />
        <span className="browser-frame-loader__block browser-frame-loader__block--line-one" />
        <span className="browser-frame-loader__block browser-frame-loader__block--line-two" />
        <span className="browser-frame-loader__scan" />
      </div>
      <span className="sr-only">Waiting for browser activity…</span>
    </div>
  );
}

function GenerativePhrase({ text }: { text: string }) {
  return (
    <span key={text} className="generative-phrase" aria-label={text}>
      {Array.from(text).map((character, index) => (
        <span
          key={`${character}-${index}`}
          aria-hidden="true"
          className="generative-phrase__char"
          style={{ animationDelay: `${Math.min(index * 22, 360)}ms` }}
        >
          {character === " " ? "\u00a0" : character}
        </span>
      ))}
    </span>
  );
}

function phaseFor(seconds: number, browsing: boolean) {
  if (seconds < 3) return browsing ? "Preparing browser" : "Understanding the task";
  if (seconds < 10) return browsing ? "Opening sources" : "Planning the work";
  if (seconds < 25) return browsing ? "Inspecting pages" : "Working through steps";
  if (seconds < 50) return browsing ? "Verifying findings" : "Checking the result";
  return browsing ? "Completing browser workflow" : "Completing the task";
}

/** AI-native run state: elapsed time, honest phase language, and a quiet
 * pixel-grid shimmer. This remains an ephemeral view; persisted tool events
 * continue to live in the execution timeline. */
export function AgentRunStatus({ since, browsing = false }: { since: number; browsing?: boolean }) {
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.round((Date.now() - since) / 1000)));

  useEffect(() => {
    const tick = () => setSeconds(Math.max(0, Math.round((Date.now() - since) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [since]);

  const phase = useMemo(() => phaseFor(seconds, browsing), [seconds, browsing]);
  const Icon = browsing ? Globe2 : seconds < 3 ? Brain : ListChecks;
  const orbVariant: AgentOrbVariant = seconds >= 25 ? "finalizing" : browsing ? "searching" : "thinking";

  return (
    <div className="flex justify-start" role="status" aria-live="polite">
      <div className="agent-run-card min-w-[17rem] max-w-[88%] overflow-hidden rounded-xl border border-hairline/35 bg-panel/90 shadow-sm sm:max-w-[70%]">
        <div className="flex items-center gap-3 px-3.5 py-3">
          <AgentOrb variant={orbVariant} label={`${phase} activity`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
              <Icon size={13} className="text-accent" />
              <span className="truncate"><GenerativePhrase text={phase} /></span>
            </div>
            <div className="mt-0.5 text-[11.5px] text-ink-secondary">
              Continuing independently until the task is complete
            </div>
          </div>
          <span className={cn("shrink-0 font-mono text-[11px] tabular-nums text-ink-secondary", seconds > 30 && "text-accent-text")}>
            {seconds}s
          </span>
        </div>
        <div className="agent-run-progress h-px bg-hairline/30">
          <span className="block h-full bg-accent" />
        </div>
      </div>
    </div>
  );
}
