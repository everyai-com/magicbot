import { expect, it, vi, beforeEach } from 'vitest';

const apiMock = vi.fn();

vi.mock('@/state/store', () => ({
  api: (...args: unknown[]) => (apiMock as (...a: unknown[]) => unknown)(...args),
}));

import { executeStartPlan, type StartPlan } from './campaign-schedules';

const base: StartPlan = {
  channel: 'voice',
  campaignId: 'camp1',
  campaignName: 'Test Campaign',
  agent: 'agent1',
  phone: 'phone1',
  template: 'tpl1',
  templateMessage: '',
  audience: 'aud1',
  delay: 30,
  locking: true,
  contactIds: ['c1', 'c2'],
  selectedIndexes: [0, 2],
  snapshotRows: [{ id: 'c1' }, { id: 'c2' }],
  preparedRows: null,
};

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: unknown) =>
    Promise.resolve(String(path).endsWith("gmail-campaigns/accounts") ? [{ id: "acct1" }] : {}),
  );
});

it('voice start patches config then starts with contact ids', async () => {
  await executeStartPlan(base);
  expect(apiMock).toHaveBeenCalledTimes(2);
  const [patchPath, patchInit] = apiMock.mock.calls[0] as [string, { body?: string }];
  const [startPath, startInit] = apiMock.mock.calls[1] as [string, { body?: string }];
  expect(patchPath).toBe('/api/campaign-workspace/campaigns/camp1');
  expect(JSON.parse(patchInit.body ?? '{}')).toEqual({
    agent_id: 'agent1', phone_config_id: 'phone1', delay_seconds: 30, enable_number_locking: true,
  });
  expect(startPath).toBe('/api/campaign-workspace/campaigns/camp1/start');
  expect(JSON.parse(startInit.body ?? '{}')).toEqual({ contact_ids: ['c1', 'c2'] });
});

it('voice start refuses blank contact ids instead of dialing nobody', async () => {
  // Blank ids are rejected at plan build time in the UI; the executor also
  // guards so a hand-made plan can never silently start an empty campaign.
  await expect(executeStartPlan({ ...base, contactIds: [] })).rejects.toThrow(/agent, caller number or contacts/);
  expect(apiMock).not.toHaveBeenCalled();
});

it('whatsapp start patches audience/template then starts', async () => {
  await executeStartPlan({ ...base, channel: 'whatsapp' });
  expect(apiMock).toHaveBeenCalledTimes(2);
  const [patchPath, patchInit] = apiMock.mock.calls[0] as [string, { body?: string }];
  expect(patchPath).toBe('/api/campaign-workspace/whatsapp/campaigns/camp1');
  expect(JSON.parse(patchInit.body ?? '{}')).toEqual({ audience_id: 'aud1', template_id: 'tpl1' });
  const [startPath] = apiMock.mock.calls[1] as [string, { body?: string }];
  expect(startPath).toBe('/api/campaign-workspace/whatsapp/campaigns/camp1/start');
});

it('gmail start patches prepared rows then starts with original indexes', async () => {
  const prepared = [{ email: 'a@x.com' }, { email: 'b@x.com' }];
  await executeStartPlan({ ...base, channel: 'gmail', preparedRows: prepared, selectedIndexes: [0, 1] });
  const [, patchInit] = apiMock.mock.calls[1] as [string, { body?: string }];
  expect(JSON.parse(patchInit.body ?? '{}')).toMatchObject({ template_id: 'tpl1' });
  const [startPath, startInit] = apiMock.mock.calls[2] as [string, { body?: string }];
  expect(startPath).toBe('/api/campaign-workspace/messaging/gmail-campaigns/start');
  expect(JSON.parse(startInit.body ?? '{}')).toMatchObject({ selected_contact_indexes: [0, 1] });
});

it('gmail start refuses without a connected account', async () => {
  apiMock.mockImplementationOnce(() => Promise.resolve([]));
  await expect(executeStartPlan({ ...base, channel: 'gmail', preparedRows: [{ email: 'a@x.com' }] }))
    .rejects.toThrow(/Gmail account/);
});

it('sms start patches snapshot rows then starts with positional indexes', async () => {
  await executeStartPlan({ ...base, channel: 'sms' });
  const [, patchInit] = apiMock.mock.calls[0] as [string, { body?: string }];
  expect(JSON.parse(patchInit.body ?? '{}')).toMatchObject({
    extracted_contacts: [{ id: 'c1' }, { id: 'c2' }],
    template_id: 'tpl1',
  });
  const [startPath, startInit] = apiMock.mock.calls[1] as [string, { body?: string }];
  expect(startPath).toBe('/api/campaign-workspace/messaging/sms-campaigns/camp1/start');
  expect(JSON.parse(startInit.body ?? '{}')).toMatchObject({
    campaign_id: 'camp1',
    template_id: 'tpl1',
    phone_config_id: 'phone1',
    selected_contact_indexes: [0, 1],
  });
});

it('returns the platform acceptance summary', async () => {
  apiMock.mockResolvedValue({ total: 1, scheduled: 1, batch_size: 1 });
  const summary = await executeStartPlan(base);
  expect(summary).toContain('total=1');
  expect(summary).toContain('scheduled=1');
});
