import { useState } from "react";
import { Plus } from "lucide-react";

type Option = { id: string; name: string };
export type VoiceCampaignFields = {
  venue_name: string; venue_location: string; age_range: string;
  start_date: string; end_date: string; agent_id: string; phone_config_ids: string[];
  delay_seconds: number; booking_target: string; enable_number_locking: boolean;
  round: number; status: string; times: string; twilio_phone_number: string;
  elevenlabs_campaign_id: string; notes: string;
};
export const initialVoiceCampaign: VoiceCampaignFields = { venue_name: "", venue_location: "", age_range: "", start_date: "", end_date: "", agent_id: "", phone_config_ids: [], delay_seconds: 30, booking_target: "", enable_number_locking: true, round: 1, status: "draft", times: "", twilio_phone_number: "", elevenlabs_campaign_id: "", notes: "" };
const input = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink";
export function NewVoiceCampaign({ agents, phones, contactCount, onCreate, onCancel, initialValues, editing = false }: { initialValues?: VoiceCampaignFields; editing?: boolean; agents: Option[]; phones: Option[]; contactCount: number; onCreate: (fields: VoiceCampaignFields) => Promise<boolean>; onCancel: () => void }) {
  const [fields, setFields] = useState(initialValues ?? initialVoiceCampaign);
  const [saving, setSaving] = useState(false);
  const textFields = [ ["venue_name", "Venue Name", "text", "Required"], ["venue_location", "Location", "text", ""], ["age_range", "Age Range", "text", "e.g. 5–12"], ["start_date", "Start Date", "date", ""], ["end_date", "End Date", "date", ""], ["booking_target", "Booking Target", "number", ""], ["times", "Times", "text", "e.g. 9am–3pm"], ["twilio_phone_number", "Twilio Phone Number", "tel", "+44…"], ["elevenlabs_campaign_id", "ElevenLabs Campaign ID", "text", "Optional"] ] as const;
  return <form className="rounded-xl bg-card p-4" onSubmit={async (event) => { event.preventDefault(); setSaving(true); try { if (await onCreate(fields)) onCancel(); } finally { setSaving(false); } }}>
    <h3 className="mb-1 flex items-center gap-2 text-base font-semibold"><Plus size={18} />{editing ? "Edit Campaign" : "New Campaign"}</h3>
    <p className="mb-4 text-[13px] text-ink-secondary">{editing ? "Update campaign settings. Existing contacts are preserved." : contactCount ? `${contactCount} contacts from your processed CSV will be included.` : "Create a campaign, then add contacts from Data cleaning."} Creating does not start calls.</p>
    <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
      {textFields.map(([key, label, type, placeholder]) => <label key={key} className={(key === "venue_name" || key === "elevenlabs_campaign_id" ? "sm:col-span-2 " : "") + "flex flex-col gap-1 text-[13px] text-ink-secondary"}>{label}{key === "venue_name" ? " *" : ""}<input className={input} type={type} required={key === "venue_name"} min={key === "end_date" ? fields.start_date : type === "number" ? 0 : undefined} step={type === "number" ? 1 : undefined} placeholder={placeholder} value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} /></label>)}
      <label className="text-[13px]">Agent<select className={input} value={fields.agent_id} onChange={(e) => setFields({ ...fields, agent_id: e.target.value })}><option value="">Select agent</option>{agents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="text-[13px]">Phone Numbers<select multiple className={input} value={fields.phone_config_ids} onChange={(e) => setFields({ ...fields, phone_config_ids: Array.from(e.target.selectedOptions, (option) => option.value) })}>{phones.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className="text-xs text-ink-secondary">Use ⌘ / Ctrl to select multiple numbers.</span></label>
      <label className="text-[13px]">Delay Between Calls (sec)<input className={input} type="number" min={1} max={3600} required value={fields.delay_seconds} onChange={(e) => setFields({ ...fields, delay_seconds: Number(e.target.value) })} /></label>
      <label className="text-[13px]">Round<select className={input} value={fields.round} onChange={(e) => setFields({ ...fields, round: Number(e.target.value) })}>{[1, 2, 3].map((round) => <option key={round} value={round}>Round {round}</option>)}</select></label>
      <label className="text-[13px]">Status<select className={input} value={fields.status} onChange={(e) => setFields({ ...fields, status: e.target.value })}>{["draft", "active", "running", "paused", "completed"].map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={fields.enable_number_locking} onChange={(e) => setFields({ ...fields, enable_number_locking: e.target.checked })} />Enable Number Locking</label>
      <label className="text-[13px] sm:col-span-2">Notes<textarea className={input} rows={3} value={fields.notes} onChange={(e) => setFields({ ...fields, notes: e.target.value })} /></label>
      <div className="flex gap-2 sm:col-span-2"><button className="rounded-lg bg-accent px-4 py-2 text-sm text-white" type="submit">{saving ? "Saving…" : editing ? "Save changes" : "Create"}</button><button className={input + " w-auto"} type="button" onClick={onCancel}>Cancel</button></div>
    </fieldset>
  </form>;
}
