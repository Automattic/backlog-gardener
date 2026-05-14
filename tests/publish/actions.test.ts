import { describe, expect, it } from 'vitest';

import type { SurfacedDrop } from '../../src/gardener/actions/plan.js';
import type { ProposedAction } from '../../src/gardener/actions/types.js';
import { renderActionsHtml, renderActionsMarkdown } from '../../src/gardener/publish/actions.js';

function action(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    schemaVersion: 'gardener.action.v1',
    actionId: 'act_1',
    runId: 'run_1',
    productSlug: 'example-product',
    type: 'add_context_to_existing_issue',
    status: 'would_apply',
    dryRun: true,
    confidence: 'high',
    title: 'Add public feedback context to example-org/example-product#8906',
    body: 'draft body',
    target: {
      system: 'github',
      kind: 'issue',
      repo: 'example-org/example-product',
      issueNumber: 8906,
      url: 'https://github.com/example-org/example-product/issues/8906',
    },
    sourceFindingIds: ['fnd_abc'],
    sourceUrls: ['https://github.com/example-org/example-product/issues/8906'],
    evidence: [],
    rationale: 'Concrete and actionable.',
    safety: { externalWritesEnabled: false, requiresApproval: true, blockedReasons: [] },
    createdAt: '2026-05-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('renderActionsMarkdown', () => {
  it('renders the target as a markdown link when the action has a URL', () => {
    const md = renderActionsMarkdown({
      runId: 'run_1',
      productName: 'Example Product',
      dryRun: true,
      externalWritesEnabled: false,
      actions: [action()],
    });

    expect(md).toContain(
      '- Target: [example-org/example-product#8906](https://github.com/example-org/example-product/issues/8906)',
    );
  });

  it('renders a "Surfaced findings without an action" section when drops exist', () => {
    const drops: SurfacedDrop[] = [
      {
        findingId: 'fnd_drop_1',
        reason: 'no-net-new-context-for-existing-issue',
        itemUrl: 'https://github.com/example-org/example-product/issues/9547',
      },
      { findingId: 'fnd_drop_2', reason: 'linked-open-pr', itemUrl: null },
    ];
    const md = renderActionsMarkdown({
      runId: 'run_1',
      productName: 'Example Product',
      dryRun: true,
      externalWritesEnabled: false,
      actions: [action()],
      surfacedDrops: drops,
    });
    expect(md).toContain('- Surfaced without an action: **2**');
    expect(md).toContain('## Surfaced findings without an action');
    expect(md).toContain('`fnd_drop_1` — No net-new implementation context');
    expect(md).toContain('https://github.com/example-org/example-product/issues/9547');
    expect(md).toContain('`fnd_drop_2` — Source has a linked open PR');

    const html = renderActionsHtml({
      runId: 'run_1',
      productName: 'Example Product',
      dryRun: true,
      externalWritesEnabled: false,
      actions: [action()],
      surfacedDrops: drops,
    });
    expect(html).toContain('Surfaced findings without an action');
    expect(html).toContain('fnd_drop_1');
    expect(html).toContain('Surfaced without an action');
  });

  it('falls back to a plain target label when no URL is available', () => {
    const md = renderActionsMarkdown({
      runId: 'run_1',
      productName: 'Example Product',
      dryRun: true,
      externalWritesEnabled: false,
      actions: [
        action({
          target: {
            system: 'github',
            kind: 'new_issue',
            repo: 'example-org/example-product',
            labels: [],
          },
          sourceUrls: [],
        }),
      ],
    });

    expect(md).toContain('- Target: example-org/example-product new issue\n');
    expect(md).not.toMatch(/- Target: \[.*]\(.+\)/);
  });
});
