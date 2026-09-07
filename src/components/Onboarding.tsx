import { useEffect, useState, type ReactNode } from "react";
import { Check, AlertTriangle, Loader2, Lock, Mail, Mic, UserPlus } from "lucide-react";
import { MausAvatar } from "./Avatar";
import { identifyEmail, setEmailGateDone, track } from "@/lib/analytics";
import {
  confirmPasswordReset,
  requestPasswordReset,
  saveBetterAuthSession,
  signInWithBetterAuth,
  signUpWithBetterAuth,
  type BetterAuthLoginResponse,
} from "@/lib/auth";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { EngineSetup } from "./EngineSetup";
import { ProviderMark } from "./ProviderIcons";
import type { InstanceInfo } from "@/state/store";

// Three-step first-run onboarding: who you are (email), what's installed
// (live engine checks from the harness), what the app may use (TCC).
// Every check is skippable — onboarding must never brick the app.

type InstanceRow = InstanceInfo;
type AuthMode = "signin" | "signup" | "forgot" | "reset";

function StatusRow({
  ok,
  warn,
  title,
  detail,
  mark,
  children,
}: {
  ok: boolean;
  warn?: boolean;
  title: string;
  detail?: string;
  mark?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-card p-3.5">
      <span
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
          ok ? "bg-[#00c97222] text-[#38d591]" : warn ? "bg-[#ff980022] text-[#ff9800]" : "bg-raised text-ink-secondary"
        }`}
      >
        {ok ? <Check size={14} /> : <AlertTriangle size={13} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[14px] font-medium text-ink">
          {mark}
          <span className="min-w-0 truncate">{title}</span>
        </div>
        {detail && <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-secondary">{detail}</div>}
        {children}
      </div>
    </div>
  );
}

/** One engine on the setup screen: what it's called, what the harness
 * found, and the one-liner to show when it's good to go. Ready states get
 * a sentence; anything the user has to act on gets the shared setup UI, so
 * the instructions come from the driver and are correct for this platform. */
interface EngineEntry {
  instance: InstanceRow;
  label: string;
  readyNote: string;
}

function engineReady(instance: InstanceRow): boolean {
  return (
    instance.snapshot.state === "available" &&
    (instance.access === "custom" || instance.snapshot.authenticated !== false)
  );
}

function engineTitle({ instance, label }: EngineEntry): string {
  const version = instance?.snapshot.version ? ` · ${instance.snapshot.version.split(" ")[0]}` : "";
  return `${label}${version}`;
}

/** A ready engine needs no attention: a small tile in the grid, so five
 * engines don't read as one long list where the good news and the setup
 * work look the same. */
function ReadyTile(entry: EngineEntry) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-card p-3">
      <ProviderMark driverKind={entry.instance.driverKind} size={17} />
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-medium text-ink">{engineTitle(entry)}</div>
        <div className="mt-0.5 text-[12px] leading-snug text-ink-secondary">{entry.readyNote}</div>
      </div>
    </div>
  );
}

/** An engine that still needs installing or signing in keeps the full-width
 * row: the command box and terminal button need the room. */
function SetupRow(entry: EngineEntry) {
  return (
    <StatusRow
      ok={false}
      warn
      title={engineTitle(entry)}
      mark={<ProviderMark driverKind={entry.instance.driverKind} size={16} />}
    >
      <EngineSetup
        instance={entry.instance}
        className="mt-0.5"
        intent={entry.instance.access === "custom" ? "inject" : "cloud"}
      />
    </StatusRow>
  );
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { capabilities } = useDesktopCapabilities();
  const [step, setStep] = useState(0);
  const resetToken = new URLSearchParams(window.location.search).get("token")?.trim() || "";
  const [authMode, setAuthMode] = useState<AuthMode>(resetToken ? "reset" : "signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [instances, setInstances] = useState<InstanceRow[] | null>(null);
  const [perms, setPerms] = useState<{ mic: string } | null>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const passwordValid = password.length >= (authMode === "signup" || authMode === "reset" ? 8 : 1);
  const canSubmit =
    !loginBusy &&
    ((authMode === "signin" && valid && passwordValid) ||
      (authMode === "signup" && valid && passwordValid) ||
      (authMode === "forgot" && valid) ||
      (authMode === "reset" && resetToken && passwordValid));

  const completeAuth = (session: BetterAuthLoginResponse, fallbackEmail: string, next: "dashboard" | "setup") => {
    saveBetterAuthSession(session);
    identifyEmail(session.user?.email?.trim().toLowerCase() || fallbackEmail);
  // persisted server-side (~/.openmausbot/config.json) — the sidebar
  // footer reads it back through /api/config
    void fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: {
          name: session.user?.name?.trim() || fullName.trim() || fallbackEmail.split("@")[0] || "",
          email: session.user?.email?.trim().toLowerCase() || fallbackEmail,
        },
      }),
    }).catch(() => {});
    setEmailGateDone("submitted");
    if (next === "setup") setStep(1);
    else onDone();
  };

  const submitAuth = async () => {
    if (!canSubmit) return;
    const normalizedEmail = email.trim().toLowerCase();
    setLoginBusy(true);
    setLoginError(null);
    setResetMessage(null);
    try {
      if (authMode === "signup") {
        completeAuth(await signUpWithBetterAuth(fullName.trim(), normalizedEmail, password), normalizedEmail, "setup");
      } else if (authMode === "forgot") {
        const result = await requestPasswordReset(normalizedEmail);
        setResetMessage(result.resetUrl ? `Reset link: ${result.resetUrl}` : "If that account exists, a reset link has been sent.");
      } else if (authMode === "reset") {
        await confirmPasswordReset(resetToken, password);
        setPassword("");
        setAuthMode("signin");
        setResetMessage("Password updated. Sign in with your new password.");
      } else {
        completeAuth(await signInWithBetterAuth(normalizedEmail, password), normalizedEmail, "dashboard");
      }
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Request failed");
    } finally {
      setLoginBusy(false);
    }
  };

  useEffect(() => {
    track("onboarding_step", { step });
  }, [step]);

  useEffect(() => {
    if (step !== 1) return;
    let active = true;
    let latestRequest = 0;
    const refresh = () => {
      const request = ++latestRequest;
      fetch("/api/instances")
        .then((r) => r.json())
        .then((d) => active && request === latestRequest && setInstances(d.instances ?? []))
        .catch(() => active && request === latestRequest && setInstances([]));
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [step]);

  useEffect(() => {
    if (step === 2 && capabilities.dictation.available) {
      const poll = () => window.ogb?.permStatus?.().then(setPerms).catch(() => {});
      poll();
      // keep polling — the user may grant in System Settings and come back
      const t = setInterval(poll, 2000);
      return () => clearInterval(t);
    }
  }, [step, capabilities.dictation.available]);

  const finish = () => {
    track("onboarding_completed", {
      engines_available: instances?.filter((i) => i.snapshot.state === "available").length ?? -1,
      mic: perms?.mic ?? "n/a",
    });
    setEmailGateDone("submitted");
    onDone();
  };

  const engines: EngineEntry[] = (instances ?? [])
    .filter((instance) => instance.install)
    .map((instance) => ({
      instance,
      label: instance.displayName,
      readyNote:
        instance.access === "custom"
          ? "Installed — ready for a local model."
          : "Installed — ready to power bots.",
    }));
  const readyEngines = engines.filter((e) => engineReady(e.instance));
  const setupEngines = engines.filter((e) => !engineReady(e.instance));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-app p-8">
      {/* the engines step lays tiles out two across, so it gets more room —
          but never more than the window: the panel caps at the viewport and
          the engine list scrolls inside it, so the header and Continue stay
          put and nothing runs into the edges */}
      <div
        className={`flex max-h-full w-full flex-col rounded-2xl border border-hairline/40 bg-panel p-8 ${step === 1 ? "max-w-[680px]" : "max-w-[460px]"}`}
      >
        {step === 0 && (
          <div className="flex flex-col items-center">
            <MausAvatar color="green" state="happy" size={72} />
            <h1 className="mt-4 text-[20px] font-semibold text-ink">Welcome to MagicTeams</h1>
            <p className="mt-1.5 text-center text-[14px] leading-relaxed text-ink-secondary">
              {authMode === "signup"
                ? "Create a MagicTeams account to connect this workspace."
                : authMode === "forgot"
                  ? "Enter your email and we will send a reset link."
                  : authMode === "reset"
                    ? "Choose a new password for your MagicTeams account."
                    : "Sign in with your MagicTeams account to connect this workspace."}
            </p>
            {authMode === "signup" && (
              <input
                autoFocus
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canSubmit && submitAuth()}
                placeholder="Full name"
                autoComplete="name"
                className="mt-5 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
              />
            )}
            <input
              autoFocus={authMode !== "signup" && authMode !== "reset"}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canSubmit && submitAuth()}
              placeholder="you@example.com"
              autoComplete="email"
              className={`${authMode === "signup" ? "mt-3" : "mt-5"} ${authMode === "reset" ? "hidden" : ""} w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none`}
            />
            {authMode !== "forgot" && (
              <input
                autoFocus={authMode === "reset"}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canSubmit && submitAuth()}
                placeholder={authMode === "reset" ? "New password" : "Password"}
                autoComplete={authMode === "signin" ? "current-password" : "new-password"}
                className="mt-3 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
              />
            )}
            {(authMode === "signup" || authMode === "reset") && (
              <div className="mt-2 w-full text-[12px] text-ink-secondary">Use at least 8 characters.</div>
            )}
            {loginError && (
              <div className="mt-3 w-full rounded-lg border border-[#ff5a5a33] bg-[#ff5a5a12] px-3 py-2 text-[12.5px] text-[#ff8a8a]">
                {loginError}
              </div>
            )}
            {resetMessage && (
              <div className="mt-3 w-full rounded-lg border border-[#38d59133] bg-[#38d59112] px-3 py-2 text-[12.5px] text-[#85e4ae]">
                {resetMessage}
              </div>
            )}
            <button
              onClick={submitAuth}
              disabled={!canSubmit}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-[15px] font-medium text-white disabled:opacity-40"
            >
              {loginBusy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : authMode === "signup" ? (
                <UserPlus size={15} />
              ) : authMode === "forgot" ? (
                <Mail size={15} />
              ) : (
                <Lock size={15} />
              )}
              {authMode === "signup"
                ? "Create account"
                : authMode === "forgot"
                  ? "Send reset link"
                  : authMode === "reset"
                    ? "Update password"
                    : "Sign in"}
            </button>
            <div className="mt-4 flex w-full items-center justify-between gap-3 text-[12px]">
              <button
                onClick={() => {
                  setAuthMode(authMode === "signup" ? "signin" : "signup");
                  setLoginError(null);
                  setResetMessage(null);
                  setPassword("");
                }}
                className="text-ink-secondary hover:text-ink"
              >
                {authMode === "signup" ? "Have an account? Sign in" : "Create account"}
              </button>
              <button
                onClick={() => {
                  setAuthMode(authMode === "forgot" ? "signin" : "forgot");
                  setLoginError(null);
                  setResetMessage(null);
                  setPassword("");
                }}
                className="text-ink-secondary hover:text-ink"
              >
                {authMode === "forgot" ? "Back to sign in" : "Forgot password?"}
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex min-h-0 flex-col">
            <h1 className="text-[18px] font-semibold text-ink">Your engines</h1>
            <p className="mt-1 text-[13.5px] text-ink-secondary">
              Bots run on AI tools installed on this computer — here&rsquo;s what we found.
            </p>
            <div className="mt-4 flex min-h-0 flex-col gap-2.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {!instances ? (
                <div className="flex items-center gap-2 py-6 text-ink-secondary">
                  <Loader2 size={16} className="animate-spin" /> Checking…
                </div>
              ) : (
                <>
                  {readyEngines.length > 0 && (
                    <>
                      <div className="text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary">Ready</div>
                      <div className="grid grid-cols-2 gap-2.5">
                        {readyEngines.map((e) => (
                          <ReadyTile key={e.label} {...e} />
                        ))}
                      </div>
                    </>
                  )}
                  {setupEngines.length > 0 && (
                    <>
                      <div className={`text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary ${readyEngines.length ? "mt-2" : ""}`}>
                        Needs setup
                      </div>
                      {setupEngines.map((e) => (
                        <SetupRow key={e.label} {...e} />
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
            <button
              onClick={() => (capabilities.dictation.available ? setStep(2) : finish())}
              className="mt-5 w-full shrink-0 rounded-lg bg-accent py-2.5 text-[15px] font-medium text-white"
            >
              Continue
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col">
            <h1 className="text-[18px] font-semibold text-ink">Permissions</h1>
            <p className="mt-1 text-[13.5px] text-ink-secondary">
              Optional, and only ever used when you ask for the feature.
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-3 rounded-xl bg-card p-3.5">
                <div className="flex items-start gap-3">
                  <Mic size={18} className="mt-0.5 shrink-0 text-ink-secondary" />
                  <div>
                    <div className="text-[14px] font-medium text-ink">Microphone & speech</div>
                    <div className="mt-0.5 text-[12.5px] text-ink-secondary">
                      Voice dictation into the composer, transcribed on-device.
                    </div>
                  </div>
                </div>
                {perms?.mic === "granted" ? (
                  <Check size={16} className="shrink-0 text-[#38d591]" />
                ) : perms?.mic === "denied" || perms?.mic === "restricted" ? (
                  <button
                    onClick={() => window.ogb?.permOpenSettings?.("mic")}
                    className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover"
                  >
                    Open Settings
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      window.ogb?.permRequestMic?.().then(() => window.ogb?.permStatus?.().then(setPerms))
                    }
                    className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover"
                  >
                    Enable
                  </button>
                )}
              </div>
              {/* Screen Recording deliberately has no row here: macOS 15+
                  makes a pre-grant unreliable (per-process status caching,
                  helper misattribution, periodic re-prompts) — the OS flow
                  triggers on the first real capture in the Computer panel,
                  which is the moment the user has context for the dialog. */}
            </div>
            <button onClick={finish} className="mt-5 w-full rounded-lg bg-accent py-2.5 text-[15px] font-medium text-white">
              Start using MagicTeams
            </button>
            <button onClick={finish} className="mt-3 text-[12px] text-ink-secondary hover:text-ink">
              Skip for now
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
