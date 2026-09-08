type Account = {id:string;status:string};
type Service = {connected:boolean;pending:boolean;status:string;accounts:Account[]};
type Call = (path:string, options:{method?:string;authorization?:string;body?:unknown})=>Promise<any>;
type PlatformComposioToolkit = {
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  logo?: unknown;
  id?: unknown;
  authConfigId?: unknown;
  auth_config_id?: unknown;
  authConfig?: unknown;
  auth_config?: unknown;
  connected?: unknown;
  connectionStatus?: unknown;
  connectedAccountId?: unknown;
  noAuth?: unknown;
};

type PlatformComposioConnection = {
  id?: unknown;
  slug?: unknown;
  status?: unknown;
};

function platformComposioToolkitItems(value: unknown): PlatformComposioToolkit[] {
  const items = value && typeof value === "object" ? (value as { items?: unknown }).items : undefined;
  return Array.isArray(items) ? items.filter((item): item is PlatformComposioToolkit => Boolean(item && typeof item === "object")) : [];
}

function platformComposioConnectionItems(value: unknown): PlatformComposioConnection[] {
  const items = value && typeof value === "object" ? (value as { items?: unknown }).items : undefined;
  return Array.isArray(items) ? items.filter((item): item is PlatformComposioConnection => Boolean(item && typeof item === "object")) : [];
}

function platformConnectorCatalog(value: unknown): {
  cards: Record<string, unknown>[];
  services: Record<string, Service>;
} {
  const services: Record<string, Service> = {};
  const cards = platformComposioToolkitItems(value).map((toolkit) => {
    const slug = String(toolkit.slug ?? "").trim().toLowerCase();
    const status = typeof toolkit.connectionStatus === "string" ? toolkit.connectionStatus : "";
    const connectedAccountId = typeof toolkit.connectedAccountId === "string" ? toolkit.connectedAccountId : "";
    const authConfigRecord = toolkit.authConfig && typeof toolkit.authConfig === "object"
      ? toolkit.authConfig as { id?: unknown }
      : toolkit.auth_config && typeof toolkit.auth_config === "object"
        ? toolkit.auth_config as { id?: unknown }
        : null;
    const authConfigId = [
      toolkit.authConfigId,
      toolkit.auth_config_id,
      authConfigRecord?.id,
      String(toolkit.id ?? "").startsWith("ac_") ? toolkit.id : "",
    ].find((value) => typeof value === "string" && value.trim());
    const connected = toolkit.connected === true || toolkit.noAuth === true || /^active$/i.test(status);
    const activeAccount = connectedAccountId && /^active$/i.test(status || "ACTIVE")
      ? [{ id: connectedAccountId, status: status || "ACTIVE" }]
      : [];
    if (slug) {
      services[slug] = {
        connected,
        pending: /^(initiated|initializing|pending)$/i.test(status),
        status: status || (connected ? "ACTIVE" : "not_connected"),
        accounts: activeAccount,
      };
    }
    return {
      slug,
      label: String(toolkit.name ?? toolkit.slug ?? ""),
      blurb: String(toolkit.description ?? "").slice(0, 90),
      logo: typeof toolkit.logo === "string" && toolkit.logo.trim() ? toolkit.logo : null,
      authConfigId: typeof authConfigId === "string" ? authConfigId.trim() : undefined,
      domain: null,
    };
  }).filter((card) => card.slug && card.label);
  return { cards, services };
}

function platformConnectorServices(value: unknown): Record<string, Service> {
  const grouped = new Map<string, Account[]>();
  for (const account of platformComposioConnectionItems(value)) {
    const slug = String(account.slug ?? "").trim().toLowerCase();
    const id = String(account.id ?? "").trim();
    if (!slug || !id) continue;
    const status = typeof account.status === "string" && account.status.trim() ? account.status : "ACTIVE";
    if (!/^active$/i.test(status)) continue;
    grouped.set(slug, [...(grouped.get(slug) ?? []), { id, status }]);
  }
  return Object.fromEntries([...grouped.entries()].map(([slug, accounts]) => {
    const active = accounts.some((account) => /^active$/i.test(account.status));
    const pending = accounts.some((account) => /^(initiated|initializing|pending)$/i.test(account.status));
    return [slug, {
      connected: active,
      pending,
      status: active ? "ACTIVE" : pending ? "INITIATED" : accounts[0]?.status ?? "not_connected",
      accounts,
    }];
  }));
}

export async function accountConnectors(request: Request, authorization: string, call: Call): Promise<Response | null> {
 const url=new URL(request.url), path=url.pathname, method=request.method;
 const get=(path:string)=>call(path,{authorization});
 if (method==="GET" && path==="/api/connectors/catalog") {
   const catalog=await get("/api/composio/catalog?limit=500");
   return Response.json({configured:true,mode:"managed",source:"api",...platformConnectorCatalog(catalog)});
 }
 if (method==="GET" && (path==="/api/connectors/connected" || path==="/api/connectors")) {
   const connections=await get("/api/composio/connections");
   const services=platformConnectorServices(connections);
   return Response.json({configured:true,services});
 }
 const match=path.match(/^\/api\/connectors\/([\w-]+)\/authorize$/);
 if (method==="POST" && match) {
   const body=await request.json() as Record<string,unknown>;
   const authConfigId=body.authConfigId ?? body.auth_config_id;
   const result=await call("/api/composio/connect",{method,authorization,body:{toolkit:match[1],callbackUrl:url.origin,...(authConfigId?{authConfigId,auth_config_id:authConfigId}:{})}});
   const target=result?.redirectUrl ?? result?.url;
   if (typeof target!=="string" || !target) return Response.json({error:result?.message || "Composio did not return an authorization URL"},{status:409});
   return Response.json({url:target});
 }
 const account=path.match(/^\/api\/connectors\/([\w-]+)\/accounts\/([A-Za-z0-9_-]+)$/);
 if(method==="DELETE" && account) {
   await call("/api/composio/connections/"+encodeURIComponent(account[2]),{method,authorization});
   return Response.json({removed:1});
 }
 return null;
}
