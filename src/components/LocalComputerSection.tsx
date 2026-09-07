import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Copy, Eye, EyeOff, KeyRound, Link2, Loader2, MessageCircle, MoreVertical, Pencil, Phone, RefreshCw, Search, Trash2, UploadCloud, Users, X } from "lucide-react";
import { Card } from "./SettingsPrimitives";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";

const SETUP_ITEMS = [
  {
    id: "phone",
    title: "Phone Integration",
    description: "Connect Twilio or Telnyx numbers for inbound and outbound calls.",
    detail: "Phone numbers are configured from each agent's Bot profile under Call forwarding.",
    actions: ["Add phone provider", "Assign phone number", "Choose inbound or outbound usage"],
    icon: Phone,
    opensIntegrations: false,
  },
  {
    id: "calendars",
    title: "Calendars",
    description: "Connect calendars so agents can read availability and book appointments.",
    detail: "Use Integrations to connect Google Calendar, then add calendar-backed appointment tools to agents.",
    actions: ["Connect Google Calendar", "Choose calendar account", "Create appointment tools"],
    icon: CalendarDays,
    opensIntegrations: true,
  },
  {
    id: "whatsapp-contacts",
    title: "WhatsApp Contacts",
    description: "Import, organize, and maintain WhatsApp contact records.",
    detail: "WhatsApp contact management is listed here so it is grouped with setup work.",
    actions: ["Import contacts", "Review contact fields", "Update WhatsApp phone records"],
    icon: Users,
    opensIntegrations: false,
  },
  {
    id: "whatsapp-audiences",
    title: "WhatsApp Audiences",
    description: "Group WhatsApp contacts into targeted audiences for campaigns.",
    detail: "WhatsApp audiences are listed here so campaigns and contact groups stay under setup.",
    actions: ["Create audience", "Select contacts"],
    icon: MessageCircle,
    opensIntegrations: false,
  },
  {
    id: "whatsapp-integrations",
    title: "WhatsApp Integrations",
    description: "Configure WhatsApp auto-replies and integration webhook forwarding.",
    detail: "Save the auto-reply webhook URL used to forward inbound WhatsApp messages.",
    actions: ["Enable AI auto-replies", "Save webhook URL"],
    icon: Link2,
    opensIntegrations: false,
  },
  {
    id: "whatsapp-api",
    title: "WhatsApp API",
    description: "Save Meta credentials and copy webhook details for WhatsApp Cloud API.",
    detail: "Validate and save the Meta access token, phone number ID, WABA ID, and app ID.",
    actions: ["Validate credentials", "Save API settings", "Copy webhook URL and verify token"],
    icon: KeyRound,
    opensIntegrations: false,
  },
] as const;

type SetupId = (typeof SETUP_ITEMS)[number]["id"];

interface AudienceContact {
  id: string;
  name: string;
  phone: string;
}

interface SavedAudience {
  id: string;
  name: string;
  description: string | null;
  contactIds: string[];
  contacts: AudienceContact[];
}

interface ToolkitCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  domain: string | null;
  authConfigId?: string;
}

interface ConnectorStatus {
  connected: boolean;
  pending?: boolean;
  status?: string;
  accounts?: Array<{
    id: string;
    alias?: string;
    status: string;
  }>;
}

type PhoneProvider = "twilio" | "telnyx";

interface PhoneConfigRecord {
  id: string;
  provider: PhoneProvider;
  phoneNumber: string;
  channel: string;
  friendlyName?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  telnyxApiKey?: string;
  telnyxConnectionId?: string;
  telnyxPublicKey?: string;
  isActive?: boolean;
}

const PHONE_PROVIDER_META: Record<PhoneProvider, { name: string; description: string; logo: string }> = {
  twilio: {
    name: "Twilio",
    description: "Industry-standard cloud communications platform for voice calls.",
    logo: "T",
  },
  telnyx: {
    name: "Telnyx",
    description: "Carrier-grade voice platform for inbound and outbound calling.",
    logo: "TX",
  },
};

function normalizePhoneConfig(row: unknown): PhoneConfigRecord | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const id = String(record.id ?? record._id ?? "");
  const phoneNumber = String(record.phone_number ?? record.phoneNumber ?? "");
  const provider = String(record.provider ?? "").toLowerCase();
  if (!id || !phoneNumber || (provider !== "twilio" && provider !== "telnyx")) return null;
  return {
    id,
    provider,
    phoneNumber,
    channel: String(record.channel ?? "voice"),
    friendlyName: typeof record.friendly_name === "string" ? record.friendly_name : typeof record.friendlyName === "string" ? record.friendlyName : undefined,
    twilioAccountSid: typeof record.twilio_account_sid === "string" ? record.twilio_account_sid : undefined,
    twilioAuthToken: typeof record.twilio_auth_token === "string" ? record.twilio_auth_token : undefined,
    telnyxApiKey: typeof record.telnyx_api_key === "string" ? record.telnyx_api_key : undefined,
    telnyxConnectionId: typeof record.telnyx_connection_id === "string" ? record.telnyx_connection_id : undefined,
    telnyxPublicKey: typeof record.telnyx_public_key === "string" ? record.telnyx_public_key : undefined,
    isActive: typeof record.is_active === "boolean" ? record.is_active : typeof record.isActive === "boolean" ? record.isActive : undefined,
  };
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-accent" : "bg-control",
      )}
    >
      <span className={cn("absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-all", checked ? "left-[21px]" : "left-[3px]")} />
    </button>
  );
}

function useWhatsAppConfig() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [config, setConfig] = useState<{
    autoReply?: { is_enabled?: boolean; webhook_url?: string };
    api?: {
      configured?: boolean;
      access_token?: string;
      phone_number_id?: string;
      business_account_id?: string;
      app_id?: string;
      display_phone_number?: string;
      verified_name?: string;
    };
    webhook?: { webhook_key?: string; webhook_url?: string; verify_token?: string; account_email?: string };
  }>({});

  const load = () => {
    setLoading(true);
    setError("");
    api("/api/whatsapp/configs")
      .then(setConfig)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load WhatsApp settings."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  return { loading, error, config, setConfig, setError, load };
}

function WhatsAppIntegrationsPanel() {
  const { loading, error, config, setError } = useWhatsAppConfig();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    setEnabled(config.autoReply?.is_enabled === true);
    setWebhookUrl(config.autoReply?.webhook_url ?? "");
  }, [config.autoReply?.is_enabled, config.autoReply?.webhook_url]);

  const save = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api("/api/whatsapp/configs/auto-reply", {
        method: "POST",
        body: JSON.stringify({ is_enabled: enabled, webhook_url: webhookUrl.trim() }),
      });
      setMessage("WhatsApp integrations saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save WhatsApp integrations.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingRow label="Loading WhatsApp integrations..." />;

  return (
    <div className="rounded-lg border border-hairline/35 bg-inset p-3">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-hairline/30 bg-card px-3 py-3">
        <div>
          <div className="text-[13.5px] font-medium text-ink">AI Auto-Replies</div>
          <div className="mt-1 text-[12px] text-ink-secondary">Forward inbound WhatsApp messages to an external automation URL.</div>
        </div>
        <Toggle checked={enabled} onChange={setEnabled} disabled={saving} />
      </div>
      <label className="mt-3 flex flex-col gap-1.5 text-[12.5px] font-medium text-ink">
        Webhook URL
        <input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://example.com/whatsapp-auto-reply" className={inputClass} />
      </label>
      <button type="button" onClick={() => void save()} disabled={saving} className={primaryButtonClass}>
        {saving ? "Saving..." : "Save Integrations"}
      </button>
      <div className="mt-4 grid gap-3">
        <div className="rounded-lg border border-hairline/30 bg-card px-3 py-3">
          <div className="text-[13px] font-medium text-ink">How it works</div>
          <div className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-ink-secondary">
            <div>1. A customer sends a WhatsApp message.</div>
            <div>2. MagicTeams receives the inbound Meta webhook.</div>
            <div>3. If AI Auto-Replies is enabled, MagicTeams posts the message payload to this webhook URL.</div>
            <div>4. Your endpoint returns reply text, and MagicTeams sends it back to the customer.</div>
          </div>
        </div>
        <div className="rounded-lg border border-hairline/30 bg-card px-3 py-3">
          <div className="text-[13px] font-medium text-ink">Response format</div>
          <div className="mt-2 text-[12px] leading-relaxed text-ink-secondary">
            Your AI service should return JSON with a <span className="font-mono text-ink">reply_message</span> field.
          </div>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-hairline/25 bg-inset px-3 py-2 text-[11.5px] leading-relaxed text-ink">
{`{
  "reply_message": "Hello! How can I help you?"
}`}
          </pre>
          <div className="mt-3 text-[13px] font-medium text-ink">Sending multiple messages</div>
          <div className="mt-2 text-[12px] leading-relaxed text-ink-secondary">
            Use <span className="font-mono text-ink">||</span> to split replies into separate WhatsApp messages.
          </div>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-hairline/25 bg-inset px-3 py-2 text-[11.5px] leading-relaxed text-ink">
{`{
  "reply_message": "Hello!||Here is your information..."
}`}
          </pre>
          <div className="mt-3 text-[13px] font-medium text-ink">Newlines in message</div>
          <div className="mt-2 text-[12px] leading-relaxed text-ink-secondary">
            Use <span className="font-mono text-ink">\\n</span> for new lines inside one WhatsApp message.
          </div>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-hairline/25 bg-inset px-3 py-2 text-[11.5px] leading-relaxed text-ink">
{`{
  "reply_message": "Line 1\\nLine 2\\nLine 3"
}`}
          </pre>
          <div className="mt-3 text-[13px] font-medium text-ink">No auto-reply</div>
          <div className="mt-2 text-[12px] leading-relaxed text-ink-secondary">
            Return any response without <span className="font-mono text-ink">reply_message</span> to skip the auto-reply.
          </div>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-hairline/25 bg-inset px-3 py-2 text-[11.5px] leading-relaxed text-ink">
{`// Return empty body or any JSON without reply_message
{}`}
          </pre>
          <div className="mt-3 rounded-lg border border-accent/20 bg-accent/10 px-3 py-2 text-[12px] leading-relaxed text-ink-secondary">
            <span className="font-medium text-ink">Tip:</span> You do not need to include the customer's phone number. MagicTeams automatically routes your reply back to the sender.
          </div>
        </div>
      </div>
      <StatusMessages message={message} error={error} />
    </div>
  );
}

function WhatsAppApiPanel() {
  const { loading, error, config, setError, setConfig } = useWhatsAppConfig();
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [message, setMessage] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [appId, setAppId] = useState("");
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState("");
  const [verifiedName, setVerifiedName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [verifyToken, setVerifyToken] = useState("");

  useEffect(() => {
    setAccessToken(config.api?.access_token ?? "");
    setPhoneNumberId(config.api?.phone_number_id ?? "");
    setBusinessAccountId(config.api?.business_account_id ?? "");
    setAppId(config.api?.app_id ?? "");
    setDisplayPhoneNumber(config.api?.display_phone_number ?? "");
    setVerifiedName(config.api?.verified_name ?? "");
    setWebhookUrl(config.webhook?.webhook_url ?? "");
    setVerifyToken(config.webhook?.verify_token ?? "");
  }, [
    config.api?.access_token,
    config.api?.phone_number_id,
    config.api?.business_account_id,
    config.api?.app_id,
    config.api?.display_phone_number,
    config.api?.verified_name,
    config.webhook?.webhook_url,
    config.webhook?.verify_token,
  ]);

  const apiConfigured = config.api?.configured === true;

  const validateCredentials = async () => {
    setValidating(true);
    setError("");
    setMessage("");
    try {
      const result = await api("/api/whatsapp/configs/validate", {
        method: "POST",
        body: JSON.stringify({
          accessToken: accessToken.trim(),
          phoneNumberId: phoneNumberId.trim(),
          businessAccountId: businessAccountId.trim(),
        }),
      });
      setDisplayPhoneNumber(result.display_phone_number ?? "");
      setVerifiedName(result.verified_name ?? "");
      setMessage("Meta credentials validated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not validate Meta credentials.");
    } finally {
      setValidating(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const body = await api("/api/whatsapp/configs/api", {
        method: "POST",
        body: JSON.stringify({
          meta_access_token: accessToken.trim(),
          meta_phone_number_id: phoneNumberId.trim(),
          meta_business_account_id: businessAccountId.trim(),
          meta_app_id: appId.trim(),
          display_phone_number: displayPhoneNumber,
          verified_name: verifiedName,
        }),
      });
      setConfig((current) => ({ ...current, api: body.api, webhook: body.webhook }));
      setAccessToken(body.api?.access_token ?? "");
      setPhoneNumberId(body.api?.phone_number_id ?? "");
      setBusinessAccountId(body.api?.business_account_id ?? "");
      setAppId(body.api?.app_id ?? "");
      setDisplayPhoneNumber(body.api?.display_phone_number ?? "");
      setVerifiedName(body.api?.verified_name ?? "");
      setWebhookUrl(body.webhook?.webhook_url ?? "");
      setVerifyToken(body.webhook?.verify_token ?? "");
      setMessage("WhatsApp API settings saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save WhatsApp API settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingRow label="Loading WhatsApp API settings..." />;

  return (
    <div className="rounded-lg border border-hairline/35 bg-inset p-3">
      {apiConfigured ? <div className="mb-3 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-[12.5px] text-success">WhatsApp API credentials are saved.</div> : null}
      <div className="grid grid-cols-1 gap-3">
        <SecretField label="Webhook URL" value={webhookUrl} placeholder="Generated webhook URL" readOnly />
        <SecretField label="Verify Token" value={verifyToken} placeholder="Generated verify token" readOnly />
        <SecretField label="Meta Access Token" value={accessToken} onChange={setAccessToken} placeholder={apiConfigured ? "Leave blank to keep saved token" : "Paste Meta access token"} />
        <SecretField label="Meta Phone Number ID" value={phoneNumberId} onChange={setPhoneNumberId} placeholder="Meta phone number ID" />
        <SecretField label="Meta Business Account ID (WABA ID)" value={businessAccountId} onChange={setBusinessAccountId} placeholder="WhatsApp business account ID" />
        <SecretField label="Meta App ID" value={appId} onChange={setAppId} placeholder="Meta app ID" />
        {displayPhoneNumber || verifiedName ? (
          <div className="rounded-lg border border-hairline/30 bg-card px-3 py-2 text-[12.5px] text-ink-secondary">
            {verifiedName ? <div>Verified name: <span className="text-ink">{verifiedName}</span></div> : null}
            {displayPhoneNumber ? <div>Phone: <span className="text-ink">{displayPhoneNumber}</span></div> : null}
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={() => void validateCredentials()} disabled={saving || validating} className="rounded-lg border border-hairline/40 px-3 py-2 text-[13px] font-medium text-ink hover:bg-control disabled:opacity-50">
          {validating ? "Validating..." : "Validate Credentials"}
        </button>
        <button type="button" onClick={() => void save()} disabled={saving || validating} className={primaryButtonClass}>
          {saving ? "Saving..." : "Save WhatsApp API"}
        </button>
      </div>
      <StatusMessages message={message} error={error} />
    </div>
  );
}

function SecretField({
  label,
  value,
  onChange,
  placeholder,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder: string;
  readOnly?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyValue = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <label className={fieldLabelClass}>
      {label}
      <div className="flex min-h-10 overflow-hidden rounded-lg border border-hairline/40 bg-card focus-within:border-accent">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder={placeholder}
          readOnly={readOnly || !onChange}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none read-only:cursor-default"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="grid w-10 place-items-center border-l border-hairline/30 text-ink-secondary hover:bg-control hover:text-ink"
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          title={visible ? `Hide ${label}` : `Show ${label}`}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <button
          type="button"
          onClick={() => void copyValue()}
          disabled={!value}
          className="grid w-10 place-items-center border-l border-hairline/30 text-ink-secondary hover:bg-control hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Copy ${label}`}
          title={`Copy ${label}`}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
    </label>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-hairline/35 bg-inset px-3 py-4 text-[13px] text-ink-secondary">
      <Loader2 size={14} className="animate-spin" />
      {label}
    </div>
  );
}

function StatusMessages({ message, error }: { message: string; error: string }) {
  return (
    <>
      {message ? <div className="mt-3 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-[12.5px] text-success">{message}</div> : null}
      {error ? <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
    </>
  );
}

const fieldLabelClass = "flex flex-col gap-1.5 text-[12.5px] font-medium text-ink";
const inputClass = "w-full rounded-lg border border-hairline/40 bg-card px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-accent focus:outline-none";
const primaryButtonClass = "mt-4 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50";

function PhoneIntegrationPanel() {
  const [configs, setConfigs] = useState<PhoneConfigRecord[]>([]);
  const [provider, setProvider] = useState<PhoneProvider>("twilio");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [twilioAccountSid, setTwilioAccountSid] = useState("");
  const [twilioAuthToken, setTwilioAuthToken] = useState("");
  const [telnyxApiKey, setTelnyxApiKey] = useState("");
  const [telnyxConnectionId, setTelnyxConnectionId] = useState("");
  const [telnyxPublicKey, setTelnyxPublicKey] = useState("");
  const [editingId, setEditingId] = useState("");
  const [menuId, setMenuId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    return api("/api/platform/phone-configs")
      .then((result: { phoneConfigs?: unknown }) => {
        const rows = Array.isArray(result.phoneConfigs) ? result.phoneConfigs : [];
        setConfigs(rows.map(normalizePhoneConfig).filter((config): config is PhoneConfigRecord => config !== null));
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load phone numbers."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setProvider("twilio");
    setPhoneNumber("");
    setTwilioAccountSid("");
    setTwilioAuthToken("");
    setTelnyxApiKey("");
    setTelnyxConnectionId("");
    setTelnyxPublicKey("");
    setEditingId("");
    setMenuId("");
  };

  const editConfig = (config: PhoneConfigRecord) => {
    setProvider(config.provider);
    setPhoneNumber(config.phoneNumber);
    setTwilioAccountSid(config.twilioAccountSid ?? "");
    setTwilioAuthToken(config.twilioAuthToken ?? "");
    setTelnyxApiKey(config.telnyxApiKey ?? "");
    setTelnyxConnectionId(config.telnyxConnectionId ?? "");
    setTelnyxPublicKey(config.telnyxPublicKey ?? "");
    setEditingId(config.id);
    setMenuId("");
    setMessage("");
    setError("");
  };

  const save = async () => {
    const trimmedPhone = phoneNumber.trim();
    if (!trimmedPhone) {
      setError("Phone number is required.");
      return;
    }
    if (provider === "twilio" && (!twilioAccountSid.trim() || (!editingId && !twilioAuthToken.trim()))) {
      setError("Twilio Account SID and Auth Token are required.");
      return;
    }
    if (provider === "telnyx" && ((!editingId && !telnyxApiKey.trim()) || !telnyxConnectionId.trim() || !telnyxPublicKey.trim())) {
      setError("Telnyx API Key, Connection ID, and Public Key are required.");
      return;
    }

    const body: Record<string, string> = {
      provider,
      channel: "voice",
      phone_number: trimmedPhone,
    };
    if (provider === "twilio") {
      body.twilio_account_sid = twilioAccountSid.trim();
      if (twilioAuthToken.trim()) body.twilio_auth_token = twilioAuthToken.trim();
    } else {
      if (telnyxApiKey.trim()) body.telnyx_api_key = telnyxApiKey.trim();
      body.telnyx_connection_id = telnyxConnectionId.trim();
      body.telnyx_public_key = telnyxPublicKey.trim();
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api(editingId ? `/api/platform/phone-configs/${encodeURIComponent(editingId)}` : "/api/platform/phone-configs", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      await load();
      setMessage(editingId ? "Phone provider updated." : "Phone provider saved.");
      resetForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save phone provider.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (config: PhoneConfigRecord) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api(`/api/platform/phone-configs/${encodeURIComponent(config.id)}`, { method: "DELETE" });
      await load();
      if (editingId === config.id) resetForm();
      setMessage("Phone provider deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete phone provider.");
    } finally {
      setSaving(false);
      setMenuId("");
    }
  };

  const toggleActive = async (config: PhoneConfigRecord) => {
    const nextActive = config.isActive === false ? true : false;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api(`/api/platform/phone-configs/${encodeURIComponent(config.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: nextActive }),
      });
      await load();
      setMessage(nextActive ? "Phone provider marked active." : "Phone provider marked inactive.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update phone provider status.");
    } finally {
      setSaving(false);
      setMenuId("");
    }
  };

  const notePendingProviderAction = (label: string) => {
    setMessage(`${label} is not available from this local setup panel yet.`);
    setError("");
    setMenuId("");
  };

  return (
    <div className="mt-4 rounded-lg border border-hairline/35 bg-card p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[14px] font-semibold text-ink">Phone Providers</div>
          <div className="mt-0.5 text-[12px] text-ink-secondary">
            {configs.length ? `${configs.length} saved voice number${configs.length === 1 ? "" : "s"}` : "No voice numbers saved"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-hairline/40 px-3 text-[12.5px] text-ink hover:bg-control"
        >
          <RefreshCw size={14} className={cn(loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {loading ? <div className="mt-3"><LoadingRow label="Loading phone providers..." /></div> : null}
      {!loading && configs.length > 0 ? (
        <div className="mt-3 overflow-visible rounded-lg border border-hairline/35 bg-inset">
          {configs.map((config) => (
            <div key={config.id} className="relative grid grid-cols-[1fr_auto] items-center gap-3 border-b border-hairline/20 px-3 py-3 last:border-b-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="grid size-8 place-items-center rounded-lg bg-control text-[11px] font-semibold text-ink">
                    {PHONE_PROVIDER_META[config.provider].logo}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink">{config.phoneNumber}</span>
                    <span className="mt-0.5 block truncate text-[12px] text-ink-secondary">
                      {PHONE_PROVIDER_META[config.provider].name}{config.friendlyName ? ` · ${config.friendlyName}` : ""}
                    </span>
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMenuId((current) => current === config.id ? "" : config.id)}
                className="grid size-8 place-items-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink"
                aria-label={`Manage ${config.phoneNumber}`}
                title="More"
              >
                <MoreVertical size={16} />
              </button>
              {menuId === config.id ? (
                <div className="absolute right-3 top-12 z-20 w-[210px] overflow-hidden rounded-lg border border-hairline/50 bg-panel shadow-xl shadow-black/30">
                  <div className="flex items-center gap-2 border-b border-hairline/30 px-3 py-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-1 text-[11px] font-semibold",
                        config.isActive === false ? "bg-control text-ink-secondary" : "bg-accent text-white",
                      )}
                    >
                      {config.isActive === false ? "Inactive" : "Active"}
                    </span>
                    <button
                      type="button"
                      onClick={() => void toggleActive(config)}
                      disabled={saving}
                      className="min-w-0 flex-1 truncate text-left text-[12.5px] text-ink hover:text-accent disabled:opacity-50"
                    >
                      {config.isActive === false ? "Mark Active" : "Mark Inactive"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => editConfig(config)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-ink hover:bg-control"
                  >
                    <Pencil size={13} />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      editConfig(config);
                      setMessage("Provider settings loaded below.");
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-ink hover:bg-control"
                  >
                    <KeyRound size={13} />
                    Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => notePendingProviderAction("Re-sync call webhook")}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-ink hover:bg-control"
                  >
                    <RefreshCw size={13} />
                    Re-sync call webhook
                  </button>
                  <button
                    type="button"
                    onClick={() => notePendingProviderAction("Diagnose number")}
                    className="flex w-full items-center gap-2 border-b border-hairline/30 px-3 py-2 text-left text-[12.5px] text-ink hover:bg-control"
                  >
                    <Phone size={13} />
                    Diagnose number
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(config)}
                    disabled={saving}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-danger hover:bg-danger/10 disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-3 rounded-lg border border-hairline/30 bg-inset p-3">
        <div className="flex rounded-lg bg-card p-1">
          {(["twilio", "telnyx"] as PhoneProvider[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setProvider(id)}
              className={cn(
                "flex-1 rounded-md px-3 py-2 text-[12.5px] font-medium transition-colors",
                provider === id ? "bg-control text-ink" : "text-ink-secondary hover:text-ink",
              )}
            >
              {PHONE_PROVIDER_META[id].name}
            </button>
          ))}
        </div>
        <div className="mt-3 text-[12px] leading-relaxed text-ink-secondary">{PHONE_PROVIDER_META[provider].description}</div>
        <div className="mt-3 grid gap-3">
          <label className={fieldLabelClass}>
            Phone Number
            <input value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="+1 98765 43210" className={inputClass} />
          </label>
          {provider === "twilio" ? (
            <>
              <label className={fieldLabelClass}>
                Account SID
                <input value={twilioAccountSid} onChange={(event) => setTwilioAccountSid(event.target.value)} placeholder="AC..." className={inputClass} />
              </label>
              <SecretField
                label="Auth Token"
                value={twilioAuthToken}
                onChange={setTwilioAuthToken}
                placeholder={editingId ? "Saved token hidden by platform" : "Twilio auth token"}
              />
            </>
          ) : (
            <>
              <SecretField
                label="API Key"
                value={telnyxApiKey}
                onChange={setTelnyxApiKey}
                placeholder={editingId ? "Saved key hidden by platform" : "Telnyx API key"}
              />
              <label className={fieldLabelClass}>
                Connection ID
                <input value={telnyxConnectionId} onChange={(event) => setTelnyxConnectionId(event.target.value)} placeholder="Telnyx connection ID" className={inputClass} />
              </label>
              <label className={fieldLabelClass}>
                Public Key
                <input value={telnyxPublicKey} onChange={(event) => setTelnyxPublicKey(event.target.value)} placeholder="Telnyx public key" className={inputClass} />
              </label>
            </>
          )}
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={() => void save()} disabled={saving} className={primaryButtonClass}>
            {saving ? "Saving..." : editingId ? "Update Provider" : "Save Provider"}
          </button>
          {editingId ? (
            <button type="button" onClick={resetForm} disabled={saving} className="mt-4 rounded-lg border border-hairline/40 px-3 py-2 text-[13px] font-medium text-ink hover:bg-control disabled:opacity-50">
              Cancel
            </button>
          ) : null}
        </div>
      </div>
      <StatusMessages message={message} error={error} />
    </div>
  );
}

const CALENDAR_PROVIDER_CARDS: ToolkitCard[] = [
  {
    slug: "googlecalendar",
    label: "Google Calendar",
    blurb: "Read availability and create calendar events.",
    logo: null,
    domain: "calendar.google.com",
  },
  {
    slug: "calendly",
    label: "Calendly",
    blurb: "Connect scheduling links and booking workflows.",
    logo: null,
    domain: "calendly.com",
  },
  {
    slug: "cal",
    label: "Cal.com",
    blurb: "Connect booking workflows and availability.",
    logo: null,
    domain: "cal.com",
  },
  {
    slug: "outlook",
    label: "Outlook Calendar",
    blurb: "Use Microsoft calendar availability and events.",
    logo: null,
    domain: "outlook.com",
  },
  {
    slug: "microsoft_teams",
    label: "Microsoft Teams",
    blurb: "Connect meeting and calendar workflows.",
    logo: null,
    domain: "teams.microsoft.com",
  },
  {
    slug: "zoom",
    label: "Zoom",
    blurb: "Create meeting links for scheduled appointments.",
    logo: null,
    domain: "zoom.us",
  },
  {
    slug: "highlevel",
    label: "HighLevel",
    blurb: "Connect CRM calendars and appointment workflows.",
    logo: null,
    domain: "gohighlevel.com",
  },
];

const CALENDAR_PROVIDER_SLUG_LIST = CALENDAR_PROVIDER_CARDS.map((card) => card.slug);

function activeConnectorAccounts(accounts: ConnectorStatus["accounts"] = []) {
  return accounts.filter((account) => /^active$/i.test(account.status));
}

function CalendarServiceIcon({ card }: { card: ToolkitCard }) {
  const [stage, setStage] = useState(card.logo ? 0 : card.domain ? 1 : 2);
  if (stage === 0 && card.logo) {
    return <img src={card.logo} alt="" className="size-9 rounded-lg object-contain" onError={() => setStage(1)} />;
  }
  if (stage === 1 && card.domain) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${card.domain}&sz=64`}
        alt=""
        className="size-9 rounded-lg object-contain"
        onError={() => setStage(2)}
      />
    );
  }
  return (
    <div className="grid size-9 place-items-center rounded-lg bg-control text-[13px] font-semibold text-ink-secondary">
      {card.label.slice(0, 1).toUpperCase()}
    </div>
  );
}

function CalendarIntegrationsPanel() {
  const [status, setStatus] = useState<Record<string, ConnectorStatus>>({});
  const [pendingUrls, setPendingUrls] = useState<Record<string, string>>({});
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const pollTimers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const statusGenerations = useRef(new Map<string, number>());

  const visibleCards = CALENDAR_PROVIDER_CARDS.filter((card) =>
    !query.trim() || `${card.label} ${card.slug} ${card.blurb}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const connectedCount = CALENDAR_PROVIDER_CARDS.reduce((count, card) => count + activeConnectorAccounts(status[card.slug]?.accounts).length, 0);

  const refreshStatus = useCallback((slugs: string[]): Promise<Record<string, ConnectorStatus>> => {
    if (!slugs.length) return Promise.resolve({});
    const requestGenerations = new Map(slugs.map((slug) => [slug, statusGenerations.current.get(slug) ?? 0]));
    setRefreshing(true);
    setError("");
    return api(`/api/connectors?services=${slugs.join(",")}`)
      .then((result) => {
        if (typeof result.configured === "boolean") setConfigured(result.configured);
        const services: Record<string, ConnectorStatus> = result.services ?? {};
        setStatus((current) => {
          const next = { ...current };
          for (const [slug, state] of Object.entries(services)) {
            if ((statusGenerations.current.get(slug) ?? 0) !== (requestGenerations.get(slug) ?? 0)) continue;
            next[slug] = state;
          }
          return next;
        });
        for (const [slug, state] of Object.entries(services)) {
          if (!state.connected || state.pending) continue;
          setPendingUrls((current) => {
            if (!current[slug]) return current;
            const next = { ...current };
            delete next[slug];
            return next;
          });
        }
        return services;
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not refresh calendar connections.");
        return {};
      })
      .finally(() => setRefreshing(false));
  }, []);

  const load = useCallback(() => {
    setError("");
    return refreshStatus(CALENDAR_PROVIDER_SLUG_LIST)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load calendar integrations."));
  }, [refreshStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => {
    for (const timer of pollTimers.current.values()) clearInterval(timer);
    pollTimers.current.clear();
  }, []);

  useEffect(() => {
    const syncAfterOAuth = () => {
      if (document.visibilityState === "hidden") return;
      void refreshStatus(CALENDAR_PROVIDER_SLUG_LIST);
    };
    window.addEventListener("focus", syncAfterOAuth);
    window.addEventListener("pageshow", syncAfterOAuth);
    document.addEventListener("visibilitychange", syncAfterOAuth);
    return () => {
      window.removeEventListener("focus", syncAfterOAuth);
      window.removeEventListener("pageshow", syncAfterOAuth);
      document.removeEventListener("visibilitychange", syncAfterOAuth);
    };
  }, [refreshStatus]);

  const reserveConnectWindow = () => window.ogb?.openExternal ? null : window.open("", "_blank");

  const openConnectUrl = async (url: string, reservedWindow: Window | null = null) => {
    if (window.ogb?.openExternal) {
      await window.ogb.openExternal(url);
      return;
    }
    const opened = reservedWindow ?? window.open("", "_blank");
    if (!opened) throw new Error("Your browser blocked the connection page. Click Continue to open it.");
    opened.opener = null;
    opened.location.replace(url);
  };

  const connect = async (card: ToolkitCard) => {
    const reservedWindow = reserveConnectWindow();
    const slug = card.slug;
    statusGenerations.current.set(slug, (statusGenerations.current.get(slug) ?? 0) + 1);
    setBusySlug(slug);
    setError("");
    try {
      const request: RequestInit = { method: "POST" };
      if (card.authConfigId) request.body = JSON.stringify({ authConfigId: card.authConfigId, auth_config_id: card.authConfigId });
      const { url } = await api(`/api/connectors/${slug}/authorize`, request);
      setPendingUrls((current) => ({ ...current, [slug]: url }));
      setStatus((current) => ({
        ...current,
        [slug]: { ...current[slug], connected: current[slug]?.connected ?? false, pending: true, status: "INITIATED" },
      }));
      const old = pollTimers.current.get(slug);
      if (old) clearInterval(old);
      let tries = 0;
      const timer = setInterval(() => {
        void refreshStatus([slug]).then((services) => {
          const state = services[slug];
          if (++tries >= 24 || (state?.connected && !state.pending) || (state?.status && /^(expired|failed)$/i.test(state.status))) {
            clearInterval(timer);
            pollTimers.current.delete(slug);
          }
        });
      }, 5000);
      pollTimers.current.set(slug, timer);
      await openConnectUrl(url, reservedWindow);
    } catch (cause) {
      reservedWindow?.close();
      setError(cause instanceof Error ? cause.message : "Could not start calendar connection.");
    } finally {
      setBusySlug(null);
    }
  };

  const disconnectAccount = async (card: ToolkitCard, account: { id: string; alias?: string; status: string }) => {
    const identity = account.alias || account.id;
    if (!window.confirm(`Disconnect "${identity}" from ${card.label}?`)) return;
    setBusySlug(card.slug);
    setError("");
    try {
      await api(`/api/connectors/${card.slug}/accounts/${encodeURIComponent(account.id)}`, { method: "DELETE" });
      await refreshStatus([card.slug]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect calendar account.");
    } finally {
      setBusySlug(null);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-hairline/35 bg-card p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[14px] font-semibold text-ink">Calendar Integrations</div>
          <div className="mt-0.5 text-[12px] text-ink-secondary">
            {connectedCount ? `${connectedCount} connected account${connectedCount === 1 ? "" : "s"}` : "No calendar accounts connected"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-hairline/40 px-3 text-[12.5px] text-ink hover:bg-control"
        >
          <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
          Refresh
        </button>
      </div>

      <label className="mt-3 flex h-10 items-center gap-2 rounded-lg border border-hairline/40 bg-inset px-3 focus-within:border-accent">
        <Search size={15} className="shrink-0 text-ink-secondary" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search calendars..."
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
      </label>

      {!configured ? (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
          Calendar integrations are unavailable until Composio is configured.
        </div>
      ) : null}
      {error ? <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}

      {visibleCards.length === 0 ? (
        <div className="mt-3 rounded-lg border border-hairline/35 bg-inset px-3 py-6 text-center text-[13px] text-ink-secondary">
          No calendar integrations found.
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-lg border border-hairline/35 bg-inset">
          {visibleCards.map((card) => {
            const serviceStatus = status[card.slug];
            const pending = serviceStatus?.pending;
            const failed = serviceStatus?.status && /^(expired|failed)$/i.test(serviceStatus.status);
            const accounts = activeConnectorAccounts(serviceStatus?.accounts);
            const busy = busySlug === card.slug;
            return (
              <div key={card.slug} className="border-b border-hairline/20 px-3 py-3 last:border-b-0">
                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <CalendarServiceIcon card={card} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-ink">{card.label}</div>
                      <div className="mt-0.5 truncate text-[12px] text-ink-secondary">
                        {pending ? "Finish setup in your browser" : failed ? "Authorization expired" : card.blurb}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!configured || busy}
                    onClick={() => {
                      if (pending && pendingUrls[card.slug]) {
                        setError("");
                        void openConnectUrl(pendingUrls[card.slug]).catch((cause) => setError(cause.message));
                      } else {
                        void connect(card);
                      }
                    }}
                    className="min-w-[86px] rounded-lg border border-hairline/40 px-3 py-1.5 text-[12.5px] text-ink hover:bg-control disabled:opacity-40"
                  >
                    {busy ? <Loader2 size={13} className="mx-auto animate-spin" /> : pending && pendingUrls[card.slug] ? "Continue" : failed ? "Retry" : accounts.length ? "Add" : "Connect"}
                  </button>
                </div>
                <div className="mt-2 text-[12px] text-ink-secondary">
                  {accounts.length ? `${accounts.length} connected` : pending ? "Pending" : "Not connected"}
                </div>
                {accounts.length > 0 ? (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {accounts.map((account) => (
                      <div key={account.id} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg bg-card px-3 py-2 text-[12px]">
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-ink">
                            <Check size={13} className="text-success" />
                            <span className="truncate">{account.alias || account.id}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-ink-secondary">{account.status.toLowerCase()}</span>
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void disconnectAccount(card, account)}
                          className="rounded-md px-2 py-1 text-[11px] text-ink-secondary hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                        >
                          Disconnect
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function parseAudienceCsv(text: string): AudienceContact[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(",").map((part) => part.trim()))
    .map(([first, second], index) => {
      const phone = (second || first || "").trim();
      if (!phone || /phone/i.test(phone)) return null;
      return {
        id: `uploaded-${Date.now()}-${index}`,
        name: first && second ? first : phone,
        phone,
      };
    })
    .filter((contact): contact is AudienceContact => contact !== null);
}

function AudienceCreatePage({
  contacts,
  saving,
  error,
  onCancel,
  onImportContacts,
  onSave,
}: {
  contacts: AudienceContact[];
  saving: boolean;
  error: string;
  onCancel: () => void;
  onImportContacts: (contacts: AudienceContact[]) => void;
  onSave: (audience: { name: string; description: string; contacts: AudienceContact[]; contactIds: string[] }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [localError, setLocalError] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleContacts = normalizedQuery
    ? contacts.filter((contact) => `${contact.name} ${contact.phone}`.toLowerCase().includes(normalizedQuery))
    : contacts;

  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    const imported = parseAudienceCsv(await file.text());
    if (imported.length === 0) {
      setLocalError("No contacts were found in that CSV.");
      return;
    }
    onImportContacts(imported);
    setSelectedIds((current) => [...new Set([...imported.map((contact) => contact.id), ...current])]);
    setLocalError("");
  };

  const save = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setLocalError("Audience name is required.");
      return;
    }
    const selectedContacts = contacts.filter((contact) => selectedIds.includes(contact.id));
    void onSave({
      name: trimmedName,
      description: description.trim(),
      contacts: selectedContacts,
      contactIds: selectedIds,
    });
  };

  return (
    <div className="mt-4 rounded-lg border border-hairline/35 bg-card">
      <div className="flex items-center justify-between border-b border-hairline/35 px-4 py-3">
        <div className="text-[14px] font-semibold text-ink">Create Audience</div>
        <button
          type="button"
          onClick={onCancel}
          className="grid size-8 place-items-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink"
          aria-label="Close create audience"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>
      <div className="px-4 py-4">
        <label className={fieldLabelClass}>
          Audience Name *
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setLocalError("");
            }}
            placeholder="e.g., Downtown Residents"
            className={inputClass}
            autoFocus
          />
        </label>
        <label className={`${fieldLabelClass} mt-3`}>
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Brief description of this audience segment"
            className={`${inputClass} min-h-[86px] resize-y leading-relaxed`}
          />
        </label>

        <div className="mt-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[12.5px] font-medium text-ink">Audience List</div>
              <div className="mt-1 text-[12px] text-ink-secondary">Select contacts ({selectedIds.length} selected)</div>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-medium text-accent hover:bg-accent/10">
              <UploadCloud size={14} />
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(event) => void importCsv(event.target.files?.[0])}
              />
            </label>
          </div>
          <div className="mt-3 flex h-10 items-center gap-2 rounded-lg border border-hairline/40 bg-inset px-3 focus-within:border-accent">
            <Search size={16} className="shrink-0 text-ink-secondary" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search contacts..."
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </div>
          <div className="mt-3 max-h-[180px] overflow-y-auto rounded-lg border border-hairline/35 bg-inset">
            {visibleContacts.length > 0 ? (
              visibleContacts.map((contact) => (
                <label key={contact.id} className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-control/40">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(contact.id)}
                    onChange={() => setSelectedIds((current) => current.includes(contact.id) ? current.filter((id) => id !== contact.id) : [...current, contact.id])}
                    className="mt-0.5 size-4 rounded border-hairline/60 accent-[var(--accent)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{contact.name}</span>
                    <span className="mt-0.5 block text-[12px] text-ink-secondary">{contact.phone}</span>
                  </span>
                </label>
              ))
            ) : (
              <div className="px-3 py-6 text-center text-[12.5px] text-ink-secondary">Import a CSV to add contacts.</div>
            )}
          </div>
        </div>

        {localError || error ? (
          <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{localError || error}</div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={saving} className={primaryButtonClass}>
            {saving ? "Saving..." : "Save Audience"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="mt-4 rounded-lg border border-hairline/40 px-3 py-2 text-[13px] font-medium text-ink hover:bg-control disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function AudienceDetailEditor({
  audience,
  saving,
  onUpdateContacts,
}: {
  audience: SavedAudience;
  saving: boolean;
  onUpdateContacts: (audience: SavedAudience, contacts: AudienceContact[]) => Promise<void>;
}) {
  const [menuContactId, setMenuContactId] = useState<string | null>(null);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [localError, setLocalError] = useState("");

  const beginEdit = (contact: AudienceContact) => {
    setEditingContactId(contact.id);
    setEditName(contact.name);
    setEditPhone(contact.phone);
    setMenuContactId(null);
    setLocalError("");
  };

  const saveEdit = (contact: AudienceContact) => {
    const trimmedPhone = editPhone.trim();
    const trimmedName = editName.trim() || trimmedPhone;
    if (!trimmedPhone) {
      setLocalError("Phone number is required.");
      return;
    }
    const updatedContacts = audience.contacts.map((item) => item.id === contact.id ? { ...item, name: trimmedName, phone: trimmedPhone } : item);
    void onUpdateContacts(audience, updatedContacts).then(() => {
      setEditingContactId(null);
      setLocalError("");
    });
  };

  const removeContact = (contact: AudienceContact) => {
    const updatedContacts = audience.contacts.filter((item) => item.id !== contact.id);
    setMenuContactId(null);
    void onUpdateContacts(audience, updatedContacts);
  };

  return (
    <div className="mt-3 rounded-lg border border-accent/25 bg-accent/10 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold text-ink">{audience.name}</div>
          {audience.description ? <div className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{audience.description}</div> : null}
        </div>
        <div className="shrink-0 rounded-lg border border-hairline/30 bg-card px-2 py-1 text-[12px] text-ink-secondary">
          {audience.contacts.length} contacts
        </div>
      </div>
      {localError ? <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{localError}</div> : null}
      <div className="mt-3 max-h-[190px] overflow-y-auto rounded-lg border border-hairline/30 bg-card">
        {audience.contacts.length > 0 ? (
          audience.contacts.map((contact) => (
            <div key={contact.id} className="relative flex items-center gap-3 border-b border-hairline/20 px-3 py-2.5 last:border-b-0">
              <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-control text-ink-secondary">
                <Users size={14} />
              </div>
              {editingContactId === contact.id ? (
                <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <input
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    placeholder="Name"
                    className="min-w-0 rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 text-[12px] text-ink placeholder:text-ink-secondary focus:border-accent focus:outline-none"
                  />
                  <input
                    value={editPhone}
                    onChange={(event) => setEditPhone(event.target.value)}
                    placeholder="Phone"
                    className="min-w-0 rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 text-[12px] text-ink placeholder:text-ink-secondary focus:border-accent focus:outline-none"
                  />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => saveEdit(contact)}
                      disabled={saving}
                      className="rounded-lg bg-accent px-2 py-1.5 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingContactId(null)}
                      disabled={saving}
                      className="rounded-lg border border-hairline/40 px-2 py-1.5 text-[12px] font-medium text-ink hover:bg-control disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-ink">{contact.name}</div>
                    <div className="mt-0.5 truncate text-[11.5px] text-ink-secondary">{contact.phone}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMenuContactId((current) => current === contact.id ? null : contact.id)}
                    disabled={saving}
                    className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"
                    aria-label={`Open actions for ${contact.name}`}
                    title="Contact actions"
                  >
                    <MoreVertical size={15} />
                  </button>
                  {menuContactId === contact.id ? (
                    <div className="absolute right-3 top-9 z-10 w-32 overflow-hidden rounded-lg border border-hairline/40 bg-card shadow-lg">
                      <button
                        type="button"
                        onClick={() => beginEdit(contact)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-ink hover:bg-control"
                      >
                        <Pencil size={13} />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => removeContact(contact)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-danger hover:bg-danger/10"
                      >
                        <Trash2 size={13} />
                        Remove
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ))
        ) : (
          <div className="px-3 py-4 text-center text-[12px] text-ink-secondary">This audience has no contacts.</div>
        )}
      </div>
    </div>
  );
}

function AudienceSummaryRow({
  audience,
  selected,
  saving,
  onSelect,
  onRename,
  onDelete,
  className,
}: {
  audience: SavedAudience;
  selected: boolean;
  saving: boolean;
  onSelect: () => void;
  onRename: (audience: SavedAudience, name: string, description: string) => Promise<void>;
  onDelete: (audience: SavedAudience) => Promise<void>;
  className?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(audience.name);
  const [description, setDescription] = useState(audience.description ?? "");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setName(audience.name);
    setDescription(audience.description ?? "");
  }, [audience.name, audience.description]);

  const save = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setLocalError("Audience name is required.");
      return;
    }
    void onRename(audience, trimmedName, description.trim()).then(() => {
      setEditing(false);
      setLocalError("");
    });
  };

  if (editing) {
    return (
      <div className={cn("rounded-lg bg-inset px-3 py-2", className)}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setLocalError("");
            }}
            placeholder="Audience name"
            className="min-w-0 rounded-lg border border-hairline/40 bg-card px-2 py-1.5 text-[12px] text-ink placeholder:text-ink-secondary focus:border-accent focus:outline-none"
          />
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Description"
            className="min-w-0 rounded-lg border border-hairline/40 bg-card px-2 py-1.5 text-[12px] text-ink placeholder:text-ink-secondary focus:border-accent focus:outline-none"
          />
          <div className="flex gap-1">
            <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-accent px-2 py-1.5 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-50">
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setName(audience.name);
                setDescription(audience.description ?? "");
                setLocalError("");
              }}
              disabled={saving}
              className="rounded-lg border border-hairline/40 px-2 py-1.5 text-[12px] font-medium text-ink hover:bg-control disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
        {localError ? <div className="mt-2 text-[12px] text-danger">{localError}</div> : null}
      </div>
    );
  }

  return (
    <div className={cn("relative flex items-center gap-2 rounded-lg bg-inset px-3 py-2", selected ? "bg-control/60" : "", className)}>
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex flex-1 items-center justify-between gap-3 text-left focus:outline-none"
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-ink">{audience.name}</span>
          {audience.description ? <span className="mt-0.5 block truncate text-[12px] text-ink-secondary">{audience.description}</span> : null}
        </span>
        <span className="shrink-0 text-[12px] text-ink-secondary">{audience.contactIds.length} contacts</span>
      </button>
      <button
        type="button"
        onClick={() => setMenuOpen((current) => !current)}
        disabled={saving}
        className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"
        aria-label={`Open actions for ${audience.name}`}
        title="Audience actions"
      >
        <MoreVertical size={15} />
      </button>
      {menuOpen ? (
        <div className="absolute right-3 top-9 z-10 w-32 overflow-hidden rounded-lg border border-hairline/40 bg-card shadow-lg">
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setMenuOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-ink hover:bg-control"
          >
            <Pencil size={13} />
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              void onDelete(audience);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-danger hover:bg-danger/10"
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AudienceContactsPage({
  contacts,
  audiences,
  loading,
  saving,
  error,
  onBack,
  onRefresh,
  onUpdateAudienceContacts,
  onRenameAudience,
  onDeleteAudience,
}: {
  contacts: AudienceContact[];
  audiences: SavedAudience[];
  loading: boolean;
  saving: boolean;
  error: string;
  onBack: () => void;
  onRefresh: () => void;
  onUpdateAudienceContacts: (audience: SavedAudience, contacts: AudienceContact[]) => Promise<void>;
  onRenameAudience: (audience: SavedAudience, name: string, description: string) => Promise<void>;
  onDeleteAudience: (audience: SavedAudience) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [selectedAudienceId, setSelectedAudienceId] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleContacts = normalizedQuery
    ? contacts.filter((contact) => `${contact.name} ${contact.phone}`.toLowerCase().includes(normalizedQuery))
    : contacts;
  const selectedAudience = audiences.find((audience) => audience.id === selectedAudienceId) ?? null;

  return (
    <div className="mt-4 rounded-lg border border-hairline/35 bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-hairline/35 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-ink">Select contacts</div>
          <div className="mt-0.5 text-[12px] text-ink-secondary">{contacts.length} contacts available</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="grid size-8 place-items-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Refresh contacts"
            title="Refresh contacts"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={onBack}
            className="grid size-8 place-items-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink"
            aria-label="Close contacts"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="px-4 py-4">
        <div className="flex h-10 items-center gap-2 rounded-lg border border-hairline/40 bg-inset px-3 focus-within:border-accent">
          <Search size={16} className="shrink-0 text-ink-secondary" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search website contacts..."
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
        </div>
        {error ? <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
        <div className="mt-3 max-h-[260px] overflow-y-auto rounded-lg border border-hairline/35 bg-inset">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-6 text-[12.5px] text-ink-secondary">
              <Loader2 size={14} className="animate-spin" />
              Loading contacts...
            </div>
          ) : visibleContacts.length > 0 ? (
            visibleContacts.map((contact) => (
              <div key={contact.id} className="flex items-center gap-3 border-b border-hairline/20 px-3 py-2.5 last:border-b-0">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-control text-ink-secondary">
                  <Users size={15} />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-ink">{contact.name}</div>
                  <div className="mt-0.5 truncate text-[12px] text-ink-secondary">{contact.phone}</div>
                </div>
              </div>
            ))
          ) : (
            <div className="px-3 py-7 text-center">
              <div className="text-[13px] font-medium text-ink">No contacts available</div>
              <div className="mx-auto mt-1 max-w-[360px] text-[12px] leading-relaxed text-ink-secondary">
                Import contacts while creating an audience, then they will appear here for selection.
              </div>
            </div>
          )}
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[12.5px] font-medium text-ink">Created audiences</div>
              <div className="mt-1 text-[12px] text-ink-secondary">{audiences.length} saved audiences</div>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-hairline/35 bg-inset">
            {audiences.length > 0 ? (
              audiences.map((audience) => {
                const selected = audience.id === selectedAudienceId;
                return (
                  <AudienceSummaryRow
                    key={audience.id}
                    audience={audience}
                    selected={selected}
                    saving={saving}
                    onSelect={() => setSelectedAudienceId(selected ? null : audience.id)}
                    onRename={onRenameAudience}
                    onDelete={onDeleteAudience}
                    className="rounded-none border-b border-hairline/20 last:border-b-0"
                  />
                );
              })
            ) : (
              <div className="px-3 py-6 text-center text-[12.5px] text-ink-secondary">No audiences created yet.</div>
          )}
        </div>
          {selectedAudience ? (
            <AudienceDetailEditor audience={selectedAudience} saving={saving} onUpdateContacts={onUpdateAudienceContacts} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WhatsAppContactsPanel() {
  const [contacts, setContacts] = useState<AudienceContact[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuContactId, setMenuContactId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleContacts = normalizedQuery
    ? contacts.filter((contact) => `${contact.name} ${contact.phone}`.toLowerCase().includes(normalizedQuery))
    : contacts;

  const load = () => {
    setLoading(true);
    setError("");
    api("/api/whatsapp/contacts")
      .then((result) => setContacts(Array.isArray(result.contacts) ? result.contacts : []))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load WhatsApp contacts."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const resetForm = () => {
    setName("");
    setPhone("");
    setEditingId(null);
    setMenuContactId(null);
  };

  const saveContact = async () => {
    const trimmedPhone = phone.trim();
    const trimmedName = name.trim() || trimmedPhone;
    if (!trimmedPhone) {
      setError("Phone number is required.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await api(editingId ? `/api/whatsapp/contacts/${encodeURIComponent(editingId)}` : "/api/whatsapp/contacts", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify({ name: trimmedName, phone: trimmedPhone }),
      }) as { contact?: AudienceContact };
      if (result.contact) {
        setContacts((current) => editingId
          ? current.map((contact) => contact.id === result.contact!.id ? result.contact! : contact)
          : [result.contact!, ...current.filter((contact) => contact.id !== result.contact!.id)]);
      } else {
        load();
      }
      setMessage(editingId ? "Contact updated." : "Contact saved.");
      resetForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save WhatsApp contact.");
    } finally {
      setSaving(false);
    }
  };

  const importContacts = async (file: File | undefined) => {
    if (!file) return;
    const imported = parseAudienceCsv(await file.text());
    if (!imported.length) {
      setError("No contacts were found in that CSV.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await api("/api/whatsapp/contacts/bulk", {
        method: "POST",
        body: JSON.stringify({ contacts: imported }),
      }) as { contacts?: AudienceContact[] };
      if (Array.isArray(result.contacts)) {
        setContacts((current) => {
          return [...result.contacts!, ...current.filter((contact) => !result.contacts!.some((saved) => saved.id === contact.id))];
        });
      } else {
        load();
      }
      setMessage(`${imported.length} contacts imported.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import WhatsApp contacts.");
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (contact: AudienceContact) => {
    setEditingId(contact.id);
    setName(contact.name);
    setPhone(contact.phone);
    setMenuContactId(null);
    setMessage("");
    setError("");
  };

  const deleteContact = async (contact: AudienceContact) => {
    setSaving(true);
    setError("");
    setMessage("");
    setMenuContactId(null);
    try {
      await api(`/api/whatsapp/contacts/${encodeURIComponent(contact.id)}`, { method: "DELETE" });
      setContacts((current) => current.filter((item) => item.id !== contact.id));
      if (editingId === contact.id) resetForm();
      setMessage("Contact deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete WhatsApp contact.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-hairline/35 bg-card">
      <div className="flex flex-col gap-2 border-b border-hairline/35 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[14px] font-semibold text-ink">WhatsApp Contacts</div>
          <div className="mt-0.5 text-[12px] text-ink-secondary">{contacts.length} saved contacts</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-hairline/40 px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-control">
            <UploadCloud size={14} />
            Import contacts
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => void importContacts(event.target.files?.[0])}
            />
          </label>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="grid size-9 place-items-center rounded-lg border border-hairline/40 text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"
            aria-label="Refresh contacts"
            title="Refresh contacts"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      <div className="px-3 py-3">
        <div className="grid gap-2 rounded-lg border border-hairline/30 bg-inset p-3">
          <div className="text-[12.5px] font-medium text-ink">{editingId ? "Update WhatsApp phone record" : "Add WhatsApp phone record"}</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Contact name"
              className={inputClass}
            />
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+91 98765 43210"
              className={inputClass}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void saveContact()}
                disabled={saving}
                className="rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50"
              >
                {saving ? "Saving..." : editingId ? "Update" : "Save"}
              </button>
              {editingId ? (
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={saving}
                  className="rounded-lg border border-hairline/40 px-3 py-2 text-[13px] font-medium text-ink hover:bg-control disabled:opacity-50"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-3 flex h-10 items-center gap-2 rounded-lg border border-hairline/40 bg-inset px-3 focus-within:border-accent">
          <Search size={16} className="shrink-0 text-ink-secondary" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search contacts..."
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
        </div>

        <div className="mt-3 max-h-[220px] overflow-y-auto rounded-lg border border-hairline/35 bg-inset">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-6 text-[12.5px] text-ink-secondary">
              <Loader2 size={14} className="animate-spin" />
              Loading contacts...
            </div>
          ) : visibleContacts.length > 0 ? (
            visibleContacts.map((contact) => (
              <div key={contact.id} className="border-b border-hairline/20 last:border-b-0">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-control text-ink-secondary">
                    <Users size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink">{contact.name}</div>
                    <div className="mt-0.5 truncate text-[12px] text-ink-secondary">{contact.phone}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMenuContactId((current) => current === contact.id ? null : contact.id)}
                    disabled={saving}
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"
                    aria-label={`Open actions for ${contact.name}`}
                    title="Contact actions"
                  >
                    <MoreVertical size={15} />
                  </button>
                </div>
                {menuContactId === contact.id ? (
                  <div className="mx-3 mb-2 grid grid-cols-2 overflow-hidden rounded-lg border border-hairline/35 bg-card">
                    <button
                      type="button"
                      onClick={() => beginEdit(contact)}
                      className="flex items-center justify-center gap-2 border-r border-hairline/25 px-3 py-2 text-[12px] text-ink hover:bg-control"
                    >
                      <Pencil size={13} />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteContact(contact)}
                      className="flex items-center justify-center gap-2 px-3 py-2 text-[12px] text-danger hover:bg-danger/10"
                    >
                      <Trash2 size={13} />
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <div className="px-3 py-7 text-center">
              <div className="text-[13px] font-medium text-ink">No WhatsApp contacts yet</div>
              <div className="mx-auto mt-1 max-w-[360px] text-[12px] leading-relaxed text-ink-secondary">
                Import a CSV or save a phone record to create your contact list.
              </div>
            </div>
          )}
        </div>

        <StatusMessages message={message} error={error} />
      </div>
    </div>
  );
}

function WhatsAppAudiencesPanel({ active }: { active: (typeof SETUP_ITEMS)[number] }) {
  const [contacts, setContacts] = useState<AudienceContact[]>([]);
  const [audiences, setAudiences] = useState<SavedAudience[]>([]);
  const [view, setView] = useState<"home" | "create" | "contacts">("home");
  const [selectedAudienceId, setSelectedAudienceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedAudience = audiences.find((audience) => audience.id === selectedAudienceId) ?? null;

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([
      api("/api/whatsapp/contacts") as Promise<{ contacts?: AudienceContact[] }>,
      api("/api/whatsapp/audiences") as Promise<{ audiences?: SavedAudience[] }>,
    ])
      .then(([contactsResult, audiencesResult]) => {
        setContacts(Array.isArray(contactsResult.contacts) ? contactsResult.contacts : []);
        setAudiences(Array.isArray(audiencesResult.audiences) ? audiencesResult.audiences : []);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load WhatsApp audiences."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const updateAudienceContacts = async (audience: SavedAudience, nextContacts: AudienceContact[]) => {
    setSaving(true);
    setError("");
    try {
      const result = await api(`/api/whatsapp/audiences/${encodeURIComponent(audience.id)}`, {
        method: "PUT",
        body: JSON.stringify({
          name: audience.name,
          description: audience.description ?? "",
          contacts: nextContacts,
          contactIds: nextContacts.map((contact) => contact.id),
        }),
      }) as { audience?: SavedAudience };
      if (result.audience) {
        setAudiences((current) => current.map((item) => item.id === result.audience!.id ? result.audience! : item));
        setContacts((current) => {
          const byId = new Map(current.map((contact) => [contact.id, contact]));
          for (const contact of result.audience!.contacts) byId.set(contact.id, contact);
          return [...byId.values()];
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update WhatsApp audience.");
    } finally {
      setSaving(false);
    }
  };

  const renameAudience = async (audience: SavedAudience, name: string, description: string) => {
    setSaving(true);
    setError("");
    try {
      const result = await api(`/api/whatsapp/audiences/${encodeURIComponent(audience.id)}`, {
        method: "PUT",
        body: JSON.stringify({
          name,
          description,
          contacts: audience.contacts,
          contactIds: audience.contacts.map((contact) => contact.id),
        }),
      }) as { audience?: SavedAudience };
      if (result.audience) {
        setAudiences((current) => current.map((item) => item.id === result.audience!.id ? result.audience! : item));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update WhatsApp audience.");
    } finally {
      setSaving(false);
    }
  };

  const deleteAudience = async (audience: SavedAudience) => {
    setSaving(true);
    setError("");
    try {
      await api(`/api/whatsapp/audiences/${encodeURIComponent(audience.id)}`, { method: "DELETE" });
      setAudiences((current) => current.filter((item) => item.id !== audience.id));
      setSelectedAudienceId((current) => current === audience.id ? null : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete WhatsApp audience.");
    } finally {
      setSaving(false);
    }
  };

  if (view === "create") {
    return (
      <AudienceCreatePage
        contacts={contacts}
        saving={saving}
        error={error}
        onCancel={() => setView("home")}
        onImportContacts={(incoming) => setContacts((current) => [...incoming, ...current])}
        onSave={async (audience) => {
          setSaving(true);
          setError("");
          try {
            const result = await api("/api/whatsapp/audiences", {
              method: "POST",
              body: JSON.stringify(audience),
            }) as { audience?: SavedAudience };
            if (result.audience) {
              setAudiences((current) => [result.audience!, ...current]);
              setContacts((current) => {
                const byId = new Map(current.map((contact) => [contact.id, contact]));
                for (const contact of result.audience!.contacts) byId.set(contact.id, contact);
                return [...byId.values()];
              });
            }
            setView("home");
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not save WhatsApp audience.");
          } finally {
            setSaving(false);
          }
        }}
      />
    );
  }

  if (view === "contacts") {
    return (
      <AudienceContactsPage
        contacts={contacts}
        audiences={audiences}
        loading={loading}
        saving={saving}
        error={error}
        onBack={() => setView("home")}
        onRefresh={load}
        onUpdateAudienceContacts={updateAudienceContacts}
        onRenameAudience={renameAudience}
        onDeleteAudience={deleteAudience}
      />
    );
  }

  return (
    <>
      <div className="mt-4 flex flex-col gap-2">
        {active.actions.map((action) => action === "Create audience" ? (
          <button
            key={action}
            type="button"
            onClick={() => setView("create")}
            className="rounded-lg border border-hairline/30 bg-card px-3 py-2 text-left text-[13px] text-ink transition-colors hover:border-accent/45 hover:bg-control focus:outline-none focus:ring-2 focus:ring-accent/35"
          >
            {action}
          </button>
        ) : action === "Select contacts" ? (
          <button
            key={action}
            type="button"
            onClick={() => {
              setView("contacts");
              load();
            }}
            className="rounded-lg border border-hairline/30 bg-card px-3 py-2 text-left text-[13px] text-ink transition-colors hover:border-accent/45 hover:bg-control focus:outline-none focus:ring-2 focus:ring-accent/35"
          >
            {action}
          </button>
        ) : (
          <div key={action} className="rounded-lg border border-hairline/30 bg-card px-3 py-2 text-[13px] text-ink">
            {action}
          </div>
        ))}
      </div>
      {loading ? <LoadingRow label="Loading saved audiences..." /> : null}
      {error ? <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
      {audiences.length > 0 ? (
        <div className="mt-3 rounded-lg border border-hairline/30 bg-card px-3 py-2">
          <div className="text-[12px] font-medium text-ink-secondary">Saved audiences</div>
          <div className="mt-2 flex flex-col gap-2">
            {audiences.map((audience) => (
              <AudienceSummaryRow
                key={audience.id}
                audience={audience}
                selected={selectedAudienceId === audience.id}
                saving={saving}
                onSelect={() => setSelectedAudienceId((current) => current === audience.id ? null : audience.id)}
                onRename={renameAudience}
                onDelete={deleteAudience}
              />
            ))}
          </div>
          {selectedAudience ? (
            <AudienceDetailEditor audience={selectedAudience} saving={saving} onUpdateContacts={updateAudienceContacts} />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function PlaceholderPanel({ active }: { active: (typeof SETUP_ITEMS)[number] }) {
  if (active.id === "whatsapp-contacts") return <WhatsAppContactsPanel />;
  if (active.id === "whatsapp-audiences") return <WhatsAppAudiencesPanel active={active} />;

  return (
    <div className="mt-4 flex flex-col gap-2">
      {active.actions.map((action) => (
        <div key={action} className="rounded-lg border border-hairline/30 bg-card px-3 py-2 text-[13px] text-ink">
          {action}
        </div>
      ))}
    </div>
  );
}

function DetailBody({ active, onOpenIntegrations }: { active: (typeof SETUP_ITEMS)[number]; onOpenIntegrations?: () => void }) {
  if (active.id === "phone") return <PhoneIntegrationPanel />;
  if (active.id === "calendars") return <CalendarIntegrationsPanel />;
  if (active.id === "whatsapp-integrations") return <div className="mt-4"><WhatsAppIntegrationsPanel /></div>;
  if (active.id === "whatsapp-api") return <div className="mt-4"><WhatsAppApiPanel /></div>;
  return (
    <>
      <PlaceholderPanel active={active} />
      {active.opensIntegrations ? (
        <button type="button" onClick={onOpenIntegrations} className={primaryButtonClass}>
          Open Integrations
        </button>
      ) : null}
    </>
  );
}

export function LocalComputerSection({ onOpenIntegrations }: { onOpenIntegrations?: () => void }) {
  const [activeId, setActiveId] = useState<SetupId | null>(null);
  const active = SETUP_ITEMS.find((item) => item.id === activeId) ?? null;

  if (active) {
    const Icon = active.icon;
    return (
      <Card title={active.title} subtitle={active.description}>
        <button
          type="button"
          onClick={() => setActiveId(null)}
          className="-mt-1 mb-3 inline-flex items-center gap-1.5 rounded-lg border border-hairline/40 px-2.5 py-1.5 text-[12.5px] text-ink-secondary hover:bg-control hover:text-ink"
        >
          <ChevronLeft size={14} />
          Back
        </button>
        <div className="rounded-lg border border-hairline/35 bg-inset px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-control text-ink">
              <Icon size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-ink">{active.title}</div>
              <div className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{active.detail}</div>
            </div>
          </div>
          <DetailBody active={active} onOpenIntegrations={onOpenIntegrations} />
        </div>
      </Card>
    );
  }

  return (
    <Card title="Tools & Setup" subtitle="Configure the shared services your MagicTeams agents can use.">
      <div className="flex flex-col gap-2">
        {SETUP_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveId(item.id)}
              className="flex min-h-[78px] w-full items-center gap-3 rounded-lg border border-hairline/35 bg-inset px-3 py-3 text-left transition-colors hover:border-hairline/60 hover:bg-control/50"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-control text-ink">
                <Icon size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium text-ink">{item.title}</div>
                <div className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{item.description}</div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-ink-secondary" />
            </button>
          );
        })}
      </div>
    </Card>
  );
}
