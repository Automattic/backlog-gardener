import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { Finding, Item } from '../../src/gardener/domain.js';
import { bodyHash } from '../../src/gardener/normalize/hashes.js';
import { collectCodeContext } from '../../src/gardener/evaluate/code-context.js';
import { localEvaluateFinding } from '../../src/gardener/evaluate/evaluator.js';
import { verifyFinding } from '../../src/gardener/evaluate/verifier.js';
import { FakeCompletionProvider } from '../../src/gardener/llm/provider.js';

function item(): Item {
  return {
    id: 'itm_1',
    sourceKey: 'github:x/y',
    sourceType: 'github',
    sourceId: 'x/y#1',
    url: 'https://github.com/x/y/issues/1',
    title: 'Capital repayment missing',
    body: 'Final repayment is missing from the UI.',
    author: null,
    createdAt: '2026-04-29T00:00:00Z',
    updatedAt: '2026-04-29T00:00:00Z',
    bodyHash: bodyHash('Final repayment is missing from the UI.'),
    latestSnapshotHash: null,
    referenceOnly: false,
    metadata: {},
    raw: {},
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'fnd_1',
    targetKind: 'item',
    targetId: 'itm_1',
    reviewPolicyHash: 'policy',
    snapshotHash: 'snap',
    recap: {
      decision: 'surface',
      sourceType: 'github_issue',
      shortTitle: 'Capital final repayment missing from UI',
      summary: 'Capital final repayment missing from UI',
      novelty: 'new',
      bestSolution: 'Inspect Capital repayment transaction list rendering.',
      risks: [],
      confidence: 'high',
      evidence: [
        {
          label: 'Source',
          detail: 'Reporter saw mismatch.',
          sourceUrl: 'https://github.com/x/y/issues/1',
          quote: null,
        },
      ],
      relatedLinks: [],
      reason: 'Concrete discrepancy.',
    },
    attentionFacts: {
      protectedLabel: { present: false, labels: [] },
      linkedOpenPr: { present: false, urls: [] },
      maintainerActivity: { status: 'none', lastAt: null, actors: [] },
      dismissedOrSnoozed: { present: false, reason: null },
    },
    decision: { finalDecision: 'surface', recapDecision: 'surface', gateReasons: [], surfacingReason: 'Actionable.' },
    surfacingLabel: 'developer-ready',
    lifecycleStatus: 'surfaced',
    createdAt: '2026-04-29T00:00:00Z',
    updatedAt: '2026-04-29T00:00:00Z',
    ...overrides,
  };
}

describe('evaluator and verifier agents', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('accepts surfaced findings for developer attention locally', () => {
    expect(localEvaluateFinding({ finding: finding(), item: item() }).action).toBe('accept_for_developer_attention');
  });

  it('defers findings with active gates locally', () => {
    const decision = localEvaluateFinding({
      finding: finding({
        decision: {
          finalDecision: 'defer',
          recapDecision: 'surface',
          gateReasons: ['active-maintainer-engagement'],
          surfacingReason: 'Active.',
        },
      }),
      item: item(),
    });
    expect(decision.action).toBe('defer_because_already_active');
  });

  it('collects limited code context and creates a local verification plan', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gardener-code-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(
      join(dir, 'src', 'capital.ts'),
      'export function renderCapitalRepaymentTransactions() { return []; }',
    );
    const context = collectCodeContext({ rootDir: dir, query: 'Capital repayment transactions' });
    expect(context.snippets[0]?.path).toBe('src/capital.ts');

    const evaluation = {
      id: 'evl_1',
      findingId: 'fnd_1',
      provider: 'fake',
      model: 'fake',
      action: 'accept_for_developer_attention' as const,
      confidence: 'high' as const,
      reason: 'Good',
      developerSummary: 'Summary',
      recommendedNextStep: 'Next',
      proposedExternalComment: null,
      requiresHumanApproval: false,
      riskFlags: [],
      createdAt: 'now',
    };
    const result = await verifyFinding({
      productName: 'Example Product',
      finding: finding(),
      item: item(),
      evaluation,
      provider: new FakeCompletionProvider(() => ({})),
      codeRoot: dir,
    });
    expect(result.decision.action).toBe('debugging_plan_ready');
    expect(result.decision.likelyFiles).toContain('src/capital.ts');
  });
});
