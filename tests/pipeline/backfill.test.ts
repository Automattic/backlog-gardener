import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseTriageProfile } from '../../src/gardener/config/index.js';
import { parseLookback, runBackfill } from '../../src/gardener/pipeline/backfill.js';
import type { FetchLike } from '../../src/gardener/sources/http.js';
import { StoreDb } from '../../src/gardener/store/index.js';

function response(body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
}

describe('backfill pipeline', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('parses lookback windows', () => {
    expect(parseLookback('30d')).toBeInstanceOf(Date);
    expect(() => parseLookback('soon')).toThrow('--since');
  });

  it('fetches open and closed GitHub issues and marks closed as reference-only', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gardener-backfill-'));
    const statePath = join(dir, 'state.db');
    const profile = parseTriageProfile({
      product: { name: 'Example Product', slug: 'example-product' },
      sources: [{ type: 'github', host: 'github.com', repo: 'example-org/example-product' }],
      llm: {
        completion: { provider: 'local', model: 'local' },
        embedding: { provider: 'local', model: 'hash-v1' },
      },
    });
    const fetchImpl: FetchLike = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/comments')) return response([]);
      const state = url.searchParams.get('state');
      return response([
        {
          number: state === 'closed' ? 2 : 1,
          html_url: `https://github.com/example-org/example-product/issues/${state === 'closed' ? 2 : 1}`,
          title: `${state} issue`,
          body: 'Body',
          user: { login: 'merchant' },
          created_at: '2026-04-20T00:00:00Z',
          updated_at: '2026-04-21T00:00:00Z',
          state,
          author_association: 'NONE',
          labels: [],
        },
      ]);
    };

    const summary = await runBackfill({ profile, statePath, fetchImpl, since: new Date('2026-01-01T00:00:00Z') });

    expect(summary.itemsFetched).toBe(2);
    expect(summary.referenceOnly).toBe(1);
    const db = new StoreDb(statePath);
    db.migrate();
    const rows = db.db.prepare('SELECT title, reference_only FROM items ORDER BY title').all() as Array<{
      title: string;
      reference_only: number;
    }>;
    expect(rows).toEqual([
      { title: 'closed issue', reference_only: 1 },
      { title: 'open issue', reference_only: 0 },
    ]);
    db.close();
  });
});
