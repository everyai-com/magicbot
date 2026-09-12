import { describe, expect, it } from 'vitest';
import { attachmentTarget, campaignDraft, parseChatCommand } from './chat-commands';

describe('chat commands', () => {
  it('recognizes leading commands without treating normal messages as commands', () => {
    expect(parseChatCommand(' /create Sales\nHandles enquiries')).toEqual({ name: 'create', args: 'Sales\nHandles enquiries' });
    expect(parseChatCommand('Explain /create')).toBeNull();
    expect(parseChatCommand('/help')).toEqual({ name: 'help', args: '' });
  });
  it('routes multiword bot names and refuses ambiguous or partial matches', () => {
    const bots = [{ id: '1', name: 'Sales' }, { id: '2', name: 'Sales Assistant' }];
    expect(attachmentTarget('@Sales Assistant read this', bots)).toEqual({ bot: bots[1], instructions: 'read this' });
    expect(() => attachmentTarget('@Salesman', bots)).toThrow();
    expect(() => attachmentTarget('@Sales', [...bots, { id: '3', name: 'Sales' }])).toThrow(/More than one/);
  });
  it('uses owned IDs, requires approved templates and only creates drafts', () => {
    const audiences = [{ id: 'a1', name: 'Buyers' }];
    const templates = [{ _id: 't1', name: 'Welcome', meta_status: 'APPROVED', language: 'en_US' }];
    expect(campaignDraft('Launch | Buyers | Welcome', audiences, templates)).toMatchObject({ name: 'Launch', audience_id: 'a1', template_id: 't1', status: 'draft' });
    expect(() => campaignDraft('Launch', audiences, templates)).toThrow();
    expect(() => campaignDraft('Launch | Buyers | Welcome', audiences, [{ ...templates[0], meta_status: 'PENDING' }])).toThrow();
    expect(() => campaignDraft('Launch | Buyers | Welcome', [...audiences, ...audiences], templates)).toThrow();
  });
});

it('treats a leading dollar mention as an output shortcut', () => {
  expect(parseChatCommand('$')).toEqual({ name: 'output', args: '$' });
  expect(parseChatCommand('$Summer Sale')).toEqual({ name: 'output', args: '$Summer Sale' });
  expect(parseChatCommand('/output $Summer Sale')).toEqual({ name: 'output', args: '$Summer Sale' });
  expect(parseChatCommand('Price is $20')).toBeNull();
});
