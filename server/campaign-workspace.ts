// Explicit allowlist: never turn the local server into an arbitrary remote proxy.
export function campaignWorkspaceRoute(method: string, path: string): string | null {
  const id = "[A-Za-z0-9_-]+";
  const rules: Record<string, RegExp[]> = {
    GET: [
      /^campaign-configs\/phone-configs$/, /^agents$/, /^phone-configs$/, /^campaigns$/,
      new RegExp(`^campaigns/${id}$`),
      new RegExp(`^(contacts|call-outcomes)/by-campaign/${id}$`),
      /^messaging\/(sms|gmail)-(campaigns|templates)$/,
      /^messaging\/gmail-campaigns\/accounts$/,
      new RegExp(`^messaging/(sms|gmail)-campaigns/completed(?:/${id})?$`),
      /^whatsapp\/(campaigns|audiences|templates|contacts)$/, new RegExp(`^whatsapp/audiences/${id}/contacts$`),
      new RegExp(`^whatsapp/campaigns/${id}$`),
    ],
    POST: [/^whatsapp\/templates\/(create|edit|sync|delete|upload-image)$/, /^campaigns$/, /^contacts\/bulk$/, /^messaging\/(sms|gmail)-(campaigns|templates)$/,
      new RegExp(`^campaigns/${id}/(start|resume)$`),
      new RegExp(`^messaging/sms-campaigns/${id}/start$`), /^messaging\/gmail-campaigns\/start$/,
      /^whatsapp\/(campaigns|audiences|contacts\/bulk)$/, new RegExp(`^whatsapp/campaigns/${id}/start$`)],
    DELETE: [new RegExp(`^campaigns/${id}$`), new RegExp(`^contacts/${id}$`),
      new RegExp(`^messaging/sms-campaigns/${id}$`), new RegExp(`^messaging/gmail-templates/${id}$`)],
    PUT: [/^campaign-configs\/phone-configs$/],
    PATCH: [new RegExp(`^contacts/${id}$`), new RegExp(`^campaigns/${id}$`), new RegExp(`^messaging/(sms|gmail)-campaigns/${id}$`),
      new RegExp(`^whatsapp/campaigns/${id}$`)],
  };
  return rules[method]?.some((rule) => rule.test(path)) ? `/api/${path}` : null;
}
