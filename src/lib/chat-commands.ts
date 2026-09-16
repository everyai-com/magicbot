export const chatCommands = [
  { name: 'create', description: 'Ask the Chief to create an agent: /create sales assistant' },
  { name: 'attach', description: "Add files to a bot's knowledge base: /attach @Bot Name notes" },
  { name: 'campaign', description: 'Save WhatsApp draft: /campaign name | audience | template' },
  { name: 'output', description: 'Get campaign results: /output $Campaign Name' },
  { name: 'summarize', description: 'Summarize this conversation or attached files' },
  { name: 'history', description: 'Open call and campaign history' },
  { name: 'help', description: 'Show available commands' },
];

export function parseChatCommand(text: string) {
  if (text.trimStart().startsWith("$")) return { name: "output", args: text.trim() };
  const match = text.trimStart().match(/^\/(\w+)(?:\s+([\s\S]*))?$/);
  return match ? { name: match[1].toLowerCase(), args: (match[2] ?? '').trim() } : null;
}

export function attachmentTarget<T extends { id: string; name: string }>(args: string, bots: T[]): { bot: T; instructions: string } {
  const matches = bots.filter(bot => args.toLowerCase().startsWith(`@${bot.name.toLowerCase()}`) && (!args[bot.name.length + 1] || /\s/.test(args[bot.name.length + 1])));
  const longest = matches.sort((a,b) => b.name.length - a.name.length)[0];
  if (!longest) throw new Error('Choose a bot with /attach @Bot Name, then attach a file.');
  if (matches.filter(bot => bot.name.toLowerCase() === longest.name.toLowerCase()).length > 1) throw new Error('More than one bot has that name. Rename the target bot to a unique name first.');
  return { bot: longest, instructions: args.slice(longest.name.length + 1).trim() };
}

export interface AttachmentRequest<T> {
  bot: T;
  /** what to title the entry with; empty for a tagged request */
  instructions: string;
  /** true when the message led with /attach — the documented command form */
  explicit: boolean;
}

/** Resolve a knowledge-base attach request from a composer message. People
 * write it three ways and each is unambiguous once a file chip is attached:
 *   "/attach @Bot notes"                 — the command form
 *   "@Bot … /attach this file …"         — a tagged message carrying the word
 *   "@Bot … add this to the knowledge base" — plain description of the action
 * Returns null when the message is not an attach request. Throws a
 * user-facing reason when /attach was typed but the target bot is unclear. */
export function resolveAttachmentTarget<T extends { id: string; name: string }>(
  text: string,
  bots: T[],
  fallback?: T,
): AttachmentRequest<T> | null {
  const command = parseChatCommand(text);
  if (command?.name === "attach") {
    return { ...attachmentTarget(command.args, bots), explicit: true };
  }
  if (command) return null;
  const invoked = /(?:^|\s)\/attach(?:\s|$)/.test(text);
  const described = /\bknowledge\s*base\b/i.test(text);
  if (!invoked && !described) return null;

  // A leading tag names the bot the file should land on; otherwise fall back
  // to the thread the user is already typing in (a 1:1 bot chat).
  const target = taggedBot(text, bots) ?? fallback;
  if (target) return { bot: target, instructions: "", explicit: false };
  // Typed as a command but we can't tell which bot: say so. Described in
  // prose: leave it alone rather than blocking the message.
  if (invoked) throw new Error("Choose a bot for /attach, for example: /attach @Bot Name notes");
  return null;
}

/** The bot a leading `@Name` tag points at, or null if there isn't one we
 * can resolve. Never throws — callers fall back to the current thread. */
function taggedBot<T extends { id: string; name: string }>(text: string, bots: T[]): T | null {
  if (!text.trimStart().startsWith("@")) return null;
  try {
    return attachmentTarget(text, bots).bot;
  } catch {
    return null;
  }
}

export function campaignDraft(args: string, audiences: Record<string, unknown>[], templates: Record<string, unknown>[]) {
  const parts = args.split('|').map(part => part.trim());
  if (parts.length !== 3 || parts.some(part => !part)) throw new Error('Use /campaign Campaign name | Audience name | Template name');
  const find = (rows: Record<string, unknown>[], name: string) => {
    const matches = rows.filter(row => [row.id, row._id, row.name, row.normalized_name].some(value => typeof value === 'string' && value.toLowerCase() === name.toLowerCase()));
    if (matches.length !== 1) throw new Error(`Choose a unique existing audience or approved template: ${name}`);
    return matches[0];
  };
  const audience = find(audiences, parts[1]);
  const template = find(templates.filter(row => String(row.meta_status ?? row.status).toLowerCase() === 'approved'), parts[2]);
  if (!(audience.id ?? audience._id) || !(template.id ?? template._id)) throw new Error('The selected audience or template has no ID.');
  return { name: parts[0], audience_id: audience.id ?? audience._id, template_id: template.id ?? template._id, template_name: template.normalized_name ?? template.name, template_language: template.language, status: 'draft' };
}
