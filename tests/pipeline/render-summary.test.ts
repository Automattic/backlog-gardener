import { describe, expect, it } from 'vitest';

import { renderSweepSummary, type SweepSummary } from '../../src/gardener/pipeline/orchestrator.js';

function baseSummary(overrides: Partial<SweepSummary> = {}): SweepSummary {
  return {
    runId: 'run_test',
    command: 'run',
    dryRun: true,
    externalWritesEnabled: false,
    status: 'completed',
    itemsFetched: 0,
    repliesFetched: 0,
    findings: 0,
    surfaced: 0,
    actions: 0,
    prCandidates: 0,
    outputDir: null,
    digestPath: null,
    actionsJsonlPath: null,
    actionsMarkdownPath: null,
    actionsHtmlPath: null,
    manifestPath: null,
    slackStatus: 'skipped',
    skippedExternalWriters: [],
    usage: { completionCalls: 0, embeddingCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    embeddings: 0,
    dedupEdges: 0,
    clusters: 0,
    evaluations: 0,
    verifications: 0,
    ...overrides,
  };
}

describe('renderSweepSummary next steps', () => {
  it('omits the next-steps block when there is nothing to review', () => {
    const text = renderSweepSummary(baseSummary(), { statePath: '.gardener-state/woo.db' });
    expect(text).not.toContain('Next steps:');
  });

  it('points the reviewer at the HTML report and review UI when actions exist', () => {
    const text = renderSweepSummary(
      baseSummary({
        surfaced: 6,
        actions: 5,
        outputDir: 'out/example-product/run_test',
        actionsHtmlPath: 'out/example-product/run_test/actions.html',
      }),
      { statePath: '.gardener-state/example-product.db' },
    );
    expect(text).toContain('Next steps:');
    expect(text).toContain('Open the action plan: out/example-product/run_test/actions.html');
    expect(text).toContain('pnpm gardener review --state .gardener-state/example-product.db');
    expect(text).toContain('http://127.0.0.1:4317');
    expect(text).toContain('feedback import --state .gardener-state/example-product.db');
  });

  it('falls back to the markdown plan when no HTML path is present', () => {
    const text = renderSweepSummary(
      baseSummary({
        surfaced: 1,
        actions: 1,
        outputDir: 'out/example-product/run_test',
        actionsMarkdownPath: 'out/example-product/run_test/actions.md',
      }),
      { statePath: '.gardener-state/example-product.db' },
    );
    expect(text).toContain('Open the action plan: out/example-product/run_test/actions.md');
  });

  it('still suggests the review UI when actions=0 but findings were surfaced', () => {
    const text = renderSweepSummary(
      baseSummary({
        surfaced: 1,
        actions: 0,
        outputDir: 'out/example-product/run_test',
      }),
      { statePath: '.gardener-state/example-product.db' },
    );
    expect(text).toContain('Next steps:');
    expect(text).toContain('pnpm gardener review --state .gardener-state/example-product.db');
  });
});
