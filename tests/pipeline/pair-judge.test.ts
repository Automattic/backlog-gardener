import { describe, expect, it } from 'vitest';

import type { Item } from '../../src/gardener/domain.js';
import { bodyHash } from '../../src/gardener/normalize/hashes.js';
import { judgeCandidatePairs } from '../../src/gardener/pipeline/pair-judge.js';
import { FakeCompletionProvider } from '../../src/gardener/llm/provider.js';

function item(id: string, title: string): Item {
  return {
    id,
    sourceKey: 'github:x/y',
    sourceType: 'github',
    sourceId: `x/y#${id}`,
    url: `https://github.com/x/y/issues/${id}`,
    title,
    body: 'Body',
    author: null,
    createdAt: '2026-04-20T00:00:00Z',
    updatedAt: '2026-04-20T00:00:00Z',
    bodyHash: bodyHash('Body'),
    latestSnapshotHash: null,
    referenceOnly: false,
    metadata: {},
    raw: {},
  };
}

describe('LLM pair judge', () => {
  it('judges candidate pairs and accumulates usage', async () => {
    const provider = new FakeCompletionProvider(() => ({
      verdict: 'duplicate',
      confidence: 'high',
      reason: 'Same symptom and trigger.',
    }));

    const result = await judgeCandidatePairs({
      productName: 'Example Product',
      items: [item('1', 'Apple Pay vanishes'), item('2', 'Express buttons disappear')],
      pairs: [{ itemAId: '1', itemBId: '2', score: 0.88, reason: 'embedding-neighbor' }],
      provider,
      maxPairs: 10,
    });

    expect(result.pairs).toEqual([
      {
        itemAId: '1',
        itemBId: '2',
        score: 0.88,
        verdict: 'duplicate',
        reason: 'llm-pair-judge: Same symptom and trigger.',
      },
    ]);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });
});
