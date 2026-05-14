import { describe, expect, it } from 'vitest';

import { bodyHash } from '../../src/gardener/normalize/hashes.js';
import { buildDuplicateClusters } from '../../src/gardener/pipeline/cluster.js';
import { persistHeuristicEdges } from '../../src/gardener/pipeline/dedup.js';
import { RepositoryBundle, StoreDb } from '../../src/gardener/store/index.js';

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
  const { id: _id, ...base } = a;
  const b = repos.items.upsert({
    ...base,
    sourceId: 'x/y#2',
    url: 'https://github.com/x/y/issues/2',
    updatedAt: '2026-04-22T00:00:00Z',
    bodyHash: `${base.bodyHash}-2`,
  });
  const c = repos.items.upsert({
    ...base,
    sourceId: 'x/y#3',
    title: 'Refund issue',
    url: 'https://github.com/x/y/issues/3',
    body: 'Refund failed.',
    bodyHash: bodyHash('Refund failed.'),
  });
  return { db, items: [a, b, c] };
}

describe('cluster builder', () => {
  it('builds connected components from duplicate edges', () => {
    const { db, items } = setup();
    persistHeuristicEdges({
      db: db.db,
      pairs: [{ itemAId: items[0]!.id, itemBId: items[1]!.id, score: 1, reason: 'test' }],
      reviewPolicyHash: 'policy',
    });

    const clusters = buildDuplicateClusters({ db: db.db, items, reviewPolicyHash: 'policy' });

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.itemIds).toEqual([items[0]!.id, items[1]!.id].sort());
    expect(clusters[0]?.theme).toBe('Apple Pay vanishes');
    const rows = db.db.prepare('SELECT item_id FROM cluster_items WHERE cluster_id = ?').all(clusters[0]!.clusterId);
    expect(rows).toHaveLength(2);
    db.close();
  });

  it('is idempotent for the same connected component', () => {
    const { db, items } = setup();
    persistHeuristicEdges({
      db: db.db,
      pairs: [{ itemAId: items[0]!.id, itemBId: items[1]!.id, score: 1, reason: 'test' }],
      reviewPolicyHash: 'policy',
    });

    const first = buildDuplicateClusters({ db: db.db, items, reviewPolicyHash: 'policy' });
    const second = buildDuplicateClusters({ db: db.db, items, reviewPolicyHash: 'policy' });

    expect(second[0]?.clusterId).toBe(first[0]?.clusterId);
    db.close();
  });
});
