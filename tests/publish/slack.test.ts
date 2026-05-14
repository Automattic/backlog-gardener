import { describe, expect, it } from 'vitest';

import type { Finding } from '../../src/gardener/domain.js';
import { publishSlackSummary } from '../../src/gardener/publish/slack.js';

const finding = {
  recap: { summary: 'Apple Pay disappears' },
} as Finding;

describe('Slack publisher', () => {
  it('posts concise run completion payloads', async () => {
    let payload: unknown;
    await publishSlackSummary({
      webhookUrl: 'https://hooks.slack.test/T000/B000/xxx',
      productName: 'Example Product',
      runId: 'run_123',
      surfaced: 1,
      deferred: 2,
      digestPath: 'out/digest.md',
      topFindings: [finding],
      fetchImpl: async (_url, init) => {
        const parsedPayload: unknown = JSON.parse(String(init?.body));
        payload = parsedPayload;
        return new Response('ok', { status: 200 });
      },
    });

    expect(payload).toEqual({
      text: expect.stringContaining('Backlog Gardener finished: Example Product'),
    });
    expect((payload as { text: string }).text).toContain('Apple Pay disappears');
  });
});
