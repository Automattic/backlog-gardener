import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createDraftPrArtifacts } from '../../src/gardener/implementer/draft-pr.js';
import type { DraftPrImplementer } from '../../src/gardener/implementer/types.js';
import type { ActionPlanningEntry } from '../../src/gardener/actions/plan.js';
import type { DraftPrCandidacy } from '../../src/gardener/actions/pr-candidacy.js';
import type { Finding, Item } from '../../src/gardener/domain.js';

function entry(): ActionPlanningEntry {
  const item: Item = {
    id: 'itm_1',
    sourceKey: 'github:example-org/example-product',
    sourceType: 'github',
    sourceId: 'example-org/example-product#9547',
    url: 'https://github.com/example-org/example-product/issues/9547',
    title: 'Deposits card loading state looks weird',
    body: 'Steps to reproduce: observe loading state.',
    author: 'merchant',
    createdAt: '2026-04-20T00:00:00Z',
    updatedAt: '2026-04-21T00:00:00Z',
    bodyHash: 'hash',
    latestSnapshotHash: null,
    referenceOnly: false,
    metadata: { issueNumber: 9547 },
    raw: {},
  };
  const finding: Finding = {
    id: 'fnd_1',
    targetKind: 'item',
    targetId: item.id,
    reviewPolicyHash: 'heuristic-v1',
    snapshotHash: 'snapshot',
    recap: {
      decision: 'surface',
      sourceType: 'github_issue',
      shortTitle: 'Deposits loading state visual bug',
      summary: 'Deposits loading state visual bug',
      novelty: 'new',
      bestSolution: 'Fix the loading skeleton.',
      risks: [],
      confidence: 'high',
      evidence: [],
      relatedLinks: [],
      reason: 'Clear UI polish issue.',
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
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  };
  return { finding, item };
}

const candidacy: DraftPrCandidacy = {
  eligible: true,
  score: 8,
  positiveSignals: ['existing-github-issue', 'clear-reproduction'],
  negativeSignals: [],
  categories: ['ui-polish'],
  reason: 'Draft PR candidate score 8.',
};

describe('draft PR artifact creation', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('runs implementers in an isolated workspace and writes patch artifacts', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gardener-pr-'));
    const sourceRoot = join(dir, 'source');
    const outputDir = join(dir, 'out');
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, 'component.tsx'), 'export const value = "before";\n');
    const implementer: DraftPrImplementer = {
      name: 'fake',
      async implement(input) {
        writeFileSync(join(input.workspacePath, 'component.tsx'), 'export const value = "after";\n');
        return {
          status: 'patch_created',
          title: 'Fix Deposits loading state',
          body: '## What\nFixes the loading state.\n',
          patch:
            'diff --git a/component.tsx b/component.tsx\n--- a/component.tsx\n+++ b/component.tsx\n@@\n-before\n+after\n',
          changedFiles: ['component.tsx'],
          verification: { status: 'not_run', commands: [], summary: 'Not run in fake test.' },
        };
      },
    };

    const draftPr = await createDraftPrArtifacts({
      actionId: 'act_1',
      outputDir,
      sourceRoot,
      entry: entry(),
      candidacy,
      implementer,
      baseBranch: 'develop',
    });

    expect(draftPr).toMatchObject({
      actionId: 'act_1',
      target: {
        system: 'github',
        kind: 'pull_request',
        repo: 'example-org/example-product',
        baseBranch: 'develop',
      },
      artifacts: { verificationStatus: 'not_run' },
    });
    expect(existsSync(draftPr!.artifacts.patchPath)).toBe(true);
    expect(existsSync(draftPr!.artifacts.prBodyPath)).toBe(true);
    expect(existsSync(draftPr!.artifacts.verificationPath)).toBe(true);
    expect(readFileSync(join(sourceRoot, 'component.tsx'), 'utf8')).toContain('before');
    expect(readFileSync(join(outputDir, 'pr-workspaces', 'act_1', 'component.tsx'), 'utf8')).toContain('after');
  });

  it('does not create an open-pr artifact when no patch is returned', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gardener-pr-'));
    const sourceRoot = join(dir, 'source');
    const outputDir = join(dir, 'out');
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, 'component.tsx'), 'export const value = "before";\n');

    const draftPr = await createDraftPrArtifacts({
      actionId: 'act_1',
      outputDir,
      sourceRoot,
      entry: entry(),
      candidacy,
      implementer: {
        name: 'fake',
        async implement() {
          return { status: 'no_patch', reason: 'Unsupported.' };
        },
      },
      baseBranch: 'develop',
    });

    expect(draftPr).toBeNull();
  });
});
