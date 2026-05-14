import { describe, expect, it } from 'vitest';

import { bodyHash } from '../../src/gardener/normalize/hashes.js';
import { embedMissingItems, topKSimilar } from '../../src/gardener/pipeline/embed.js';
import { generateCandidatePairs, persistHeuristicEdges } from '../../src/gardener/pipeline/dedup.js';
import { RepositoryBundle, StoreDb } from '../../src/gardener/store/index.js';
import type { EmbeddingProvider } from '../../src/gardener/llm/openai.js';

function setup() {
  const db = new StoreDb(':memory:');
  db.migrate();
  const repos = new RepositoryBundle(db.db);
  const a = repos.items.upsert({
    sourceKey: 'github:x/y',
    sourceType: 'github',
    sourceId: 'x/y#1',
    url: 'https://github.com/x/y/issues/1',
    title: 'Apple Pay vanishes',
    body: 'Apple Pay disappears after cart update.',
    author: 'a',
    createdAt: '2026-04-20T00:00:00Z',
    updatedAt: '2026-04-20T00:00:00Z',
    bodyHash: bodyHash('Apple Pay disappears after cart update.'),
    latestSnapshotHash: null,
    referenceOnly: false,
    metadata: {},
    raw: {},
  });
  const { id: _aId, ...base } = a;
  const b = repos.items.upsert({
    ...base,
    sourceId: 'x/y#2',
    title: 'Apple Pay vanishes',
    url: 'https://github.com/x/y/issues/2',
    bodyHash: `${base.bodyHash}-2`,
  });
  const c = repos.items.upsert({
    ...base,
    sourceId: 'x/y#3',
    title: 'Unrelated refund issue',
    url: 'https://github.com/x/y/issues/3',
    body: 'Refund issue',
    bodyHash: bodyHash('Refund issue'),
  });
  return { db, items: [a, b, c] };
}

const provider: EmbeddingProvider = {
  name: 'fake',
  model: 'embedding',
  async embed(texts) {
    return {
      vectors: texts.map((text) => (text.includes('refund') ? [0, 1] : [1, 0])),
      usage: { tokens: texts.length },
    };
  },
};

describe('embedding and dedup pipeline', () => {
  it('embeds missing items and finds top-K similar neighbors', async () => {
    const { db, items } = setup();
    await expect(embedMissingItems({ db: db.db, items, provider })).resolves.toEqual({ embedded: 3, tokens: 3 });
    await expect(embedMissingItems({ db: db.db, items, provider })).resolves.toEqual({ embedded: 0, tokens: 0 });

    expect(
      topKSimilar({ db: db.db, item: items[0]!, provider: 'fake', model: 'embedding', k: 2, minScore: 0.5 }),
    ).toEqual([{ itemId: items[1]!.id, score: 1 }]);
    db.close();
  });

  it('generates fingerprint and embedding candidate pairs and persists edges', async () => {
    const { db, items } = setup();
    await embedMissingItems({ db: db.db, items, provider });
    const pairs = generateCandidatePairs({
      db: db.db,
      items,
      provider: 'fake',
      model: 'embedding',
      topK: 2,
      minScore: 0.5,
    });

    expect(pairs.some((pair) => pair.reason === 'same-title-fingerprint')).toBe(true);
    expect(persistHeuristicEdges({ db: db.db, pairs, reviewPolicyHash: 'policy' })).toBeGreaterThan(0);
    const rows = db.db.prepare('SELECT verdict FROM edges').all() as Array<{ verdict: string }>;
    expect(rows.map((row) => row.verdict)).toContain('duplicate');
    db.close();
  });
});
