// Integrations marketplace, backed by Composio Sessions. Catalog comes
// from /api/connectors/catalog — the full toolkit list with logos when a
// Composio API key is configured, a curated set otherwise. Icons resolve
// logo → favicon → monogram.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, Loader2, RefreshCw, Search, X } from "lucide-react";
import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { Card } from "./SettingsPrimitives";

interface ToolkitCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  domain: string | null;
  authConfigId?: string;
}

type CatalogSource = "api" | "curated";
type ConnectionMode = "managed" | "self-hosted" | "unavailable";

interface IntegrationsCatalogCache {
  cards: ToolkitCard[];
  source: CatalogSource;
  configured: boolean;
  mode: ConnectionMode;
  services: Record<string, ConnectorStatus>;
  at: number;
}

const INTEGRATIONS_CATALOG_CACHE_MS = 10 * 60_000;
let integrationsCatalogCache: IntegrationsCatalogCache | null = null;

function getFreshIntegrationsCatalogCache() {
  if (!integrationsCatalogCache) return null;
  if (Date.now() - integrationsCatalogCache.at > INTEGRATIONS_CATALOG_CACHE_MS) return null;
  return integrationsCatalogCache;
}

function saveIntegrationsCatalogCache(result: {
  cards?: ToolkitCard[];
  source?: CatalogSource;
  configured?: boolean;
  mode?: ConnectionMode;
  services?: Record<string, ConnectorStatus>;
}) {
  integrationsCatalogCache = {
    cards: Array.isArray(result.cards) ? result.cards : [],
    source: result.source ?? "curated",
    configured: Boolean(result.configured),
    mode: result.mode ?? "unavailable",
    services: result.services && typeof result.services === "object" ? result.services : {},
    at: Date.now(),
  };
  return integrationsCatalogCache;
}

export interface ConnectorStatus {
  connected: boolean;
  pending?: boolean;
  status?: string;
  accounts?: Array<{
    id: string;
    alias?: string;
    status: string;
  }>;
}

function activeConnectorAccounts(accounts: ConnectorStatus["accounts"] = []) {
  return accounts.filter((account) => /^active$/i.test(account.status));
}

export function disconnectAccountConfirmation(
  service: string,
  account: { id: string; alias?: string },
) {
  const identity = account.alias ? `“${account.alias}” (${account.id})` : `“${account.id}”`;
  return `Disconnect ${identity} from ${service}? Only this ${service} account will be revoked. Your other ${service} accounts will stay connected.`;
}

export function mergeCurrentConnectorStatus(
  current: Record<string, ConnectorStatus>,
  incoming: Record<string, ConnectorStatus>,
  latestGenerations: ReadonlyMap<string, number>,
  requestGenerations: ReadonlyMap<string, number>,
) {
  const next = { ...current };
  for (const [slug, state] of Object.entries(incoming)) {
    if ((latestGenerations.get(slug) ?? 0) !== (requestGenerations.get(slug) ?? 0)) continue;
    next[slug] = state;
  }
  return next;
}

export function mergeCompleteConnectorStatus(
  current: Record<string, ConnectorStatus>,
  incoming: Record<string, ConnectorStatus>,
  latestGenerations: ReadonlyMap<string, number>,
  requestGenerations: ReadonlyMap<string, number>,
) {
  const next = { ...current };
  for (const [slug, state] of Object.entries(current)) {
    if (incoming[slug]) continue;
    if (!state.connected && !state.accounts?.length) continue;
    if ((latestGenerations.get(slug) ?? 0) !== (requestGenerations.get(slug) ?? 0)) continue;
    next[slug] = { connected: false, pending: false, status: "not_connected", accounts: [] };
  }
  return mergeCurrentConnectorStatus(next, incoming, latestGenerations, requestGenerations);
}

function ServiceIcon({ card }: { card: ToolkitCard }) {
  // 0 = official logo, 1 = favicon by domain, 2 = monogram
  const [stage, setStage] = useState(card.logo ? 0 : card.domain ? 1 : 2);
  if (stage === 0 && card.logo) {
    return <img src={card.logo} alt="" className="size-11 rounded-xl object-contain" onError={() => setStage(1)} />;
  }
  if (stage === 1 && card.domain) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${card.domain}&sz=64`}
        alt=""
        className="size-11 rounded-xl object-contain"
        onError={() => setStage(2)}
      />
    );
  }
  return (
    <div className="flex size-11 items-center justify-center rounded-xl bg-raised text-[15px] font-semibold text-ink-secondary">
      {card.label.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function IntegrationsSection() {
  const { dispatch } = useStore();
  const initialCatalog = getFreshIntegrationsCatalogCache();
  const [cards, setCards] = useState<ToolkitCard[] | null>(initialCatalog?.cards ?? null);
  const [source, setSource] = useState<CatalogSource>(initialCatalog?.source ?? "curated");
  const [configured, setConfigured] = useState(initialCatalog?.configured ?? true);
  const [mode, setMode] = useState<ConnectionMode>(initialCatalog?.mode ?? "unavailable");
  const [status, setStatus] = useState<Record<string, ConnectorStatus>>(initialCatalog?.services ?? {});
  const [pendingUrls, setPendingUrls] = useState<Record<string, string>>({});
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const statusGenerations = useRef(new Map<string, number>());
  const hadInitialCatalog = useRef(cards !== null);

  const refreshConnectedStatus = useCallback(() => {
    const requestGenerations = new Map(statusGenerations.current);
    setError(null);
    setRefreshing(true);
    return api("/api/connectors/connected")
      .then((r) => {
        const services: Record<string, ConnectorStatus> = r.services ?? {};
        setStatus((current) => mergeCompleteConnectorStatus(current, services, statusGenerations.current, requestGenerations));
        return services;
      })
      .catch(() => ({}))
      .finally(() => setRefreshing(false));
  }, []);

  const loadCatalog = useCallback(async (signal: AbortSignal) => {
    setRefreshing(true);
    setError(null);
    try {
      const r = await api("/api/connectors/catalog", { signal });
      if (signal.aborted) return;
      const cached = saveIntegrationsCatalogCache(r);
      setCards(cached.cards);
      setSource(cached.source);
      setConfigured(cached.configured);
      setMode(cached.mode);
      setStatus((current) => ({ ...current, ...cached.services }));
      if (cached.configured) void refreshConnectedStatus();
    } catch (e) {
      if (signal.aborted && signal.reason?.name === "AbortError") return;
      setCards((current) => current ?? []);
      setError(signal.aborted
        ? "Integrations took too long to load. Click Refresh to try again."
        : e instanceof Error ? e.message : String(e));
    } finally {
      if (signal.reason?.name !== "AbortError") setRefreshing(false);
    }
  }, [refreshConnectedStatus]);

  useEffect(() => {
    const controller = new AbortController();
    if (hadInitialCatalog.current) void refreshConnectedStatus();
    void loadCatalog(AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]));
    return () => controller.abort();
  }, [loadCatalog, refreshConnectedStatus]);

  const reserveConnectWindow = () => window.ogb?.openExternal ? null : window.open("", "_blank");

  const openConnectUrl = async (url: string, reservedWindow: Window | null = null) => {
    if (window.ogb?.openExternal) {
      await window.ogb.openExternal(url);
      return;
    }
    const opened = reservedWindow ?? window.open("", "_blank");
    if (!opened) throw new Error("Your browser blocked the connection page. Click Connect again to open it.");
    opened.opener = null;
    opened.location.replace(url);
  };

  const connect = async (card: ToolkitCard) => {
    const reservedWindow = reserveConnectWindow();
    const slug = card.slug;
    statusGenerations.current.set(slug, (statusGenerations.current.get(slug) ?? 0) + 1);
    setBusySlug(slug);
    setError(null);
    try {
      const request: RequestInit = { method: "POST" };
      if (card.authConfigId) request.body = JSON.stringify({ authConfigId: card.authConfigId, auth_config_id: card.authConfigId });
      const { url } = await api(`/api/connectors/${slug}/authorize`, request);
      setPendingUrls((current) => ({ ...current, [slug]: url }));
      setStatus((current) => ({
        ...current,
        [slug]: { ...current[slug], connected: current[slug]?.connected ?? false, pending: true, status: "INITIATED" },
      }));
      await openConnectUrl(url, reservedWindow);
    } catch (e) {
      reservedWindow?.close();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusySlug(null);
    }
  };

  const disconnectAccount = (slug: string, accountId: string) => {
    setBusySlug(slug);
    api(`/api/connectors/${slug}/accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" })
      .then(() => refreshConnectedStatus())
      .catch((e) => setError(e.message))
      .finally(() => setBusySlug(null));
  };

  const visible = (cards ?? []).filter(
    (card) => !search || `${card.label} ${card.slug} ${card.blurb}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Card title="Integrations" subtitle="Connect the integrations your bots can use.">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-hairline/40 bg-inset px-3">
            <Search size={15} className="shrink-0 text-ink-secondary" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setError(null);
              }}
              placeholder="Search integrations"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </label>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void loadCatalog(AbortSignal.timeout(35_000))}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-hairline/40 px-3 text-[13px] text-ink hover:bg-control"
          >
            <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
            Refresh
          </button>
        </div>

        {!configured ? (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
            Integrations are temporarily unavailable. Configure the connection service in AI Analysis.
          </div>
        ) : null}
        {configured && source === "curated" && mode === "self-hosted" ? (
          <div className="text-[12px] text-ink-secondary">
            Showing featured apps.{" "}
            <button
              className="underline underline-offset-2 hover:text-ink"
              onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "connections", backTarget: "plugins" })}
            >
              Update your Composio key
            </button>{" "}
            for the full catalog.
          </div>
        ) : null}
        {error ? <div role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div> : null}

        {cards === null ? (
          <div className="flex items-center gap-2 rounded-lg border border-hairline/35 bg-inset px-3 py-4 text-[13px] text-ink-secondary">
            <Loader2 size={14} className="animate-spin" />
            Loading integrations...
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-lg border border-hairline/35 bg-inset px-3 py-6 text-center text-[13px] text-ink-secondary">
            No integrations found.
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-hairline/40 pb-2 text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary">
              <span>Integration</span>
              <span className="text-right">Status</span>
              <span className="text-right">Action</span>
            </div>
            {visible.map((card) => {
              const serviceStatus = status[card.slug];
              const pending = serviceStatus?.pending;
              const failed = serviceStatus?.status && /^(expired|failed)$/i.test(serviceStatus.status);
              const accounts = serviceStatus?.accounts ?? [];
              const activeAccounts = activeConnectorAccounts(accounts);
              const included = serviceStatus?.connected === true && !activeAccounts.length && !pending && !failed;
              const busy = busySlug === card.slug;
              return (
                <div key={card.slug} className="border-b border-hairline/20 py-2.5">
                  <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 text-[13px]">
                    <span className="flex min-w-0 items-center gap-3 text-ink">
                      <ServiceIcon card={card} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{card.label}</span>
                        <span className="mt-0.5 block truncate text-[12px] text-ink-secondary">
                          {pending ? "Finish setup in your browser" : failed && !accounts.length ? "Authorization expired" : card.blurb}
                        </span>
                      </span>
                    </span>
                    <span className="text-right text-[12px] text-ink-secondary">
                      {activeAccounts.length ? `${activeAccounts.length} connected` : pending ? "Pending" : included ? "Included" : "Not connected"}
                    </span>
                    <button
                      type="button"
                      disabled={!configured || busy || included}
                      onClick={() => {
                        if (pending && pendingUrls[card.slug]) {
                          setError(null);
                          void openConnectUrl(pendingUrls[card.slug]).catch((e) => setError(e.message));
                        } else void connect(card);
                      }}
                      className="min-w-[88px] rounded-lg border border-hairline/40 px-3 py-1.5 text-[12.5px] text-ink hover:bg-control disabled:opacity-40"
                    >
                      {busy ? <Loader2 size={13} className="mx-auto animate-spin" /> : pending && pendingUrls[card.slug] ? "Continue" : included ? "Included" : failed ? "Retry" : activeAccounts.length ? "Add" : "Connect"}
                    </button>
                  </div>
                  {activeAccounts.length > 0 ? (
                    <div className="ml-14 mt-2 flex flex-col gap-1.5">
                      {activeAccounts.map((account) => (
                        <div key={account.id} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg bg-inset px-3 py-2 text-[12px]">
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 text-ink">
                              {/active/i.test(account.status) ? <Check size={13} className="text-success" /> : null}
                              <span className="truncate">{account.alias || account.id}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-ink-secondary">{account.status.toLowerCase()}</span>
                          </span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => disconnectAccount(card.slug, account.id)}
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
    </Card>
  );
}

export function PluginsPanel() {
  const { dispatch } = useStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialCatalog = getFreshIntegrationsCatalogCache();
  const [cards, setCards] = useState<ToolkitCard[] | null>(initialCatalog?.cards ?? null);
  const [source, setSource] = useState<CatalogSource>(initialCatalog?.source ?? "curated");
  const [configured, setConfigured] = useState(initialCatalog?.configured ?? true);
  const [mode, setMode] = useState<ConnectionMode>(initialCatalog?.mode ?? "unavailable");
  const [status, setStatus] = useState<Record<string, ConnectorStatus>>(initialCatalog?.services ?? {});
  const [pendingUrls, setPendingUrls] = useState<Record<string, string>>({});
  const [aliasSlug, setAliasSlug] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"marketplace" | "connected">("marketplace");
  const [disconnectTarget, setDisconnectTarget] = useState<{
    slug: string;
    service: string;
    account: { id: string; alias?: string; status: string };
  } | null>(null);

  const pollTimers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const statusGenerations = useRef(new Map<string, number>());
  const hadInitialCatalog = useRef(cards !== null);

  const refreshStatus = useCallback((slugs: string[]): Promise<Record<string, ConnectorStatus>> => {
    if (!slugs.length) return Promise.resolve({});
    const requestGenerations = new Map(slugs.map((slug) => [slug, statusGenerations.current.get(slug) ?? 0]));
    setError(null);
    setRefreshing(true);
    return api(`/api/connectors?services=${slugs.join(",")}`)
      .then((r) => {
        const services: Record<string, ConnectorStatus> = r.services ?? {};
        // A one-service OAuth poll must not erase every other app's state.
        // A request that began before Connect must also not erase the newer
        // local INITIATED state when its stale not_connected result arrives.
        setStatus((current) => mergeCurrentConnectorStatus(
          current,
          services,
          statusGenerations.current,
          requestGenerations,
        ));
        for (const [slug, state] of Object.entries(services)) {
          if (state.connected && !state.pending) setPendingUrls((current) => {
            if (!current[slug]) return current;
            const next = { ...current };
            delete next[slug];
            return next;
          });
        }
        return services;
      })
      .catch(() => ({}))
      .finally(() => setRefreshing(false));
  }, []);

  const refreshConnectedStatus = useCallback((): Promise<Record<string, ConnectorStatus>> => {
    const requestGenerations = new Map(statusGenerations.current);
    setError(null);
    setRefreshing(true);
    return api("/api/connectors/connected")
      .then((r) => {
        const services: Record<string, ConnectorStatus> = r.services ?? {};
        setStatus((current) => mergeCompleteConnectorStatus(
          current,
          services,
          statusGenerations.current,
          requestGenerations,
        ));
        for (const [slug, state] of Object.entries(services)) {
          if (state.connected && !state.pending) setPendingUrls((current) => {
            if (!current[slug]) return current;
            const next = { ...current };
            delete next[slug];
            return next;
          });
        }
        return services;
      })
      .catch(() => ({}))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => () => {
    for (const timer of pollTimers.current.values()) clearInterval(timer);
    pollTimers.current.clear();
  }, []);

  useEffect(() => {
    let alive = true;
    if (hadInitialCatalog.current) void refreshConnectedStatus();
    api("/api/connectors/catalog")
      .then((r) => {
        if (!alive) return;
        const cached = saveIntegrationsCatalogCache(r);
        setCards(cached.cards);
        setSource(cached.source);
        setConfigured(cached.configured);
        setMode(cached.mode);
        setStatus((current) => ({ ...current, ...cached.services }));
        if (cached.configured) void refreshConnectedStatus();
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [refreshConnectedStatus]);

  useEffect(() => {
    const syncAfterOAuth = () => {
      if (document.visibilityState === "hidden") return;
      void refreshConnectedStatus();
    };
    window.addEventListener("focus", syncAfterOAuth);
    window.addEventListener("pageshow", syncAfterOAuth);
    document.addEventListener("visibilitychange", syncAfterOAuth);
    return () => {
      window.removeEventListener("focus", syncAfterOAuth);
      window.removeEventListener("pageshow", syncAfterOAuth);
      document.removeEventListener("visibilitychange", syncAfterOAuth);
    };
  }, [refreshConnectedStatus]);

  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    (dialog?.querySelector<HTMLElement>("input") ?? focusable()[0] ?? dialog)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "togglePlugins", open: false });
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      returnFocus?.focus();
    };
  }, [dispatch]);

  const reserveConnectWindow = () => window.ogb?.openExternal ? null : window.open("", "_blank");

  const openConnectUrl = async (url: string, reservedWindow: Window | null = null) => {
    if (window.ogb?.openExternal) {
      await window.ogb.openExternal(url);
      return;
    }
    // Browser development fallback. If a popup blocker rejects the first
    // asynchronous open, the visible Continue button retries from a direct
    // user gesture using the URL retained in pendingUrls.
    const opened = reservedWindow ?? window.open("", "_blank");
    if (!opened) throw new Error("Your browser blocked the connection page. Click Continue to open it.");
    // Open a same-origin blank page first so the OAuth origin never receives
    // an opener reference, while a real null remains a reliable blocked signal.
    opened.opener = null;
    opened.location.replace(url);
  };

  const startPolling = (slug: string) => {
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
  };

  const connect = async (slug: string, alias?: string) => {
    // Reserve the tab while the click is still a trusted user gesture. The
    // authorize request is asynchronous, and browsers otherwise block the
    // OAuth page by the time Composio returns its URL.
    const reservedWindow = reserveConnectWindow();
    statusGenerations.current.set(slug, (statusGenerations.current.get(slug) ?? 0) + 1);
    setBusySlug(slug);
    setError(null);
    try {
      const request: RequestInit = { method: "POST" };
      if (alias) request.body = JSON.stringify({ alias });
      const { url } = await api(`/api/connectors/${slug}/authorize`, request);
      setPendingUrls((current) => ({ ...current, [slug]: url }));
      setStatus((current) => ({
        ...current,
        [slug]: {
          ...current[slug],
          connected: current[slug]?.connected ?? false,
          pending: true,
          status: "INITIATED",
        },
      }));
      setAliasSlug(null);
      setAliasDraft("");
      startPolling(slug);
      await openConnectUrl(url, reservedWindow);
    } catch (e) {
      reservedWindow?.close();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusySlug(null);
    }
  };

  const disconnectAccount = (slug: string, accountId: string) => {
    setBusySlug(slug);
    api(`/api/connectors/${slug}/accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" })
      .then(() => refreshStatus([slug]))
      .catch((e) => setError(e.message))
      .finally(() => setBusySlug(null));
  };

  const matching = (cards ?? []).filter(
    (c) => !search || `${c.label} ${c.slug} ${c.blurb}`.toLowerCase().includes(search.toLowerCase()),
  );
  const visible = matching.filter((card) =>
    tab === "marketplace" || activeConnectorAccounts(status[card.slug]?.accounts).length > 0
  );
  const connectedCount = Object.values(status).filter((service) => activeConnectorAccounts(service.accounts).length > 0).length;
  const close = () => dispatch({ type: "togglePlugins", open: false });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="integrations-title"
        tabIndex={-1}
        className="relative animate-pop-in flex h-[min(780px,calc(100dvh-2rem))] w-full max-w-[1040px] flex-col overflow-hidden rounded-[24px] border border-hairline/50 bg-panel shadow-2xl shadow-black/50"
      >
        <header className="flex items-start justify-between gap-4 px-6 pb-3 pt-6 sm:px-8 sm:pt-7">
          <div className="flex min-w-0 items-start gap-3">
            <button
              type="button"
              onClick={close}
              aria-label="Back from integrations"
              title="Back"
              className="-ml-2 mt-0.5 rounded-lg p-2 text-ink-secondary hover:bg-raised hover:text-ink"
            >
              <ChevronLeft size={21} />
            </button>
            <div className="min-w-0">
              <h2 id="integrations-title" className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Integrations</h2>
              <p className="mt-1 text-[13px] text-ink-secondary">Connect the integrations your bots can use.</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => refreshConnectedStatus()}
              className="rounded-lg p-2 text-ink-secondary hover:bg-raised hover:text-ink"
              title="Refresh connection status"
            >
              <RefreshCw size={17} className={cn(refreshing && "animate-spin")} />
            </button>
            <button
              onClick={close}
              aria-label="Close integrations"
              className="rounded-lg p-2 text-ink-secondary hover:bg-raised hover:text-ink"
            >
              <X size={21} />
            </button>
          </div>
        </header>

        <div className="flex flex-col gap-3 px-6 pb-4 pt-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex w-fit rounded-xl bg-raised/70 p-1" role="tablist" aria-label="Integrations view">
            <button
              role="tab"
              aria-selected={tab === "marketplace"}
              onClick={() => setTab("marketplace")}
              className={cn(
                "rounded-lg px-4 py-2 text-[13.5px] transition-colors",
                tab === "marketplace" ? "bg-card text-ink shadow-sm" : "text-ink-secondary hover:text-ink",
              )}
            >
              Marketplace
            </button>
            <button
              role="tab"
              aria-selected={tab === "connected"}
              onClick={() => setTab("connected")}
              className={cn(
                "rounded-lg px-4 py-2 text-[13.5px] transition-colors",
                tab === "connected" ? "bg-card text-ink shadow-sm" : "text-ink-secondary hover:text-ink",
              )}
            >
              Connected{connectedCount > 0 ? ` ${connectedCount}` : ""}
            </button>
          </div>
          <label className="flex h-11 w-full items-center gap-2.5 rounded-xl bg-raised/70 px-3.5 sm:w-[320px]">
            <Search size={17} className="shrink-0 text-ink-secondary" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search apps"
              aria-label="Search apps"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </label>
        </div>

        {!configured && (
          <div className="mx-6 mb-1 rounded-xl bg-warning/10 px-4 py-3 text-[13px] text-warning sm:mx-8">
            Integrations are temporarily unavailable. You can retry after restarting, or configure your own connection service.{" "}
            <button
              className="font-medium underline underline-offset-2"
              onClick={() => {
                close();
                dispatch({ type: "toggleAppSettings", open: true, backTarget: "plugins" });
              }}
            >
              Open settings
            </button>
          </div>
        )}
        {configured && source === "curated" && mode === "self-hosted" && (
          <div className="mx-6 mb-1 text-[12px] text-ink-secondary sm:mx-8">
            Showing featured apps.{" "}
            <button
              className="underline underline-offset-2 hover:text-ink"
              onClick={() => {
                close();
                dispatch({ type: "toggleAppSettings", open: true, backTarget: "plugins" });
              }}
            >
              Update your Composio key
            </button>{" "}
            for the full catalog.
          </div>
        )}
        {error && <div role="alert" className="mx-6 mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger sm:mx-8">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-7 pt-5 sm:px-8">
          {cards === null ? (
            <div className="flex items-center justify-center gap-2 py-24 text-[13px] text-ink-secondary">
              <Loader2 size={14} className="animate-spin" /> Loading catalog…
            </div>
          ) : (
            <div>
              <div className="mb-3 text-[12px] font-medium text-ink-secondary">
                {tab === "connected" ? "Your connections" : search ? "Search results" : "Available apps"}
              </div>
              <div className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
              {visible.map((card) => {
              const serviceStatus = status[card.slug];
              const pending = serviceStatus?.pending;
              const failed = serviceStatus?.status && /^(expired|failed)$/i.test(serviceStatus.status);
              const accounts = serviceStatus?.accounts ?? [];
              const activeAccounts = activeConnectorAccounts(accounts);
              // connected with no accounts and nothing in flight = a no-auth
              // toolkit: there is no OAuth to run, so "Connect" would mint a
              // pointless authorize. It ships included.
              const included = serviceStatus?.connected === true && !activeAccounts.length && !pending && !failed;
              const addingAccount = aliasSlug === card.slug;
              const busy = busySlug === card.slug;
              return (
                <div
                  key={card.slug}
                  className="min-h-[88px] border-b border-hairline/35 px-1 py-4"
                >
                  <div className="flex items-center gap-3">
                    <ServiceIcon card={card} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium text-ink">{card.label}</div>
                      <div className="mt-0.5 truncate text-[12.5px] text-ink-secondary">
                        {pending ? "Finish setup in your browser" : failed && !accounts.length ? "Authorization expired — try again" : card.blurb}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!configured || busy || included}
                      onClick={() => {
                        if (pending && pendingUrls[card.slug]) {
                          setError(null);
                          void openConnectUrl(pendingUrls[card.slug]).catch((e) => setError(e.message));
                        } else if (activeAccounts.length) {
                          setAliasSlug((current) => current === card.slug ? null : card.slug);
                          setAliasDraft("");
                        } else void connect(card.slug);
                      }}
                      className="flex min-w-[88px] items-center justify-center gap-1.5 rounded-full bg-raised px-3 py-2 text-[12.5px] text-ink transition-colors hover:bg-raised-hover disabled:opacity-40"
                    >
                      {busy ? (
                        <Loader2 size={13} className="mx-auto animate-spin" />
                      ) : pending && pendingUrls[card.slug] ? (
                        "Continue"
                      ) : activeAccounts.length ? (
                        "Add account"
                      ) : included ? (
                        "Included"
                      ) : failed ? (
                        "Retry"
                      ) : (
                        "Connect"
                      )}
                    </button>
                  </div>
                  {activeAccounts.length > 0 && (
                    <div className="ml-14 mt-3 space-y-2">
                      {activeAccounts.map((account) => {
                        const active = /^active$/i.test(account.status);
                        return (
                          <div key={account.id} className="flex items-center gap-2 rounded-lg bg-raised/45 px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
                                {active && <Check size={13} className="shrink-0 text-success" />}
                                <span className="truncate">{account.alias || account.id}</span>
                              </div>
                              <div className="mt-0.5 truncate text-[10.5px] text-ink-secondary">
                                {account.alias ? `${account.id} · ` : ""}{account.status.toLowerCase()}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setDisconnectTarget({ slug: card.slug, service: card.label, account })}
                              className="rounded-md px-2 py-1 text-[11px] text-ink-secondary transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                              aria-label={`Disconnect ${account.alias || account.id} from ${card.label}`}
                            >
                              Disconnect
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {addingAccount && (
                    <form
                      className="ml-14 mt-3 flex items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const alias = aliasDraft.trim();
                        if (!alias) {
                          setError("Enter a label for the account, such as work or personal.");
                          return;
                        }
                        void connect(card.slug, alias);
                      }}
                    >
                      <input
                        autoFocus
                        value={aliasDraft}
                        maxLength={64}
                        onChange={(event) => setAliasDraft(event.target.value)}
                        placeholder="Account label (work, personal…)"
                        aria-label={`Label for another ${card.label} account`}
                        className="min-w-0 flex-1 rounded-lg bg-raised px-3 py-2 text-[12px] text-ink placeholder:text-ink-secondary focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <button
                        type="submit"
                        disabled={busy || !aliasDraft.trim()}
                        className="rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white disabled:opacity-40"
                      >
                        Continue
                      </button>
                    </form>
                  )}
                </div>
              );
              })}
              </div>
            </div>
          )}
          {cards !== null && visible.length === 0 && (
            <div className="flex min-h-56 flex-col items-center justify-center text-center">
              <div className="text-[14px] font-medium text-ink">
                {tab === "connected" ? "No integrations connected yet" : "No integrations found"}
              </div>
              <div className="mt-1 text-[12.5px] text-ink-secondary">
                {tab === "connected" ? "Connect an app from Marketplace and it will appear here." : "Try a different search."}
              </div>
            </div>
          )}
        </div>
        {disconnectTarget && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/45 px-5 backdrop-blur-[1px]"
            onMouseDown={(event) => event.target === event.currentTarget && setDisconnectTarget(null)}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="disconnect-app-title"
              aria-describedby="disconnect-app-description"
              className="w-full max-w-[420px] rounded-2xl border border-hairline/60 bg-panel p-5 shadow-2xl shadow-black/50"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 id="disconnect-app-title" className="text-[16px] font-semibold text-ink">
                    Disconnect {disconnectTarget.service}
                  </h3>
                  <p id="disconnect-app-description" className="mt-2 text-[13px] leading-relaxed text-ink-secondary">
                    Only this account will be revoked. Other {disconnectTarget.service} accounts will stay connected.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDisconnectTarget(null)}
                  aria-label="Cancel disconnect"
                  className="rounded-lg p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"
                >
                  <X size={17} />
                </button>
              </div>
              <div className="mt-4 rounded-xl bg-raised/60 px-3 py-2">
                <div className="truncate text-[13px] font-medium text-ink">
                  {disconnectTarget.account.alias || disconnectTarget.account.id}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-ink-secondary">
                  {disconnectTarget.account.alias ? `${disconnectTarget.account.id} · ` : ""}
                  {disconnectTarget.account.status.toLowerCase()}
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDisconnectTarget(null)}
                  className="rounded-lg bg-raised px-4 py-2 text-[13px] text-ink transition-colors hover:bg-raised-hover"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const target = disconnectTarget;
                    setDisconnectTarget(null);
                    disconnectAccount(target.slug, target.account.id);
                  }}
                  className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-2 text-[13px] font-medium text-danger transition-colors hover:bg-danger/15"
                >
                  Disconnect
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
