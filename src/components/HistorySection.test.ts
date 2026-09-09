import { expect, it } from 'vitest';
import { historyRows } from './HistorySection';
it('flattens saved outcomes and excludes unfinished WhatsApp campaigns', () => {
  const outcome = { recipient_email: 'test@example.com', rendered_body: 'Hello', status: 'sent' };
  expect(historyRows([{ name: 'Email', outcomes: [outcome] }], 'Email')[0]).toMatchObject({ Recipient: 'test@example.com', Message: 'Hello', Result: 'sent' });
  expect(historyRows([{ status: 'draft', outcomes: [outcome] }, { status: 'completed', outcomes: [outcome] }], 'WhatsApp')).toHaveLength(1);
});
