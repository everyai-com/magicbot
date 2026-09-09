import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { prepareEmailContacts } from "../src/lib/email-campaign.ts";
const rowSchema = z.record(z.string(), z.unknown());
const rowsSchema = z.array(rowSchema);
const idOf = (row: z.infer<typeof rowSchema>) => String(row.id ?? row._id ?? "");
type Call = (path: string, options?: { method?: string; body?: unknown }) => Promise<unknown>;
const startSchema = z.object({ campaign_id: z.string().min(1), template_id: z.string().min(1), selected_contact_indexes: z.array(z.number().int().nonnegative()).min(1), delay_seconds: z.number().min(0).max(3600).default(30) });
export function emailSendResult(response: unknown): string {
  let value = rowSchema.parse(response);
  if (value.ok !== true) throw new Error(String(value.error ?? "Composio did not confirm the send."));
  for (let i = 0; i < 8; i++) {
    if (value.error || value.successful === false || value.success === false) throw new Error(String(value.error ?? "Composio Gmail send failed."));
    if (value.id || value.message_id) return String(value.id ?? value.message_id);
    const nested = rowSchema.safeParse(value.result ?? value.data ?? value.response_data);
    if (!nested.success) break;
    value = nested.data;
  }
  throw new Error("No Gmail message ID was returned. Delivery is unconfirmed; check Sent mail before retrying.");
}
export class EmailCampaigns {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS email_runs (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL)");
    this.db.exec("UPDATE email_runs SET status='interrupted' WHERE status='running'");
  }
  private save(run: z.infer<typeof rowSchema>) {
    this.db.prepare("INSERT OR REPLACE INTO email_runs VALUES (?,?,?,?)").run(String(run.id), String(run.source_campaign_id), String(run.status), JSON.stringify(run));
  }
  async handle(path: string, method: string, body: unknown, call: Call): Promise<unknown> {
    if (path.endsWith("/accounts")) {
      const result = z.object({ items: rowsSchema }).parse(await call("/api/composio/connections"));
      return result.items.filter((row) => String(row.slug).toLowerCase() === "gmail" && /^active$/i.test(String(row.status))).map((row) => ({ id: idOf(row), provider: "gmail", is_active: true }));
    }
    // The upstream list is authenticated; never accept a client-supplied owner or campaign ID without checking membership.
    const campaigns = rowsSchema.parse(await call("/api/messaging/gmail-campaigns"));
    if (method === "GET") {
      const allowed = new Set(campaigns.map(idOf));
      const local = this.db.prepare("SELECT * FROM email_runs ORDER BY rowid DESC").all().filter((row) => allowed.has(String(row.campaign_id))).map((row) => {
        const run = rowSchema.parse(JSON.parse(String(row.data)));
        if (row.status === "interrupted") return { ...run, status: "interrupted", outcomes: [...rowsSchema.parse(run.outcomes), { status: "unknown", error: "Server restarted during this run. Check Sent mail before starting again." }] };
        return run;
      });
      const previous = rowsSchema.parse(await call("/api/messaging/gmail-campaigns/completed"));
      return [...local, ...previous.filter((run) => allowed.has(String(run.source_campaign_id)))];
    }
    const input = startSchema.parse(body);
    const campaign = campaigns.find((row) => idOf(row) === input.campaign_id);
    if (!campaign) throw new Error("Campaign not found in your account.");
    const templates = rowsSchema.parse(await call("/api/messaging/gmail-templates"));
    const template = templates.find((row) => idOf(row) === input.template_id);
    if (!template) throw new Error("Template not found in your account.");
    const contacts = prepareEmailContacts(rowsSchema.parse(campaign.extracted_contacts), input.selected_contact_indexes, String(template.message));
    const accounts = await this.handle("/accounts", "GET", null, call) as Array<{ id: string }>;
    if (!accounts.length) throw new Error("Connect Gmail in Integrations before sending.");
    if (this.db.prepare("SELECT id FROM email_runs WHERE campaign_id=? AND status='running'").get(input.campaign_id)) throw new Error("This campaign is already sending.");
    const config = z.object({ subject: z.string(), body: z.string() }).parse(JSON.parse(String(template.message)));
    const run = { id: crypto.randomUUID(), source_campaign_id: input.campaign_id, status: "running", created_at: new Date().toISOString(), outcomes: [] as z.infer<typeof rowSchema>[] };
    this.save(run);
    const render = (text: string, contact: z.infer<typeof rowSchema>) => text.replace(/<<\s*([^<>]+?)\s*>>/g, (_, key: string) => String(contact[key.trim()] ?? ""));
    const send = async () => {
      for (const index of [...new Set(input.selected_contact_indexes)].sort((a,b) => a-b)) {
        const contact = contacts[index];
        const outcome = { contact_index: index, email: contact.email, name: contact.name, created_at: new Date().toISOString() };
        try {
          const result = await call("/api/composio/execute", { method: "POST", body: { tool: "GMAIL_SEND_EMAIL", arguments: { user_id: "me", recipient_email: contact.email, subject: render(config.subject, contact), body: render(config.body, contact), is_html: false } } });
          run.outcomes.push({ ...outcome, status: "sent", provider_message_id: emailSendResult(result) });
        } catch (error) {
          run.outcomes.push({ ...outcome, status: "failed", error: error instanceof Error ? error.message : String(error) });
        }
        this.save(run);
        if (run.outcomes.length < new Set(input.selected_contact_indexes).size && input.delay_seconds) await new Promise((resolve) => setTimeout(resolve, input.delay_seconds * 1000));
      }
      run.status = "completed"; this.save(run);
    };
    void send().catch((error) => { run.status = "failed"; run.outcomes.push({ status: "unknown", error: String(error) }); this.save(run); });
    return { id: run.id, status: run.status };
  }
}
