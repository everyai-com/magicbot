import { CampaignWorkspace } from "./CampaignWorkspace";
import { analyticsEnabled, setAnalyticsEnabled } from "@/lib/analytics";
import { skillRecorderEnabled } from "@/lib/feature-flags";
import { useUpdaterState } from "@/lib/updater";
import { useWebAppInstall } from "@/lib/web-app";
import { SkinPicker } from "./SkinPicker";
import { RoomTurnTimeoutSettings } from "./RoomTurnTimeoutSettings";
import { cachedVoices, loadVoiceCatalog } from "@/lib/voice-catalog";
import { voiceLanguageName } from "@/lib/voice-language";
// App settings, as a real modal with sections rather than one long panel.
// Per-bot settings (persona, model, computer) stay in SettingsPanel — this
// is the stuff shared by every bot: who you are, your keys, and the
// machine your bots can borrow.
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, Coins, Loader2, LogOut, Pause, Play, Puzzle, Search, User, Volume2, Wrench, X } from "lucide-react";
import { api, useStore, type AppSettingsSection, type ConfigStatus } from "@/state/store";
import { signOutBetterAuth } from "@/lib/auth";
import { ApiKeyRow, CloudflareConnection, VpsConnection } from "./ApiKeys";
import { LocalComputerSection } from "./LocalComputerSection";
import { Card } from "./SettingsPrimitives";
import { HistorySection } from "./HistorySection";
import { TranscriptionSettings } from "./TranscriptionSettings";
import { IntegrationsSection } from "./PluginsPanel";
import { cn } from "@/lib/cn";

const SECTIONS: Array<{
  id: AppSettingsSection;
  label: string;
  icon: typeof User;
  keywords: string[];
}> = [
  { id: "general", label: "General", icon: User, keywords: ["profile", "name", "email", "analysis", "provider", "model", "language", "account"] },
  { id: "analysis", label: "Campaigns", icon: Coins, keywords: ["csv", "campaigns", "analysis", "sms", "email", "whatsapp", "outcomes"] },
  { id: "voices", label: "Voices", icon: Volume2, keywords: ["voice", "voices", "speech", "audio", "ultravox"] },
  { id: "computer", label: "Tools & Setup", icon: Wrench, keywords: ["tools", "setup", "phone", "calendar", "whatsapp", "vm", "virtual", "desktop"] },
  { id: "integrations", label: "Integrations", icon: Puzzle, keywords: ["apps", "plugins", "connected", "integrations"] },
  { id: "usage", label: "History", icon: Coins, keywords: ["history", "calls", "sms", "email", "whatsapp"] },
];

const NAV_ITEMS: Array<
  | {
      kind: "section";
      id: AppSettingsSection;
      label: string;
      icon: typeof User;
      keywords: string[];
    }
  | {
      kind: "action";
      id: "routines";
      label: string;
      icon: typeof User;
      keywords: string[];
      action: "showRoutines";
    }
> = [
  ...SECTIONS.filter((section) => section.id !== "integrations" && section.id !== "usage").map((section) => ({ ...section, kind: "section" as const })),
  { kind: "action", id: "routines", label: "Tasks & routines", icon: CalendarDays, keywords: ["tasks", "routines", "scheduled"], action: "showRoutines" },
  ...SECTIONS.filter((section) => section.id === "integrations" || section.id === "usage").map((section) => ({ ...section, kind: "section" as const })),
];

const HOSTED_SECTIONS = SECTIONS;
const HOSTED_NAV_ITEMS = NAV_ITEMS;

function sectionMatches(section: (typeof NAV_ITEMS)[number], query: string): boolean {
  if (!query) return true;
  return [section.label, ...section.keywords].some((part) => part.toLowerCase().includes(query));
}

/** Name + email, persisted to /api/config {profile} on blur. */
function ProfileFields() {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(state.config?.profile?.name ?? "");
  const [email, setEmail] = useState(state.config?.profile?.email ?? "");
  useEffect(() => {
    setName(state.config?.profile?.name ?? "");
    setEmail(state.config?.profile?.email ?? "");
  }, [state.config?.profile?.name, state.config?.profile?.email]);

  const save = () => {
    void fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { name: name.trim(), email: email.trim().toLowerCase() } }),
    })
      .then((r) => r.json())
      .then((config) => dispatch({ type: "configStatus", config }))
      .catch(() => {});
  };

  const inputClass =
    "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none";
  return (
    <div className="flex flex-col gap-3">
      <input value={name} onChange={(e) => setName(e.target.value)} onBlur={save} placeholder="Your name" className={inputClass} />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={save}
        placeholder="you@example.com"
        className={inputClass}
      />
    </div>
  );
}

function AccountRow() {
  const { state } = useStore();
  return (
    <Card title="Account" subtitle="Sign out on this browser and return to the login screen.">
      <button
        type="button"
        onClick={() => signOutBetterAuth(state.config?.hosted === true)}
        className="inline-flex items-center gap-2 rounded-lg border border-danger/30 px-3 py-1.5 text-[13px] text-danger transition-colors hover:bg-danger/10"
      >
        <LogOut size={14} />
        Sign out
      </button>
    </Card>
  );
}

interface VoiceCatalogOption {
  voiceId: string;
  name: string;
  languageLabel?: string;
  primaryLanguage?: string;
  provider?: string;
  previewUrl?: string;
}

function VoicesSection() {
  const [voices, setVoices] = useState<VoiceCatalogOption[]>(() => cachedVoices() ?? []);
  const [languageFilter, setLanguageFilter] = useState("");
  const [loading, setLoading] = useState(() => cachedVoices() === undefined);
  const [error, setError] = useState("");
  const [playingVoiceId, setPlayingVoiceId] = useState("");
  const [previewPaused, setPreviewPaused] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stopPreview = () => {
    audioSourceRef.current?.disconnect();
    audioSourceRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    setPlayingVoiceId("");
    setPreviewPaused(false);
  };

  const playPreview = async (voiceId: string) => {
    if (playingVoiceId === voiceId) {
      const context = audioContextRef.current;
      if (!context) {
        stopPreview();
        return;
      }
      if (context.state === "suspended") {
        setError("");
        try {
          await context.resume();
          setPreviewPaused(false);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not play this voice preview.");
          setPreviewPaused(true);
        }
      } else {
        await context.suspend();
        setPreviewPaused(true);
      }
      return;
    }

    stopPreview();
    setError("");
    setPlayingVoiceId(voiceId);
    setPreviewPaused(false);
    try {
      const response = await fetch(`/api/ultravox/voices/${encodeURIComponent(voiceId)}/preview`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : `Preview failed (${response.status})`);
      }
      const AudioContextCtor = window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) throw new Error("This browser does not support voice preview playback.");
      const context = new AudioContextCtor();
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = stopPreview;
      audioContextRef.current = context;
      audioSourceRef.current = source;
      source.start();
      setPreviewPaused(false);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "NotAllowedError") {
        setError("Allow audio playback in the browser, then try again.");
      } else {
        setError(cause instanceof Error ? cause.message : "The browser could not decode this voice preview.");
      }
      stopPreview();
    }
  };

  const loadVoices = (refresh = false) => {
    setLoading(refresh || cachedVoices() === undefined);
    setError("");
    loadVoiceCatalog(refresh)
      .then((result: { voices?: VoiceCatalogOption[]; error?: string }) => {
        setVoices(Array.isArray(result.voices) ? result.voices : []);
        setError(result.error ?? "");
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not load voices.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadVoices();
  }, []);

  useEffect(() => stopPreview, []);

  const languages = [...new Set(voices.map(voiceLanguageName))].sort((a, b) => a.localeCompare(b));
  const visibleVoices = languageFilter ? voices.filter((voice) => voiceLanguageName(voice) === languageFilter) : voices;

  return (
    <Card title="Voices" subtitle="All available MagicTeams voices for agents and calls.">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13px] text-ink-secondary">
            {loading ? "Loading voices..." : `${visibleVoices.length} voice${visibleVoices.length === 1 ? "" : "s"}${languageFilter ? ` in ${languageFilter}` : " available"}`}
          </div>
          <button
            type="button"
            onClick={() => loadVoices(true)}
            disabled={loading}
            className="rounded-lg border border-hairline/40 px-3 py-1.5 text-[12.5px] text-ink hover:bg-control disabled:cursor-not-allowed disabled:opacity-45"
          >
            {loading ? "Refreshing" : "Refresh"}
          </button>
        </div>
        <label className="flex flex-col gap-1.5 text-[12.5px] text-ink-secondary">
          Language
          <select
            aria-label="Filter voices by language"
            value={languageFilter}
            onChange={(event) => setLanguageFilter(event.target.value)}
            disabled={loading && voices.length === 0}
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-accent sm:max-w-64"
          >
            <option value="">All languages</option>
            {languageFilter && !languages.includes(languageFilter) && <option value={languageFilter}>{languageFilter}</option>}
            {languages.map((language) => <option key={language} value={language}>{language}</option>)}
          </select>
        </label>
        {error && (
          <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
            {error}
          </div>
        )}
        {loading && voices.length === 0 ? (
          <div className="rounded-lg border border-hairline/40 bg-inset px-3 py-8 text-center text-[13px] text-ink-secondary">
            Loading MagicTeams voices...
          </div>
        ) : visibleVoices.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {visibleVoices.map((voice) => {
              const language = voice.languageLabel || voice.primaryLanguage || "Unknown language";
              return (
                <div key={voice.voiceId} className="rounded-lg border border-hairline/35 bg-inset px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-medium text-ink">{voice.name}</div>
                      <div className="mt-1 truncate text-[12px] text-ink-secondary">
                        {[language, voice.provider].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void playPreview(voice.voiceId)}
                      aria-label={`${playingVoiceId === voice.voiceId && !previewPaused ? "Pause" : "Play"} ${voice.name}`}
                      title={playingVoiceId === voice.voiceId && !previewPaused ? "Pause" : "Play"}
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full border border-hairline/40 bg-card text-ink transition-colors hover:bg-control",
                        playingVoiceId === voice.voiceId && "border-accent text-accent",
                      )}
                    >
                      {playingVoiceId === voice.voiceId && !previewPaused ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-hairline/40 bg-inset px-3 py-8 text-center text-[13px] text-ink-secondary">
            {languageFilter ? `No ${languageFilter} voices found. Try another language.` : "No voices found."}
          </div>
        )}
      </div>
    </Card>
  );
}

type AnalysisProvider = NonNullable<ConfigStatus["analysis"]>["provider"];
type AnalysisConnectionCheck = {
  provider: AnalysisProvider;
  status: "checking" | "connected" | "not_connected";
  message: string;
} | null;

const ANALYSIS_PROVIDERS: Array<{
  id: AnalysisProvider;
  label: string;
  defaultModel: string;
  keyLabel: string;
  keyPlaceholder: string;
  note: string;
}> = [
  {
    id: "gemini",
    label: "Gemini",
    defaultModel: "gemini-1.5-flash",
    keyLabel: "Gemini API key",
    keyPlaceholder: "AIza...",
    note: "Google Gemini API for CSV, file, URL, transcript, and prompt analysis.",
  },
  {
    id: "chatgpt",
    label: "ChatGPT / OpenAI",
    defaultModel: "gpt-4o-mini",
    keyLabel: "OpenAI API key",
    keyPlaceholder: "sk-...",
    note: "Uses OpenAI-compatible text generation for analysis workflows.",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    defaultModel: "sonar-pro",
    keyLabel: "Perplexity API key",
    keyPlaceholder: "pplx-...",
    note: "Perplexity chat completions for research-heavy analysis.",
  },
  {
    id: "grok",
    label: "Grok / xAI",
    defaultModel: "grok-3-mini",
    keyLabel: "xAI API key",
    keyPlaceholder: "xai-...",
    note: "xAI chat completions for analysis.",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    defaultModel: "deepseek-chat",
    keyLabel: "DeepSeek API key",
    keyPlaceholder: "sk-...",
    note: "DeepSeek chat completions for lower-cost analysis.",
  },
  {
    id: "cloudflare",
    label: "Cloudflare AI",
    defaultModel: "@cf/meta/llama-3.1-8b-instruct",
    keyLabel: "Cloudflare API token",
    keyPlaceholder: "Paste Cloudflare API token",
    note: "Requires account ID plus API token.",
  },
  {
    id: "claude",
    label: "Claude / Anthropic",
    defaultModel: "claude-3-5-sonnet-latest",
    keyLabel: "Anthropic API key",
    keyPlaceholder: "sk-ant-...",
    note: "Anthropic Messages API for analysis.",
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    defaultModel: "meta/llama-3.1-70b-instruct",
    keyLabel: "NVIDIA API key",
    keyPlaceholder: "nvapi-...",
    note: "NVIDIA hosted NIM inference API.",
  },
  {
    id: "mistral",
    label: "Mistral",
    defaultModel: "mistral-large-latest",
    keyLabel: "Mistral API key",
    keyPlaceholder: "Paste Mistral API key",
    note: "Mistral direct API for analysis.",
  },
  {
    id: "ollama",
    label: "Ollama / local",
    defaultModel: "llama3.1",
    keyLabel: "Ollama base URL",
    keyPlaceholder: "http://127.0.0.1:11434",
    note: "Local Ollama endpoint; no API key required.",
  },
];

const ANALYSIS_LANGUAGES = [
  { value: "", label: "Default" },
  { value: "English", label: "English" },
  { value: "Telugu", label: "Telugu" },
  { value: "Hindi", label: "Hindi" },
  { value: "Tamil", label: "Tamil" },
  { value: "Kannada", label: "Kannada" },
  { value: "Malayalam", label: "Malayalam" },
  { value: "Spanish", label: "Spanish" },
  { value: "French", label: "French" },
  { value: "German", label: "German" },
  { value: "Arabic", label: "Arabic" },
] as const;

function AiAnalysisSettings() {
  const { state, dispatch } = useStore();
  const config = state.config?.analysis;
  const [provider, setProvider] = useState<AnalysisProvider>(config?.provider ?? "gemini");
  const [model, setModel] = useState(config?.model ?? "");
  const [language, setLanguage] = useState(config?.language ?? "");
  const [cloudflareAccountId, setCloudflareAccountId] = useState(config?.cloudflareAccountId ?? "");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(config?.ollamaBaseUrl ?? "");
  const [keys, setKeys] = useState<Record<AnalysisProvider, string>>({
    gemini: "",
    chatgpt: "",
    perplexity: "",
    grok: "",
    deepseek: "",
    cloudflare: "",
    claude: "",
    nvidia: "",
    mistral: "",
    ollama: "",
  });
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [connectionCheck, setConnectionCheck] = useState<AnalysisConnectionCheck>(null);

  useEffect(() => {
    setProvider(config?.provider ?? "gemini");
    setModel(config?.model ?? "");
    setLanguage(config?.language ?? "");
    setCloudflareAccountId(config?.cloudflareAccountId ?? "");
    setOllamaBaseUrl(config?.ollamaBaseUrl ?? "");
  }, [config?.provider, config?.model, config?.language, config?.cloudflareAccountId, config?.ollamaBaseUrl]);

  const configured = config?.configured ?? {
    gemini: false,
    chatgpt: false,
    perplexity: false,
    grok: false,
    deepseek: false,
    cloudflare: false,
    claude: false,
    nvidia: false,
    mistral: false,
    ollama: false,
  };

  const selectedProvider = ANALYSIS_PROVIDERS.find((entry) => entry.id === provider) ?? ANALYSIS_PROVIDERS[0];
  const selectedModel = model || selectedProvider.defaultModel;
  const selectedProviderIsOllama = selectedProvider.id === "ollama";
  const selectedProviderConnected = configured[selectedProvider.id];
  const selectedProviderValue = selectedProviderIsOllama ? ollamaBaseUrl : keys[selectedProvider.id];
  const selectedProviderClearing = !selectedProviderValue.trim() && selectedProviderConnected;
  const selectedProviderCheck = connectionCheck?.provider === selectedProvider.id ? connectionCheck : null;
  const selectedProviderDisplayConnected = selectedProviderCheck
    ? selectedProviderCheck.status === "connected"
    : selectedProviderConnected;

  const saveAnalysis = async (body: unknown, savingKey: string): Promise<ConfigStatus | null> => {
    setSaving(savingKey);
    setError("");
    try {
      const status: ConfigStatus = await api("/api/config", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      dispatch({ type: "configStatus", config: status });
      return status;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return null;
    } finally {
      setSaving(null);
    }
  };

  const saveDefaults = async () => {
    const status = await saveAnalysis(
      {
        analysis: {
          provider,
          model: selectedModel.trim(),
          language: language.trim(),
          cloudflareAccountId: cloudflareAccountId.trim(),
          ollamaBaseUrl: ollamaBaseUrl.trim(),
        },
      },
      "defaults",
    );
    if (status) await testProviderConnection(provider);
  };

  const testProviderConnection = async (id: AnalysisProvider) => {
    setConnectionCheck({ provider: id, status: "checking", message: "Checking connection..." });
    try {
      const result: { connected?: boolean; message?: string } = await api("/api/ai/test-connection", {
        method: "POST",
        body: JSON.stringify({ provider: id, model: selectedModel.trim() }),
      });
      setConnectionCheck({
        provider: id,
        status: result.connected ? "connected" : "not_connected",
        message: result.message || (result.connected ? "Connected" : "Not connected"),
      });
    } catch (caught) {
      setConnectionCheck({
        provider: id,
        status: "not_connected",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  };

  const saveProviderConnection = async (id: AnalysisProvider) => {
    const patch = {
      analysis: {
        provider,
        model: selectedModel.trim(),
        language: language.trim(),
        cloudflareAccountId: cloudflareAccountId.trim(),
        ollamaBaseUrl: ollamaBaseUrl.trim(),
        keys: id === "ollama" ? undefined : { [id]: keys[id].trim() },
      },
    };
    const status = await saveAnalysis(patch, id);
    if (!status) return;
    if (selectedProviderClearing || (id === "ollama" && !ollamaBaseUrl.trim())) {
      setConnectionCheck({ provider: id, status: "not_connected", message: "Not connected" });
      return;
    }
    await testProviderConnection(id);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_160px_auto]">
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Analysis provider</span>
          <select
            value={provider}
            onChange={(event) => {
              const next = event.target.value as AnalysisProvider;
              setProvider(next);
              setConnectionCheck(null);
              const info = ANALYSIS_PROVIDERS.find((entry) => entry.id === next);
              setModel(info?.defaultModel || "");
            }}
            className="h-10 w-full rounded-lg border border-hairline/40 bg-inset px-3 text-[13px] text-ink focus:border-hairline focus:outline-none"
          >
            {ANALYSIS_PROVIDERS.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Model</span>
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder={selectedProvider.defaultModel}
            className="h-10 w-full rounded-lg border border-hairline/40 bg-inset px-3 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">Language</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="h-10 w-full rounded-lg border border-hairline/40 bg-inset px-3 text-[13px] text-ink focus:border-hairline focus:outline-none"
          >
            {ANALYSIS_LANGUAGES.map((entry) => (
              <option key={entry.value || "default"} value={entry.value}>{entry.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void saveDefaults()}
          disabled={saving !== null}
          className="self-end rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
        >
          {saving === "defaults" ? "Saving..." : "Save"}
        </button>
      </div>

      <div className="rounded-xl border border-hairline/40 bg-inset px-3 py-2 text-[12.5px] leading-relaxed text-ink-secondary">
        Selected: <span className="font-medium text-ink">{selectedProvider.label}</span> using{" "}
        <span className="font-mono text-ink">{selectedModel}</span>
        {language.trim() ? <> replying in <span className="font-medium text-ink">{language.trim()}</span></> : null}. {selectedProvider.note}
      </div>

      <div className="rounded-xl border border-hairline/35 bg-inset p-3">
        <div className="mb-2 flex items-start gap-2">
          <span className={cn("mt-1.5 size-1.5 rounded-full", selectedProviderDisplayConnected ? "bg-success" : "bg-raised-hover")} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium text-ink">Connect {selectedProvider.label}</span>
              {selectedProviderCheck?.status === "checking" ? (
                <span className="text-[11px] text-ink-secondary">Checking...</span>
              ) : selectedProviderCheck?.status === "not_connected" ? (
                <span className="text-[11px] text-danger">Not connected</span>
              ) : selectedProviderDisplayConnected ? (
                <span className="text-[11px] text-success">Connected</span>
              ) : (
                <span className="text-[11px] text-ink-secondary">Not connected</span>
              )}
            </div>
            <div className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">
              {selectedProvider.note} This connection is used with <span className="font-mono text-ink">{selectedModel}</span>.
            </div>
            {selectedProviderCheck?.message && selectedProviderCheck.status !== "checking" ? (
              <div className={cn("mt-1 text-[12px] leading-relaxed", selectedProviderCheck.status === "connected" ? "text-success" : "text-danger")}>
                {selectedProviderCheck.message}
              </div>
            ) : null}
          </div>
        </div>
        {selectedProvider.id === "cloudflare" && (
          <input
            value={cloudflareAccountId}
            onChange={(event) => setCloudflareAccountId(event.target.value)}
            placeholder="Cloudflare account ID"
            aria-label="Cloudflare account ID"
            className="mb-2 w-full rounded-lg border border-hairline/40 bg-card px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
          />
        )}
        <div className="flex gap-2">
          <input
            type={selectedProviderIsOllama ? "url" : "password"}
            value={selectedProviderValue}
            onChange={(event) => {
              const next = event.target.value;
              if (selectedProviderIsOllama) setOllamaBaseUrl(next);
              else setKeys((current) => ({ ...current, [selectedProvider.id]: next }));
            }}
            onKeyDown={(event) => event.key === "Enter" && void saveProviderConnection(selectedProvider.id)}
            placeholder={
              selectedProviderConnected && !selectedProviderIsOllama
                ? "••••••••  (paste to replace)"
                : selectedProvider.keyPlaceholder
            }
            aria-label={selectedProvider.keyLabel}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-hairline/40 bg-card px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void saveProviderConnection(selectedProvider.id)}
            disabled={saving !== null || (!selectedProviderValue.trim() && !selectedProviderConnected)}
            className={cn(
              "flex w-[76px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-control py-2 text-[13px] hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50",
              selectedProviderClearing ? "text-danger" : "text-ink",
            )}
          >
            {saving === selectedProvider.id ? (
              <Loader2 size={13} className="animate-spin" />
            ) : selectedProviderClearing ? (
              "Clear"
            ) : (
              <>
                <Check size={13} />
                Save
              </>
            )}
          </button>
        </div>
      </div>

      {error ? <div role="alert" className="text-[12px] text-danger">{error}</div> : null}
    </div>
  );
}

export function SettingsModal() {
  const { state, dispatch } = useStore();
  const hosted = state.config?.hosted === true;
  const sections = hosted ? HOSTED_SECTIONS : SECTIONS;
  const navItems = hosted ? HOSTED_NAV_ITEMS : NAV_ITEMS;
  const section = state.appSettingsSection === "engines" || state.appSettingsSection === "connections" ? "general" : state.appSettingsSection;
  const dialogRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visibleSections = navItems.filter((entry) => sectionMatches(entry, q));


  useEffect(() => {
    const visible = navItems.filter(
      (entry): entry is Extract<(typeof NAV_ITEMS)[number], { kind: "section" }> =>
        entry.kind === "section" && sectionMatches(entry, q),
    );
    if (visible.some((entry) => entry.id === section)) return;
    const first = visible[0];
    if (first) dispatch({ type: "toggleAppSettings", open: true, section: first.id });
  }, [dispatch, navItems, q, section]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "toggleAppSettings", open: false });
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [dispatch]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-0 sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && dispatch({ type: "toggleAppSettings", open: false })}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-settings-title"
        tabIndex={-1}
        className="flex h-[100dvh] w-full max-w-[860px] flex-col overflow-hidden border-0 bg-panel shadow-2xl outline-none sm:h-[560px] sm:flex-row sm:rounded-2xl sm:border sm:border-hairline/50"
      >
        {/* section nav */}
        <nav className="flex w-full shrink-0 gap-1 overflow-x-auto border-b border-hairline/40 p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-[190px] sm:flex-col sm:gap-0.5 sm:overflow-x-visible sm:border-b-0 sm:border-r sm:p-3">
          <div id="app-settings-title" className="hidden px-2 pb-2 pt-1 text-[15px] font-semibold text-ink sm:block">
            Settings
          </div>
          <div className="mb-1.5 hidden items-center gap-2 rounded-lg bg-control/70 px-2.5 py-1.5 sm:flex">
            <Search size={14} className="shrink-0 text-ink-secondary" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.stopPropagation();
                if (query) setQuery("");
                else dispatch({ type: "toggleAppSettings", open: false });
              }}
              placeholder="Search"
              aria-label="Search settings"
              className="w-full bg-transparent text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </div>
          {visibleSections.length === 0 && (
            <div className="hidden px-2.5 py-4 text-[12.5px] leading-relaxed text-ink-secondary sm:block">
              Nothing matches “{query.trim()}”
            </div>
          )}
          {visibleSections.map((entry) => {
            const Icon = entry.icon;
            const active = entry.kind === "section" && section === entry.id;
            return (
              <button
                key={entry.id}
                onClick={() => {
                  if (entry.kind === "section") {
                    dispatch({ type: "toggleAppSettings", open: true, section: entry.id });
                  } else {
                    dispatch({ type: "showRoutines" });
                  }
                }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] sm:gap-2.5 sm:text-[14px]",
                  active ? "bg-control text-ink" : "text-ink-secondary hover:bg-control/50 hover:text-ink",
                )}
              >
                <Icon size={15} />
                {entry.label}
              </button>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[15px] font-semibold text-ink">
                {sections.find((s) => s.id === section)?.label}
              </span>
            </div>
            <button
              onClick={() => dispatch({ type: "toggleAppSettings", open: false })}
              aria-label="Close settings"
              className="rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-5 sm:pb-5">
            {section === "general" && (
              <>
                <Card title="Profile" subtitle="Shown in the sidebar. Saved as you go.">
                  <ProfileFields />
                </Card>
              </>
            )}

            {section === "general" && (
              <Card
                title="AI Agent"
                subtitle="Choose the analysis model and connect the provider keys used for CSVs, files, URLs, calls, and prompt generation."
              >
                <div className="flex flex-col gap-4">
                  <AiAnalysisSettings />
                  <details className="rounded-lg border border-hairline/40 bg-inset px-3 py-2">
                    <summary className="cursor-pointer text-[13px] text-ink-secondary">Runtime connections</summary>
                    <div className="mt-4 flex flex-col gap-4">
                      {state.config?.composio.mode === "managed" ? (
                        <div className="rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-[13px] text-success">
                          Integrations service is ready
                        </div>
                      ) : null}
                      {hosted ? (
                        <ApiKeyRow section="composio" />
                      ) : (
                        <>
                          {window.ogb?.transcription && <TranscriptionSettings />}
                          <CloudflareConnection />
                          <VpsConnection />
                          <ApiKeyRow section="opencodeGo" />
                          <details className="rounded-lg border border-hairline/40 bg-card px-3 py-2">
                            <summary className="cursor-pointer text-[13px] text-ink-secondary">Self-host integrations</summary>
                            <div className="mt-3">
                              <ApiKeyRow section="composio" />
                            </div>
                          </details>
                        </>
                      )}
                    </div>
                  </details>
                </div>
              </Card>
            )}

            {section === "general" && (
              <>
                <AccountRow />
                <DevicesRow />
                <Card title="Skin" subtitle="Applies instantly and is remembered on this machine.">
                  <SkinPicker />
                </Card>
                {!hosted && (
                  <Card title="Team turns" subtitle="Set one maximum duration for every bot turn in a team.">
                    <RoomTurnTimeoutSettings />
                  </Card>
                )}
                <WebAppRow />
                {!hosted && <ExperimentalFeaturesRow />}
                <UpdatesRow />
                <DiagnosticsRow />
                <AnalyticsRow />
              </>
            )}

            {section === "analysis" && <CampaignWorkspace />}

            {section === "voices" && <VoicesSection />}

            {section === "computer" && (
              <LocalComputerSection
                onOpenIntegrations={() => {
                  dispatch({ type: "toggleAppSettings", open: true, section: "integrations" });
                }}
              />
            )}

            {section === "integrations" && <IntegrationsSection />}

            {section === "usage" && <HistorySection />}
          </div>
        </div>
      </div>
    </div>
  );
}

function DevicesRow() {
  const { state } = useStore();
  if (!state.config?.hosted) return null;
  return (
    <Card
      title="Your devices"
      subtitle="Sign in with the same MagicTeams account on your phone, tablet, and computers. Each device keeps its own secure session and shares the same bots and conversations."
    >
      <a
        href="/logout"
        className="inline-flex rounded-lg border border-hairline/40 px-3 py-1.5 text-[13px] text-ink transition-colors hover:bg-control"
      >
        Sign out this device
      </a>
    </Card>
  );
}

function UpdatesRow() {
  const s = useUpdaterState();
  if (!window.ogb?.updater) return null;
  const updater = window.ogb.updater;
  const label =
    s?.status === "checking"
      ? "Checking…"
      : s?.status === "available"
        ? `${s.version} available`
        : s?.status === "downloading"
          ? `Downloading ${Math.round(s.percent ?? 0)}%`
          : s?.status === "downloaded"
            ? `${s.version} ready — restart to apply`
            : s?.status === "error"
              ? `Check failed: ${s.message ?? "unknown error"}`
              : "You're on the latest version we know of.";
  return (
    <Card title="Updates" subtitle={label}>
      <button
        onClick={() => {
          if (s?.status === "available") return void updater.download();
          if (s?.status === "downloaded") return void updater.install();
          void updater.check();
        }}
        disabled={s?.status === "checking" || s?.status === "downloading"}
        className="rounded-lg border border-hairline/40 px-3 py-1.5 text-[13px] text-ink hover:bg-control disabled:opacity-40"
      >
        {s?.status === "available"
          ? "Download"
          : s?.status === "downloaded"
            ? "Restart and install"
            : "Check for updates"}
      </button>
    </Card>
  );
}

function WebAppRow() {
  const webApp = useWebAppInstall();
  if (window.ogb) return null;
  return (
    <Card
      title="Web app"
      subtitle={
        webApp.installed
          ? "MagicTeams is installed and opens in its own window."
          : "Install MagicTeams for one-click access, an app window, and a cached shell when the network drops."
      }
    >
      {webApp.installed ? (
        <span className="text-[13px] font-medium text-success">Installed</span>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={() => void webApp.install()}
            disabled={!webApp.installable}
            className="rounded-lg border border-hairline/40 px-3 py-1.5 text-[13px] text-ink hover:bg-control disabled:cursor-not-allowed disabled:opacity-45"
          >
            Install MagicTeams
          </button>
          {!webApp.installable && (
            <span className="text-[12px] text-ink-secondary">
              If your browser supports installation, use its “Install app” menu after loading the production web build.
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

function AnalyticsRow() {
  const [on, setOn] = useState(analyticsEnabled);
  return (
    <Card
      title="Usage analytics"
      subtitle="Anonymous product events — app opened, which features get used. Never conversations, prompts, file contents, or bot output. Your email is only attached if you shared it during setup."
    >
      <button
        role="switch"
        aria-checked={on}
        aria-label="Send usage analytics"
        onClick={() => {
          const next = !on;
          setAnalyticsEnabled(next);
          setOn(next);
        }}
        className={cnSwitch(on)}
      >
        <span className={cnKnob(on)} />
      </button>
    </Card>
  );
}

function ExperimentalFeaturesRow() {
  const { state, dispatch } = useStore();
  const enabled = skillRecorderEnabled(state.config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { skillRecorder: !enabled } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the experimental feature setting.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Experimental features"
      subtitle="Early features may change while we test them. They stay off unless you enable them."
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-ink">Teach a skill</div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">
            Show the workflow recorder in the sidebar.
          </div>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          aria-label="Show Teach a skill"
          disabled={saving}
          onClick={() => void toggle()}
          className={`${cnSwitch(enabled)} disabled:cursor-wait disabled:opacity-50`}
        >
          <span className={cnKnob(enabled)} />
        </button>
      </div>
      {error ? <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p> : null}
    </Card>
  );
}

const cnSwitch = (on: boolean) =>
  `relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-control"}`;

const cnKnob = (on: boolean) =>
  `absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-all ${on ? "left-[21px]" : "left-[3px]"}`;

function DiagnosticsRow() {
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const exportDiagnostics = async () => {
    if (!window.ogb?.exportDiagnostics || exporting) return;
    setExporting(true);
    setResult(null);
    try {
      const path = await window.ogb.exportDiagnostics();
      if (path) setResult({ kind: "success", message: `Saved to ${path}` });
    } catch (e) {
      setResult({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setExporting(false);
    }
  };

  if (!window.ogb?.exportDiagnostics) return null;
  return (
    <Card
      title="Diagnostics"
      subtitle="Versions, configuration on/off state and a redacted server log tail. Review the file before sharing it."
    >
      <div className="flex min-w-0 flex-col items-end gap-2">
        <button
          onClick={() => void exportDiagnostics()}
          disabled={exporting}
          aria-label="Export diagnostics to a text file"
          className="rounded-lg border border-hairline/40 px-3 py-1.5 text-[13px] text-ink hover:bg-control disabled:opacity-40"
        >
          {exporting ? "Exporting…" : "Export Diagnostics…"}
        </button>
        {result ? (
          <span
            role={result.kind === "error" ? "alert" : "status"}
            className={`max-w-64 break-all text-right text-[12px] ${result.kind === "error" ? "text-danger" : "text-success"}`}
          >
            {result.message}
          </span>
        ) : null}
      </div>
    </Card>
  );
}
