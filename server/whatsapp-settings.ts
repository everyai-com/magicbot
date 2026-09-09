type Call = (path: string, options: { method?: string; authorization?: string; body?: unknown }) => Promise<any>;
export async function whatsappSettings(method: string, path: string, body: Record<string, unknown>, authorization: string | undefined, call: Call): Promise<{ status: number; body: unknown } | null> {
  if (!/^\/api\/whatsapp\/configs(?:\/(api|auto-reply|webhook|validate))?$/.test(path) || !["GET", "POST"].includes(method)) return null;
  if (!authorization) return { status: 401, body: { error: "Sign in again to connect your MagicTeams account." } };
  const read = (kind: string) => call("/api/whatsapp/configs/" + kind, { authorization });
  const apiView = (row: any) => ({
    configured: Boolean(row?.meta_access_token && row?.meta_phone_number_id && row?.meta_business_account_id),
    access_token: row?.meta_access_token ?? "",
    phone_number_id: row?.meta_phone_number_id ?? "",
    business_account_id: row?.meta_business_account_id ?? "",
    app_id: row?.meta_app_id ?? "",
    display_phone_number: row?.display_phone_number ?? "",
    verified_name: row?.verified_name ?? "",
  });
  if (method === "GET") {
    if (path.endsWith("/api")) return {status:200,body:apiView(await read("api"))};
    if (path.endsWith("/auto-reply")) return {status:200,body:await read("auto-reply") ?? {}};
    if (path.endsWith("/webhook")) return {status:200,body:await read("webhook") ?? {}};
    const [api, autoReply, webhook] = await Promise.all([read("api"),read("auto-reply"),read("webhook")]);
    return {status:200,body:{api:apiView(api),autoReply:autoReply ?? {},webhook:webhook ?? {}}};
  }
  if (path.endsWith("/validate")) {
    const result = await call(path, {method,authorization,body});
    return {status:result?.valid === true ? 200 : 400,body:result};
  }
  if (path.endsWith("/api")) {
    // An empty replacement field must not erase the saved token.
    const previous = await read("api");
    const payload = Object.fromEntries(["meta_access_token","meta_phone_number_id","meta_business_account_id","meta_app_id","display_phone_number","verified_name"].map(key => [key, body[key] ?? previous?.[key] ?? ""]));
    if (!payload.meta_access_token) payload.meta_access_token = previous?.meta_access_token ?? "";
    await call(path,{method,authorization,body:payload});
    const [api,webhook] = await Promise.all([read("api"),read("webhook")]);
    return {status:200,body:{api:apiView(api),webhook:webhook ?? {}}};
  }
  if (path.endsWith("/auto-reply")) {
    await call(path,{method,authorization,body:{is_enabled:body.is_enabled === true,webhook_url:body.webhook_url ?? ""}});
    return {status:200,body:{autoReply:await read("auto-reply") ?? {}}};
  }
  return {status:405,body:{error:"Unsupported WhatsApp settings action"}};
}
