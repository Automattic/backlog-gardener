import { describe, expect, it } from 'vitest';

import { scoreDraftPrCandidacy } from '../../src/gardener/actions/pr-candidacy.js';
import type { AttentionFacts, Finding, Item } from '../../src/gardener/domain.js';
import type { EvaluationRecord, VerificationRecord } from '../../src/gardener/evaluate/types.js';

const attentionFacts: AttentionFacts = {
  protectedLabel: { present: false, labels: [] },
  linkedOpenPr: { present: false, urls: [] },
  maintainerActivity: { status: 'none', lastAt: null, actors: [] },
  dismissedOrSnoozed: { present: false, reason: null },
};

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'itm_1',
    sourceKey: 'github:example-org/example-product',
    sourceType: 'github',
    sourceId: 'example-org/example-product#9547',
    url: 'https://github.com/example-org/example-product/issues/9547',
    title: 'Deposits card on payments overview screen looks weird in loading state',
    body: 'Steps to reproduce: go to Payments Overview, scroll to Deposits, see loading state. Expected centered skeleton. Actual icon appears inside the loading state.',
    author: 'merchant',
    createdAt: '2026-04-20T00:00:00Z',
    updatedAt: '2026-04-21T00:00:00Z',
    bodyHash: 'hash',
    latestSnapshotHash: null,
    referenceOnly: false,
    metadata: { issueNumber: 9547 },
    raw: {},
    ...overrides,
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'fnd_1',
    targetKind: 'item',
    targetId: 'itm_1',
    reviewPolicyHash: 'heuristic-v1',
    snapshotHash: 'snapshot',
    recap: {
      decision: 'surface',
      sourceType: 'github_issue',
      shortTitle: 'Deposits card loading skeleton layout polish',
      summary: 'Deposits card loading state has layout polish issues',
      novelty: 'new',
      bestSolution: 'Adjust the loading skeleton layout.',
      risks: [],
      confidence: 'high',
      evidence: [],
      relatedLinks: [],
      reason: 'UI polish issue with clear reproduction.',
    },
    attentionFacts,
    decision: { finalDecision: 'surface', recapDecision: 'surface', gateReasons: [], surfacingReason: 'Actionable.' },
    surfacingLabel: 'developer-ready',
    lifecycleStatus: 'surfaced',
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
    ...overrides,
  };
}

function evaluation(overrides: Partial<EvaluationRecord> = {}): EvaluationRecord {
  return {
    id: 'evl_1',
    findingId: 'fnd_1',
    provider: 'openai',
    model: 'gpt',
    action: 'accept_for_developer_attention',
    confidence: 'high',
    reason: 'Accepted.',
    developerSummary: 'Deposits loading state visual bug.',
    recommendedNextStep: 'Fix the skeleton alignment.',
    proposedExternalComment: null,
    requiresHumanApproval: false,
    riskFlags: [],
    createdAt: '2026-05-05T00:00:00Z',
    ...overrides,
  };
}

function verification(overrides: Partial<VerificationRecord> = {}): VerificationRecord {
  return {
    id: 'vrf_1',
    findingId: 'fnd_1',
    evaluationId: 'evl_1',
    provider: 'openai',
    model: 'gpt',
    action: 'debugging_plan_ready',
    confidence: 'medium',
    subsystem: 'Example Product admin frontend loading skeleton UI',
    likelyFiles: ['client/components/account-balances/index.tsx'],
    hypotheses: ['Loading branch renders help icon.'],
    suggestedReproSteps: ['Open Payments Overview.', 'Observe Deposits loading card.'],
    suggestedTests: ['Add or update a component test for the loading state.'],
    developerNotes: 'Small UI polish issue.',
    requiresHumanApproval: false,
    createdAt: '2026-05-05T00:00:00Z',
    ...overrides,
  };
}

describe('draft PR candidacy scoring', () => {
  it('recognizes high-patchability UI polish findings', () => {
    const score = scoreDraftPrCandidacy({
      finding: finding(),
      item: item(),
      evaluation: evaluation(),
      verification: verification(),
    });

    expect(score.eligible).toBe(true);
    expect(score.score).toBeGreaterThanOrEqual(7);
    expect(score.positiveSignals).toEqual(
      expect.arrayContaining(['clear-reproduction', 'likely-files-identified', 'low-risk-category']),
    );
  });

  it('rejects high-risk money/API ambiguity findings', () => {
    const highRisk = scoreDraftPrCandidacy({
      finding: finding({
        recap: {
          ...finding().recap,
          summary: 'Manual deposits are labeled Instant because the API has no manual-vs-instant signal',
          bestSolution: 'Confirm whether the server API can provide an unambiguous deposit type signal.',
        },
      }),
      item: item({
        title: 'Deposits: All manual deposits are labeled as Instant',
        body: 'The deposit object has no explicit manual-vs-instant signal; fee-based inference may not be robust and depends on API contract changes.',
      }),
      evaluation: evaluation(),
      verification: verification({ subsystem: 'Example Product deposits API/client mapping' }),
    });

    expect(highRisk.eligible).toBe(false);
    expect(highRisk.negativeSignals.join(' ')).toContain('high-risk');
  });

  it('rejects candidates without code context', () => {
    const score = scoreDraftPrCandidacy({
      finding: finding(),
      item: item(),
      evaluation: evaluation(),
      verification: verification({ action: 'needs_code_context', likelyFiles: [], confidence: 'low' }),
    });

    expect(score.eligible).toBe(false);
    expect(score.negativeSignals).toEqual(expect.arrayContaining(['no-likely-files', 'needs-code-context']));
  });
});
