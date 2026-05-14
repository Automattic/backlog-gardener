import { describe, expect, it } from 'vitest';

import type { Item, Recap, Reply } from '../../src/gardener/domain.js';
import { bodyHash } from '../../src/gardener/normalize/hashes.js';
import { computeAttentionFacts } from '../../src/gardener/pipeline/attention.js';
import { decideFinding } from '../../src/gardener/pipeline/surfacing.js';

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'itm_1',
    sourceKey: 'github:example-org/example-product',
    sourceType: 'github',
    sourceId: 'example-org/example-product#8421',
    url: 'https://github.com/example-org/example-product/issues/8421',
    title: 'Apple Pay vanishes',
    body: 'Apple Pay express-checkout button disappears.',
    author: 'merchant',
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    bodyHash: bodyHash('Apple Pay express-checkout button disappears.'),
    latestSnapshotHash: null,
    referenceOnly: false,
    metadata: { labels: [] },
    raw: {},
    ...overrides,
  };
}

function reply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: 'rpl_1',
    itemId: 'itm_1',
    sourceReplyId: '901001',
    author: 'support-engineer',
    body: 'Can you share details?',
    createdAt: '2026-04-23T09:11:30.000Z',
    updatedAt: '2026-04-23T09:11:30.000Z',
    bodyHash: bodyHash('Can you share details?'),
    metadata: { authorAssociation: 'MEMBER' },
    raw: {},
    ...overrides,
  };
}

const surfaceRecap: Recap = {
  decision: 'surface',
  sourceType: 'github_issue',
  shortTitle: 'Apple Pay disappears after cart update',
  summary: 'Apple Pay disappears after cart update.',
  novelty: 'recurring',
  bestSolution: 'Investigate checkout fragment rendering and patch the missing placeholder.',
  risks: [],
  confidence: 'medium',
  evidence: [
    {
      label: 'Repro',
      detail: 'Reporter described the symptom.',
      sourceUrl: 'https://github.com/example-org/example-product/issues/8421',
      quote: 'Apple Pay express-checkout button disappears',
    },
  ],
  relatedLinks: [],
  reason: 'Recurring checkout-impacting report with concrete reproduction details.',
};

describe('attention facts and surfacing rules', () => {
  it('defers active maintainer engagement even when Recap recommends surface', () => {
    const facts = computeAttentionFacts({
      item: item(),
      replies: [reply()],
      protectedLabels: ['security'],
      now: new Date('2026-04-29T00:00:00.000Z'),
      recentMaintainerActivityDays: 14,
      staleMaintainerActivityDays: 90,
    });

    const decision = decideFinding({
      recap: surfaceRecap,
      attentionFacts: facts,
      minConfidence: 'medium',
      minRecurrence: 1,
      recurrenceCount: 1,
    });

    expect(facts.maintainerActivity.status).toBe('active');
    expect(decision.finalDecision).toBe('defer');
    expect(decision.gateReasons).toContain('active-maintainer-engagement');
  });

  it('treats explicit fix-in-progress replies as active work claims', () => {
    const facts = computeAttentionFacts({
      item: item(),
      replies: [reply({ body: 'Working on a fix.', metadata: { authorAssociation: 'NONE' } })],
      protectedLabels: [],
      now: new Date('2026-04-29T00:00:00.000Z'),
      recentMaintainerActivityDays: 14,
      staleMaintainerActivityDays: 90,
    });

    const decision = decideFinding({
      recap: surfaceRecap,
      attentionFacts: facts,
      minConfidence: 'medium',
      minRecurrence: 1,
      recurrenceCount: 1,
    });

    expect(facts.maintainerActivity.status).toBe('active');
    expect(decision.gateReasons).toContain('active-maintainer-engagement');
  });

  it('allows stale maintainer engagement to surface when other criteria pass', () => {
    const facts = computeAttentionFacts({
      item: item(),
      replies: [reply({ updatedAt: '2025-12-01T00:00:00.000Z' })],
      protectedLabels: [],
      now: new Date('2026-04-29T00:00:00.000Z'),
      recentMaintainerActivityDays: 14,
      staleMaintainerActivityDays: 90,
    });

    const decision = decideFinding({
      recap: surfaceRecap,
      attentionFacts: facts,
      minConfidence: 'medium',
      minRecurrence: 1,
      recurrenceCount: 2,
    });

    expect(facts.maintainerActivity.status).toBe('stale');
    expect(decision.finalDecision).toBe('surface');
  });

  it('defers protected labels and linked open PRs', () => {
    const facts = computeAttentionFacts({
      item: item({ metadata: { labels: ['Security'], linkedOpenPrUrls: ['https://github.com/x/y/pull/1'] } }),
      replies: [],
      protectedLabels: ['security'],
      now: new Date('2026-04-29T00:00:00.000Z'),
      recentMaintainerActivityDays: 14,
      staleMaintainerActivityDays: 90,
    });

    const decision = decideFinding({
      recap: surfaceRecap,
      attentionFacts: facts,
      minConfidence: 'medium',
      minRecurrence: 1,
      recurrenceCount: 1,
    });

    expect(decision.finalDecision).toBe('defer');
    expect(decision.gateReasons).toContain('protected-label:security');
    expect(decision.gateReasons).toContain('linked-open-pr');
  });
});
