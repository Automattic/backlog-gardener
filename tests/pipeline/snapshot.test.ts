import { describe, expect, it } from 'vitest';

import { bodyHash } from '../../src/gardener/normalize/hashes.js';
import { persistSnapshot } from '../../src/gardener/pipeline/snapshot.js';
import { StoreDb, RepositoryBundle } from '../../src/gardener/store/index.js';

describe('snapshot persistence', () => {
  it('creates stable snapshots from item and reply hashes', () => {
    const db = new StoreDb(':memory:');
    db.migrate();
    const repos = new RepositoryBundle(db.db);
    const item = repos.items.upsert({
      sourceKey: 'github:x/y',
      sourceType: 'github',
      sourceId: 'x/y#1',
      url: 'https://github.com/x/y/issues/1',
      title: 'Issue',
      body: 'Body',
      author: 'merchant',
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-21T00:00:00.000Z',
      bodyHash: bodyHash('Body'),
      latestSnapshotHash: null,
      referenceOnly: false,
      metadata: {},
      raw: {},
    });
    const reply = repos.replies.upsert({
      itemId: item.id,
      sourceReplyId: '1',
      author: 'support',
      body: 'Reply',
      createdAt: '2026-04-21T00:00:00.000Z',
      updatedAt: '2026-04-21T00:00:00.000Z',
      bodyHash: bodyHash('Reply'),
      metadata: {},
      raw: {},
    });

    const first = persistSnapshot({ repos, item, replies: [reply] });
    const second = persistSnapshot({ repos, item, replies: [reply] });

    expect(second.id).toBe(first.id);
    expect(repos.items.get(item.id)?.latestSnapshotHash).toBe(first.snapshotHash);
    db.close();
  });
});
