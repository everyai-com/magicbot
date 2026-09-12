import { expect, it } from 'vitest';
import { findOutputCampaign, outputCampaigns, readCampaignOutput } from './campaign-output';
it('matches complete campaign names and disambiguates by channel and ID', () => {
  const rows = [...outputCampaigns([{ id: '1', name: 'Summer Sale' }], 'WhatsApp'), ...outputCampaigns([{ id: '2', name: 'Summer Sale' }], 'Email')];
  expect(() => findOutputCampaign('@Summer Sale', rows)).toThrow(/Several/);
  expect(findOutputCampaign('@WhatsApp:1', rows)).toEqual(rows[0]);
  expect(findOutputCampaign('@summer sale', rows.slice(0, 1))).toEqual(rows[0]);
  expect(() => findOutputCampaign('Summer Sale', rows)).toThrow();
  expect(() => findOutputCampaign('@Summer', rows)).toThrow(/not found/);
});
it('retrieves only the selected campaign output for each channel', async () => {
  const base = { id: '1', name: 'Sale', status: 'completed' };
  expect(await readCampaignOutput({ ...base, channel: 'Email' }, async path => {
    expect(path).toBe('messaging/gmail-campaigns/completed');
    return [{ source_campaign_id: '2', outcomes: [{ secret: 'other campaign' }] }, { source_campaign_id: '1', outcomes: [{ status: 'sent' }] }];
  })).toEqual([{ status: 'sent' }]);
  expect(await readCampaignOutput({ ...base, channel: 'WhatsApp' }, async path => {
    expect(path).toBe('whatsapp/campaigns/1');
    return { outcomes: [] };
  })).toEqual([]);
  expect(await readCampaignOutput({ ...base, channel: 'Voice' }, async path => {
    expect(path).toBe('call-outcomes/by-campaign/1');
    return [{ Result: 'Answered' }];
  })).toEqual([{ Result: 'Answered' }]);
  await expect(readCampaignOutput({ ...base, channel: 'SMS' }, async () => ({}))).rejects.toThrow();
});

it('accepts dollar campaign mentions while preserving existing at mentions', () => {
  const campaigns = outputCampaigns([{ id: '1', name: 'Summer Sale' }], 'WhatsApp');
  expect(findOutputCampaign('$Summer Sale', campaigns)).toEqual(campaigns[0]);
  expect(findOutputCampaign('@Summer Sale', campaigns)).toEqual(campaigns[0]);
});
