export const chatCommands = [
  { name: 'create', description: 'Ask the Chief to create an agent: /create sales assistant' },
  { name: 'attach', description: 'Send files to a bot: /attach @Bot Name instructions' },
  { name: 'campaign', description: 'Save WhatsApp draft: /campaign name | audience | template' },
  { name: 'output', description: 'Get campaign results: /output @Campaign Name' },
  { name: 'summarize', description: 'Summarize this conversation or attached files' },
  { name: 'history', description: 'Open call and campaign history' },
  { name: 'help', description: 'Show available commands' },
];

export function parseChatCommand(text: string) {
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
