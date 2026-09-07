// Explicit allowlist: never turn the local server into an arbitrary remote proxy.
export function campaignWorkspaceRoute(method: string, path: string): string | null {
  const id = "[A-Za-z0-9_-]+";
  const rules: Record<string, RegExp[]> = {
    GET: [
      /^agents$/, /^phone-configs$/, /^campaigns$/,
      new RegExp(`^campaigns/${id}$`),
      new RegExp(`^(contacts|call-outcomes)/by-campaign/${id}$`),
      /^messaging\/(sms|gmail)-(campaigns|templates)$/,
      new RegExp(`^messaging/(sms|gmail)-campaigns/completed(?:/${id})?$`),
      /^whatsapp\/(campaigns|audiences|templates)$/,
      new RegExp(`^whatsapp/campaigns/${id}$`),
    ],
    POST: [/^campaigns$/, /^contacts\/bulk$/, /^messaging\/(sms|gmail)-(campaigns|templates)$/,
      new RegExp(`^campaigns/${id}/(start|resume)$`),
      new RegExp(`^messaging/sms-campaigns/${id}/start$`), /^messaging\/gmail-campaigns\/start$/,
      /^whatsapp\/(campaigns|audiences|contacts\/bulk)$/, new RegExp(`^whatsapp/campaigns/${id}/start$`)],
    PATCH: [new RegExp(`^campaigns/${id}$`), new RegExp(`^messaging/(sms|gmail)-campaigns/${id}$`),
      new RegExp(`^whatsapp/campaigns/${id}$`)],
  };
  return rules[method]?.some((rule) => rule.test(path)) ? `/api/${path}` : null;
}
