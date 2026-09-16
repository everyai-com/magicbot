import { describe, expect, it } from 'vitest';
import { attachmentTarget, campaignDraft, parseChatCommand, resolveAttachmentTarget } from './chat-commands';

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

describe('resolveAttachmentTarget', () => {
  const bots = [{ id: '1', name: 'Sales' }, { id: '2', name: 'FXBC 1 demo' }];

  it('resolves the leading command form', () => {
    expect(resolveAttachmentTarget('/attach @Sales read this', bots)).toEqual({
      bot: bots[0],
      instructions: 'read this',
      explicit: true,
    });
  });

  it('resolves /attach written after a tagged bot in prose', () => {
    const text = '@FXBC 1 demo now /attach this file to the knowledge base for this bot';
    expect(resolveAttachmentTarget(text, bots)).toEqual({
      bot: bots[1],
      instructions: '',
      explicit: false,
    });
  });

  it('resolves a tagged request that only describes the action', () => {
    const text = '@FXBC 1 demo now add this file to the knowledge base for this bot';
    expect(resolveAttachmentTarget(text, bots)).toEqual({
      bot: bots[1],
      instructions: '',
      explicit: false,
    });
  });

  it('leaves described prose alone when no bot can be resolved', () => {
    expect(resolveAttachmentTarget('put this in the knowledge base', [])).toBeNull();
  });

  it('falls back to the current bot when no tag is present', () => {
    expect(resolveAttachmentTarget('please /attach this file', bots, bots[1])).toEqual({
      bot: bots[1],
      instructions: '',
      explicit: false,
    });
    expect(() => resolveAttachmentTarget('please /attach this file', bots)).toThrow(/Choose a bot/);
  });

  it('ignores messages that are not attach requests', () => {
    expect(resolveAttachmentTarget('summarize this', bots)).toBeNull();
    expect(resolveAttachmentTarget('/help', bots)).toBeNull();
    expect(resolveAttachmentTarget('/create a sales assistant', bots)).toBeNull();
    expect(resolveAttachmentTarget('$Summer Sale', bots)).toBeNull();
  });
});
