import { describe, expect, it } from 'vitest';

import { fetchJson, HttpError } from '../../src/gardener/sources/http.js';

describe('source HTTP helpers', () => {
  it('retries transient errors', async () => {
    let calls = 0;
    const result = await fetchJson<{ ok: true }>(
      async () => {
        calls += 1;
        return calls === 1
          ? new Response('busy', { status: 503 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      'https://api.test/resource',
      undefined,
      { retries: 1, retryDelayMs: 0 },
    );

    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('does not retry non-transient errors', async () => {
    let calls = 0;
    await expect(
      fetchJson(
        async () => {
          calls += 1;
          return new Response('missing', { status: 404 });
        },
        'https://api.test/missing',
        undefined,
        { retries: 3, retryDelayMs: 0 },
      ),
    ).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(1);
  });
});
