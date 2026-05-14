import { describe, expect, it } from 'vitest';

import { estimateCompletionCostUsd, recordUsageEvent, usageTotalsForRun } from '../src/gardener/usage.js';
import { StoreDb } from '../src/gardener/store/index.js';

describe('usage events', () => {
  it('estimates completion cost and aggregates run usage', () => {
    const db = new StoreDb(':memory:');
    db.migrate();
    db.db
      .prepare(
        'INSERT INTO runs (id, profile_slug, lane, mode, status, started_at, summary_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('run_1', 'example-product', 'warm', 'review', 'in_progress', '2026-04-29T00:00:00.000Z', '{}');
    const cost = estimateCompletionCostUsd({ provider: 'anthropic', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBe(90);

    recordUsageEvent(db.db, {
      runId: 'run_1',
      provider: 'anthropic',
      model: 'claude',
      kind: 'completion',
      inputTokens: 10,
      outputTokens: 20,
      estimatedCostUsd: 0.001,
    });

    expect(usageTotalsForRun(db.db, 'run_1')).toEqual({
      completionCalls: 1,
      embeddingCalls: 0,
      inputTokens: 10,
      outputTokens: 20,
      estimatedCostUsd: 0.001,
    });
    db.close();
  });
});
