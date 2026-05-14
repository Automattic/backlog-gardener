import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { Finding } from '../../src/gardener/domain.js';
import { renderFindingMarkdown, writeMarkdownOutput } from '../../src/gardener/publish/markdown.js';

const finding: Finding = {
  id: 'fnd_123',
  targetKind: 'item',
  targetId: 'itm_123',
  reviewPolicyHash: 'policy',
  snapshotHash: 'snapshot',
  recap: {
    decision: 'surface',
    sourceType: 'github_issue',
    shortTitle: 'Apple Pay disappears after cart update',
    summary: 'Apple Pay disappears after cart update.',
    novelty: 'recurring',
    bestSolution: 'Investigate checkout fragment rendering.',
    risks: [],
    confidence: 'medium',
    evidence: [
      {
        label: 'Repro',
        detail: 'Reporter provided steps.',
        sourceUrl: 'https://github.com/example-org/example-product/issues/8421',
        quote: 'Apple Pay disappears',
      },
    ],
    relatedLinks: [],
    reason: 'Concrete reproduction details.',
  },
  attentionFacts: {
    protectedLabel: { present: false, labels: [] },
    linkedOpenPr: { present: false, urls: [] },
    maintainerActivity: { status: 'none', lastAt: null, actors: [] },
    dismissedOrSnoozed: { present: false, reason: null },
  },
  decision: {
    finalDecision: 'surface',
    recapDecision: 'surface',
    gateReasons: [],
    surfacingReason: 'No hard gates fired.',
  },
  surfacingLabel: 'worth-investigating',
  lifecycleStatus: 'new',
  createdAt: '2026-04-29T00:00:00.000Z',
  updatedAt: '2026-04-29T00:00:00.000Z',
};

describe('local markdown publisher', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('renders importable feedback blocks', () => {
    const markdown = renderFindingMarkdown(finding);

    expect(markdown).toContain('<!-- gardener-feedback:start finding_id=fnd_123 -->');
    expect(markdown).toContain('Verdict:');
    expect(markdown).toContain('<!-- gardener-feedback:end -->');
  });

  it('documents valid Verdict and Status values inline', () => {
    const markdown = renderFindingMarkdown(finding);

    expect(markdown).toContain('pnpm gardener feedback import');
    expect(markdown).toContain('pnpm gardener review');
    expect(markdown).toContain('**Verdict:** `useful` · `maybe-useful` · `not-useful`');
    expect(markdown).toContain('**Status:** `accepted` · `dismissed` · `snoozed` · `acted-on` · `superseded`');
    expect(markdown).toMatch(/\nVerdict: *\n/);
    expect(markdown).toMatch(/\nStatus: *\n/);
  });

  it('uses recap.shortTitle for the H1 and keeps the longer summary in a body section', () => {
    const markdown = renderFindingMarkdown(finding);

    expect(markdown.split('\n')[0]).toBe(`# ${finding.recap.shortTitle}`);
    expect(markdown).toContain('## Summary\n\nApple Pay disappears after cart update.');
  });

  it('falls back to the first sentence of summary when shortTitle is missing', () => {
    const malformed = { ...finding, recap: { ...finding.recap, shortTitle: '' } };
    const markdown = renderFindingMarkdown(malformed);
    expect(markdown.split('\n')[0]).toBe('# Apple Pay disappears after cart update');
  });

  it('writes digest and per-finding markdown files', () => {
    dir = mkdtempSync(join(tmpdir(), 'gardener-md-'));
    const result = writeMarkdownOutput({
      outputDir: dir,
      runId: 'run_123',
      productName: 'Example Product',
      findings: [finding],
    });

    expect(readFileSync(result.digestPath, 'utf8')).toContain('Surfaced: **1**');
    expect(readFileSync(result.digestPath, 'utf8')).toContain(`[${finding.recap.shortTitle}](${finding.id}.md)`);
    expect(readFileSync(result.findingPaths[0]!, 'utf8')).toContain('Apple Pay disappears');
  });
});
