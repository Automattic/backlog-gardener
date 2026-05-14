import { describe, expect, it } from 'vitest';

import { planProposedActions } from '../../src/gardener/actions/plan.js';
import { parseTriageProfile } from '../../src/gardener/config/index.js';
import type { AttentionFacts, Finding, Item } from '../../src/gardener/domain.js';
import type { EvaluationRecord, VerificationRecord } from '../../src/gardener/evaluate/types.js';
import type { PlannedDraftPr } from '../../src/gardener/implementer/draft-pr.js';

const profile = parseTriageProfile({
  product: { name: 'Example Product', slug: 'example-product' },
  sources: [{ type: 'github', host: 'github.com', repo: 'example-org/example-product' }],
  llm: {
    completion: { provider: 'local', model: 'local' },
    embedding: { provider: 'local', model: 'hash-v1' },
  },
});

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
    sourceId: 'example-org/example-product#8421',
    url: 'https://github.com/example-org/example-product/issues/8421',
    title: 'Apple Pay vanishes',
    body: 'Apple Pay disappears after cart update.',
    author: 'merchant',
    createdAt: '2026-04-20T00:00:00Z',
    updatedAt: '2026-04-21T00:00:00Z',
    bodyHash: 'hash',
    latestSnapshotHash: null,
    referenceOnly: false,
    metadata: { issueNumber: 8421 },
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
      shortTitle: 'Apple Pay vanishes after cart updates',
      summary: 'Apple Pay vanishes after cart updates',
      novelty: 'new',
      bestSolution: 'Investigate the Apple Pay refresh flow.',
      risks: [],
      confidence: 'medium',
      evidence: [
        {
          label: 'Source report',
          detail: 'Merchant reported Apple Pay disappearing.',
          sourceUrl: 'https://github.com/example-org/example-product/issues/8421',
          quote: 'Apple Pay disappears after cart update.',
        },
      ],
      relatedLinks: [],
      reason: 'Passed deterministic gates.',
    },
    attentionFacts,
    decision: {
      finalDecision: 'surface',
      recapDecision: 'surface',
      gateReasons: [],
      surfacingReason: 'The report is actionable and not already owned.',
    },
    surfacingLabel: 'developer-ready',
    lifecycleStatus: 'surfaced',
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
    ...overrides,
  };
}

function acceptedEvaluation(overrides: Partial<EvaluationRecord> = {}): EvaluationRecord {
  return {
    id: 'evl_1',
    findingId: 'fnd_1',
    provider: 'openai',
    model: 'gpt',
    action: 'accept_for_developer_attention',
    confidence: 'high',
    reason: 'Accepted for developer attention.',
    developerSummary: 'Apple Pay vanishes',
    recommendedNextStep: 'Investigate the Apple Pay refresh flow.',
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
    subsystem: 'Example Product admin UI',
    likelyFiles: ['client/components/apple-pay/index.tsx'],
    hypotheses: ['A refresh handler is not re-rendering Apple Pay.'],
    suggestedReproSteps: ['Open checkout.', 'Update cart.'],
    suggestedTests: ['Add a component regression test.'],
    developerNotes: 'Likely UI refresh issue.',
    requiresHumanApproval: false,
    createdAt: '2026-05-05T00:00:00Z',
    ...overrides,
  };
}

describe('proposed action planning', () => {
  it('does not add context to an existing GitHub issue when it only restates that issue', () => {
    const { actions } = planProposedActions({
      profile,
      runId: 'run_1',
      dryRun: true,
      externalWritesEnabled: false,
      entries: [{ finding: finding(), item: item(), evaluation: acceptedEvaluation() }],
      createdAt: '2026-05-05T00:00:00Z',
    });

    expect(actions).toEqual([]);
  });

  it('plans adding context to an existing GitHub issue when there is net-new implementation context', () => {
    const { actions } = planProposedActions({
      profile,
      runId: 'run_1',
      dryRun: true,
      externalWritesEnabled: false,
      entries: [{ finding: finding(), item: item(), evaluation: acceptedEvaluation(), verification: verification() }],
      createdAt: '2026-05-05T00:00:00Z',
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      schemaVersion: 'gardener.action.v1',
      runId: 'run_1',
      type: 'add_context_to_existing_issue',
      status: 'would_apply',
      dryRun: true,
      title: '#8421 — Apple Pay vanishes after cart updates',
      target: {
        system: 'github',
        kind: 'issue',
        repo: 'example-org/example-product',
        issueNumber: 8421,
      },
      safety: { externalWritesEnabled: false, requiresApproval: true, blockedReasons: [] },
    });
    expect(actions[0]!.body).toContain('Dry-run note');
  });

  it('plans opening a PR only when patch artifacts exist', () => {
    const draftPr: PlannedDraftPr = {
      actionId: 'act_1',
      findingId: 'fnd_1',
      title: 'Fix Apple Pay refresh rendering',
      body: '## What\nFixes Apple Pay refresh rendering.',
      target: {
        system: 'github',
        kind: 'pull_request',
        repo: 'example-org/example-product',
        baseBranch: 'develop',
        branchName: 'gardener/8421-fix-apple-pay-refresh-rendering',
      },
      artifacts: {
        patchPath: 'pr-candidates/act_1.patch',
        prBodyPath: 'pr-candidates/act_1.pr.md',
        verificationPath: 'pr-candidates/act_1.verification.json',
        verificationStatus: 'not_run',
      },
      rationale: 'Draft PR candidate score 8.',
    };

    const { actions } = planProposedActions({
      profile,
      runId: 'run_1',
      dryRun: true,
      externalWritesEnabled: false,
      entries: [{ finding: finding(), item: item(), evaluation: acceptedEvaluation(), verification: verification() }],
      draftPrs: new Map([['fnd_1', draftPr]]),
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actionId: 'act_1',
      type: 'open_pr',
      target: { kind: 'pull_request', branchName: 'gardener/8421-fix-apple-pay-refresh-rendering' },
      prArtifacts: { patchPath: 'pr-candidates/act_1.patch' },
    });
  });

  it('plans creating a GitHub issue for surfaced WordPress.org findings', () => {
    const wporgItem = item({
      sourceKey: 'wporg-forum:example-plugin',
      sourceType: 'wporg-forum',
      sourceId: 'apple-pay-vanishes',
      url: 'https://wordpress.org/support/topic/apple-pay-vanishes/',
      metadata: {},
    });
    const wporgFinding = finding({
      recap: { ...finding().recap, sourceType: 'wporg_forum' },
    });

    const { actions } = planProposedActions({
      profile,
      runId: 'run_1',
      dryRun: true,
      externalWritesEnabled: false,
      entries: [{ finding: wporgFinding, item: wporgItem }],
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'create_issue',
      status: 'would_apply',
      target: {
        system: 'github',
        kind: 'new_issue',
        repo: 'example-org/example-product',
        labels: ['developer-ready'],
      },
    });
  });

  it('does not emit actions when evaluator recommends deferring active work', () => {
    const { actions } = planProposedActions({
      profile,
      runId: 'run_1',
      dryRun: true,
      externalWritesEnabled: false,
      entries: [
        {
          finding: finding(),
          item: item(),
          evaluation: {
            id: 'evl_1',
            findingId: 'fnd_1',
            provider: 'openai',
            model: 'gpt',
            action: 'defer_because_already_active',
            confidence: 'medium',
            reason: 'Someone is already working on a fix.',
            developerSummary: 'Apple Pay vanishes',
            recommendedNextStep: 'Monitor the existing issue.',
            proposedExternalComment: null,
            requiresHumanApproval: false,
            riskFlags: [],
            createdAt: '2026-05-05T00:00:00Z',
          },
        },
      ],
    });

    expect(actions).toEqual([]);
  });

  it('does not emit would-apply actions for deferred or protected findings', () => {
    const deferred = finding({
      decision: {
        finalDecision: 'defer',
        recapDecision: 'surface',
        gateReasons: ['protected-label'],
        surfacingReason: 'Protected.',
      },
      attentionFacts: { ...attentionFacts, protectedLabel: { present: true, labels: ['security'] } },
    });

    expect(
      planProposedActions({
        profile,
        runId: 'run_1',
        dryRun: true,
        externalWritesEnabled: false,
        entries: [{ finding: deferred, item: item() }],
      }).actions,
    ).toEqual([]);
  });
});
