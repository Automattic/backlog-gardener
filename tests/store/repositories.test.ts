import { describe, expect, it } from 'vitest';

import type { Recap, AttentionFacts, FindingDecision } from '../../src/gardener/domain.js';
import { StoreDb, RepositoryBundle } from '../../src/gardener/store/index.js';
import { bodyHash } from '../../src/gardener/normalize/hashes.js';

function makeStore(): { db: StoreDb; repos: RepositoryBundle } {
  const db = new StoreDb(':memory:');
  db.migrate();
  return { db, repos: new RepositoryBundle(db.db) };
}

const recap: Recap = {
  decision: 'surface',
  sourceType: 'github_issue',
  shortTitle: 'Apple Pay disappears after cart update',
  summary: 'Apple Pay disappears after cart update.',
  novelty: 'recurring',
  bestSolution: 'Investigate the cart fragment update path.',
  risks: [],
  confidence: 'medium',
  evidence: [
    {
      label: 'Repro',
      detail: 'Reporter provided steps.',
      sourceUrl: 'https://github.com/example-org/example-product/issues/8421',
      quote: 'Apple Pay express-checkout button disappears',
    },
  ],
  relatedLinks: [],
  reason: 'Actionable reproduction steps with user impact.',
};

const attentionFacts: AttentionFacts = {
  protectedLabel: { present: false, labels: [] },
  linkedOpenPr: { present: false, urls: [] },
  maintainerActivity: { status: 'none', lastAt: null, actors: [] },
  dismissedOrSnoozed: { present: false, reason: null },
};

const decision: FindingDecision = {
  finalDecision: 'surface',
  recapDecision: 'surface',
  gateReasons: [],
  surfacingReason: 'No hard gates fired.',
};

describe('SQLite repository boundary', () => {
  it('runs migrations idempotently', () => {
    const db = new StoreDb(':memory:');
    db.migrate();
    db.migrate();

    const rows = db.db.prepare('SELECT id FROM schema_migrations').all();
    expect(rows).toHaveLength(2);
    db.close();
  });

  it('upserts and reads canonical items idempotently', () => {
    const { db, repos } = makeStore();
    const first = repos.items.upsert({
      sourceKey: 'github:example-org/example-product',
      sourceType: 'github',
      sourceId: 'example-org/example-product#8421',
      url: 'https://github.com/example-org/example-product/issues/8421',
      title: 'Apple Pay vanishes',
      body: 'Apple Pay disappears after cart update.',
      author: 'merchant',
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-21T00:00:00.000Z',
      bodyHash: bodyHash('Apple Pay disappears after cart update.'),
      latestSnapshotHash: null,
      referenceOnly: false,
      metadata: { labels: ['bug'] },
      raw: { number: 8421 },
    });
    const second = repos.items.upsert({ ...first, title: 'Apple Pay still vanishes' });

    expect(second.id).toBe(first.id);
    expect(repos.items.findBySource(first.sourceKey, first.sourceId)?.title).toBe('Apple Pay still vanishes');
    db.close();
  });

  it('stores replies, snapshots, findings, and feedback', () => {
    const { db, repos } = makeStore();
    const item = repos.items.upsert({
      sourceKey: 'github:example-org/example-product',
      sourceType: 'github',
      sourceId: 'example-org/example-product#8421',
      url: 'https://github.com/example-org/example-product/issues/8421',
      title: 'Apple Pay vanishes',
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
      sourceReplyId: '901001',
      author: 'support-engineer',
      body: 'Can you share details?',
      createdAt: '2026-04-21T01:00:00.000Z',
      updatedAt: '2026-04-21T01:00:00.000Z',
      bodyHash: bodyHash('Can you share details?'),
      metadata: { authorAssociation: 'MEMBER' },
      raw: {},
    });
    const snapshot = repos.snapshots.insert({
      itemId: item.id,
      snapshotHash: 'abc123',
      bodyHash: item.bodyHash,
      takenAt: '2026-04-21T02:00:00.000Z',
    });
    const finding = repos.findings.upsert({
      targetKind: 'item',
      targetId: item.id,
      reviewPolicyHash: 'policy',
      snapshotHash: 'snapshot',
      recap,
      attentionFacts,
      decision,
      surfacingLabel: 'worth-investigating',
      lifecycleStatus: 'new',
    });
    const feedback = repos.feedback.upsert({
      findingId: finding.id,
      verdict: 'useful',
      reasons: ['good-candidate'],
      status: 'accepted',
      note: 'Worth a look.',
      reviewer: 'dev@example.com',
    });

    expect(reply.id).toMatch(/^rpl_/);
    expect(snapshot.id).toMatch(/^snp_/);
    expect(repos.findings.get(finding.id)?.recap.summary).toContain('Apple Pay');
    expect(feedback.status).toBe('accepted');
    expect(repos.feedback.listForFinding(finding.id)).toHaveLength(1);
    db.close();
  });
});
