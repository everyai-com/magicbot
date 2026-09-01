import { useCallback, useEffect, useState } from "react";
import { api } from "@/state/store";
import { AUTONOMY_MODES, type AutonomyMode, type AutonomyVerdict } from "../../shared/autonomy";
import { Card } from "./SettingsPrimitives";
import { cn } from "@/lib/cn";

type PolicyRow = {
  id: string;
  scope_type: "account" | "bot" | "connector" | "contact" | "tool";
  scope_key: string;
  mode: AutonomyMode;
  max_per_hour: number | null;
  max_per_day: number | null;
};
type DecisionRow = {
  id: string;
  connector: string;
  action: string;
  verdict: AutonomyVerdict;
  reason: string;
  created_at: number;
};
type AutonomyResponse = { policies: PolicyRow[]; decisions: DecisionRow[] };

const LABELS: Record<AutonomyMode, { title: string; detail: string }> = {
  never: { title: "Never", detail: "Block all access" },
  observe: { title: "Observe", detail: "Read only" },
  draft: { title: "Draft", detail: "Prepare for review" },
  ask: { title: "Ask", detail: "Approve each action" },
  act: { title: "Act", detail: "Run within limits" },
};

export function ModePicker({ value, disabled, onChange }: { value: AutonomyMode; disabled: boolean; onChange: (mode: AutonomyMode) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {AUTONOMY_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          disabled={disabled}
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
          className={cn(
            "min-w-0 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50",
            value === mode ? "border-accent bg-accent/10" : "border-hairline/40 bg-inset hover:bg-control",
          )}
        >
          <div className="text-[13px] font-medium text-ink">{LABELS[mode].title}</div>
          <div className="mt-0.5 text-[10.5px] leading-tight text-ink-secondary">{LABELS[mode].detail}</div>
        </button>
      ))}
    </div>
  );
}

export function BotAutonomySettings({ botId }: { botId: string }) {
  const [mode, setMode] = useState<AutonomyMode>("ask");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void (api("/api/autonomy") as Promise<AutonomyResponse>).then((result) => {
      const current = result.policies.find((item) => item.scope_type === "bot" && item.scope_key === botId);
      if (live) setMode(current?.mode ?? "ask");
    }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "Could not load bot autonomy"); });
    return () => { live = false; };
  }, [botId]);

  const save = async (next: AutonomyMode) => {
    setSaving(true); setError("");
    try {
      await api("/api/autonomy", { method: "PUT", body: JSON.stringify({ scopeType: "bot", scopeKey: botId, mode: next }) });
      setMode(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save bot autonomy");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Autonomy</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">Controls this bot across connected apps. Sensitive and destructive actions still stop for approval.</div>
      <div className="mt-3"><ModePicker value={mode} disabled={saving} onChange={(next) => void save(next)} /></div>
      {error ? <div role="alert" className="mt-2 text-[12px] text-danger">{error}</div> : null}
    </div>
  );
}

export function AutonomySettings() {
  const [data, setData] = useState<AutonomyResponse>({ policies: [], decisions: [] });
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setData(await api("/api/autonomy") as AutonomyResponse);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load autonomy controls");
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const policy = (scopeType: PolicyRow["scope_type"], scopeKey: string) =>
    data.policies.find((item) => item.scope_type === scopeType && item.scope_key === scopeKey);
  const account = policy("account", "");
  const whatsapp = policy("connector", "whatsapp");

  const save = async (scopeType: PolicyRow["scope_type"], scopeKey: string, mode: AutonomyMode, maxPerHour?: number, maxPerDay?: number) => {
    const key = `${scopeType}:${scopeKey}`;
    setSaving(key); setError("");
    try {
      await api("/api/autonomy", {
        method: "PUT",
        body: JSON.stringify({ scopeType, scopeKey, mode, maxPerHour, maxPerDay }),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save autonomy policy");
    } finally {
      setSaving("");
    }
  };

  return (
    <Card title="Agent autonomy" subtitle="Choose what your agents may do. More specific bot, app, and contact rules override the account default.">
      <div className="flex flex-col gap-5">
        {error ? <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div> : null}
        <section>
          <div className="mb-2">
            <div className="text-[13px] font-medium text-ink">Account default</div>
            <div className="text-[11.5px] text-ink-secondary">Used when an app, bot, or person has no specific rule.</div>
          </div>
          <ModePicker value={account?.mode ?? "ask"} disabled={Boolean(saving)} onChange={(mode) => void save("account", "", mode)} />
        </section>
        <section className="border-t border-hairline/30 pt-4">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-[13px] font-medium text-ink">WhatsApp</div>
              <div className="text-[11.5px] text-ink-secondary">Sensitive messages always require approval, even in Act mode.</div>
            </div>
            <div className="text-[10.5px] text-ink-secondary">Act limit: 5/hour · 30/day</div>
          </div>
          <ModePicker value={whatsapp?.mode ?? "draft"} disabled={Boolean(saving)} onChange={(mode) => void save("connector", "whatsapp", mode, 5, 30)} />
        </section>
        <section className="border-t border-hairline/30 pt-4">
          <div className="text-[13px] font-medium text-ink">Recent decisions</div>
          <div className="mt-2 flex max-h-56 flex-col gap-1.5 overflow-y-auto">
            {data.decisions.length ? data.decisions.slice(0, 12).map((decision) => (
              <div key={decision.id} className="flex items-start gap-2 rounded-lg bg-inset px-2.5 py-2 text-[11.5px]">
                <span className={cn(
                  "mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase",
                  decision.verdict === "allow" ? "bg-success/15 text-success" :
                    decision.verdict === "deny" ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning",
                )}>{decision.verdict}</span>
                <div className="min-w-0">
                  <div className="truncate text-ink">{decision.connector || "agent"} · {decision.action}</div>
                  <div className="text-ink-secondary">{decision.reason}</div>
                </div>
              </div>
            )) : <div className="text-[11.5px] text-ink-secondary">Actions will appear here with the rule and reason that decided them.</div>}
          </div>
        </section>
      </div>
    </Card>
  );
}
