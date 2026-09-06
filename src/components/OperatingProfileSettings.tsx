import { useEffect, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { normalizeOperatingProfile, type OperatingProfile } from "../../shared/operating-profile";
import { api } from "@/state/store";
import { Card } from "./SettingsPrimitives";

const emptyProfile = normalizeOperatingProfile({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
const inputClass = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";
const labelClass = "flex flex-col gap-1.5 text-[12px] font-medium text-ink-secondary";

const listText = (items: string[]) => items.join("\n");
const textList = (value: string) => value.split(/\n|,/).map((item) => item.trim()).filter(Boolean);

export function OperatingProfileSettings() {
  const [profile, setProfile] = useState<OperatingProfile>(emptyProfile);
  const [rolesText, setRolesText] = useState("");
  const [prioritiesText, setPrioritiesText] = useState("");
  const [boundariesText, setBoundariesText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void api("/api/operating-profile")
      .then((result: { profile: OperatingProfile }) => {
        if (!active) return;
        const next = normalizeOperatingProfile(result.profile);
        setProfile(next);
        setRolesText(listText(next.roles));
        setPrioritiesText(listText(next.priorities));
        setBoundariesText(listText(next.boundaries));
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load profile"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const pending = normalizeOperatingProfile({
        ...profile, roles: textList(rolesText), priorities: textList(prioritiesText), boundaries: textList(boundariesText),
      });
      const result = await api("/api/operating-profile", {
        method: "PUT", body: JSON.stringify(pending),
      }) as { profile: OperatingProfile };
      const next = normalizeOperatingProfile(result.profile);
      setProfile(next);
      setRolesText(listText(next.roles));
      setPrioritiesText(listText(next.priorities));
      setBoundariesText(listText(next.boundaries));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save profile");
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof OperatingProfile>(key: K, value: OperatingProfile[K]) => setProfile((current) => ({ ...current, [key]: value }));

  return (
    <Card
      title="How your agents should work with you"
      subtitle="Saved once for this account and supplied to every hosted bot when relevant. This replaces copying the same profile file into every bot."
    >
      {loading ? (
        <div className="flex items-center gap-2 py-2 text-[13px] text-ink-secondary"><LoaderCircle size={15} className="animate-spin" />Loading profile…</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={labelClass}>Your roles
            <textarea rows={3} value={rolesText} onChange={(event) => setRolesText(event.target.value)} placeholder={"Founder\nProduct lead"} className={inputClass} />
          </label>
          <label className={labelClass}>Current priorities
            <textarea rows={3} value={prioritiesText} onChange={(event) => setPrioritiesText(event.target.value)} placeholder={"Ship the web app\nGrow active users"} className={inputClass} />
          </label>
          <label className={labelClass}>Working style
            <textarea rows={4} value={profile.workingStyle} onChange={(event) => update("workingStyle", event.target.value)} placeholder="How you plan, decide, and like work presented" className={inputClass} />
          </label>
          <label className={labelClass}>Communication preferences
            <textarea rows={4} value={profile.communicationStyle} onChange={(event) => update("communicationStyle", event.target.value)} placeholder="Concise updates, lead with outcomes, flag risks early…" className={inputClass} />
          </label>
          <label className={labelClass}>Boundaries
            <textarea rows={3} value={boundariesText} onChange={(event) => setBoundariesText(event.target.value)} placeholder={"Ask before messaging people\nNever publish without approval"} className={inputClass} />
          </label>
          <label className={labelClass}>Timezone
            <input value={profile.timezone} onChange={(event) => update("timezone", event.target.value)} placeholder="Asia/Kolkata" className={inputClass} />
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60">
              {saving && <LoaderCircle size={14} className="animate-spin" />}{saving ? "Saving…" : "Save operating profile"}
            </button>
            {saved && <span className="inline-flex items-center gap-1 text-[12px] text-success"><Check size={13} />Saved for all hosted bots</span>}
            {error && <span role="alert" className="text-[12px] text-danger">{error}</span>}
          </div>
        </div>
      )}
    </Card>
  );
}
