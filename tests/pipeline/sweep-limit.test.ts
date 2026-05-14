import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseTriageProfile } from '../../src/gardener/config/index.js';
import { runSweep } from '../../src/gardener/pipeline/orchestrator.js';
import type { FetchLike } from '../../src/gardener/sources/http.js';

function response(body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
}

describe('sweep item limit', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('stops after maxItems for test sweeps', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gardener-limit-'));
    const profile = parseTriageProfile({
      product: { name: 'Example Product', slug: 'example-product' },
      sources: [{ type: 'github', host: 'github.com', repo: 'example-org/example-product' }],
      llm: {
        completion: { provider: 'local', model: 'local' },
        embedding: { provider: 'local', model: 'hash-v1' },
      },
      publishers: {
        reviewLane: [{ name: 'local-markdown', outputDir: join(dir, 'out/{runId}') }],
        applyLane: [],
      },
    });
    const fetchImpl: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes('/comments')) return response([]);
      return response(
        [1, 2, 3].map((number) => ({
          number,
          html_url: `https://github.com/example-org/example-product/issues/${number}`,
          title: `Issue ${number}`,
          body: 'Body',
          user: { login: 'merchant' },
          created_at: '2026-04-20T00:00:00Z',
          updated_at: `2026-04-2${number}T00:00:00Z`,
          state: 'open',
          author_association: 'NONE',
          labels: [],
        })),
      );
    };

    const summary = await runSweep({
      profile,
      statePath: join(dir, 'state.db'),
      lane: 'warm',
      fetchImpl,
      maxItems: 1,
    });

    expect(summary.itemsFetched).toBe(1);
    expect(summary.findings).toBe(1);
  });
});
