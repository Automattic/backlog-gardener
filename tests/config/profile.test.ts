import { describe, expect, it } from 'vitest';

import { ConfigValidationError, loadTriageProfile, parseTriageProfile } from '../../src/gardener/config/index.js';

const VALID_PROFILE = {
  product: { name: 'Example Product', slug: 'example-product' },
  sources: [
    {
      type: 'github',
      host: 'github.com',
      repo: 'example-org/example-product',
      authEnv: 'GITHUB_TOKEN',
    },
    { type: 'wporg-reviews', pluginSlug: 'example-product' },
    { type: 'wporg-forum', pluginSlug: 'example-product' },
  ],
  llm: {
    completion: { provider: 'anthropic', model: 'claude-opus-4-7', thinking: 'medium' },
    roles: {
      triage: { provider: 'anthropic', model: 'claude-haiku', thinking: 'low' },
      evaluator: { provider: 'anthropic', model: 'claude-opus', thinking: 'high' },
    },
    embedding: { provider: 'openai', model: 'text-embedding-3-small' },
  },
};

describe('TriageProfile config', () => {
  it('loads the Example Product MVP profile', async () => {
    const profile = await loadTriageProfile('.gardener/products/example-product.yml');

    expect(profile.product.slug).toBe('example-product');
    expect(profile.sources.map((source) => source.type)).toEqual(['github', 'wporg-reviews', 'wporg-forum']);
    expect(profile.llm.roles.evaluator?.thinking).toBe('high');
    expect(profile.publishers.reviewLane).toEqual([
      { name: 'local-markdown', outputDir: 'out/{product}/{timestamp}__{runId}' },
      { name: 'slack', mode: 'channel', webhookEnv: 'SLACK_WEBHOOK_URL', includeTopFindings: 5 },
    ]);
  });

  it('applies MVP defaults for attention, surfacing, budget, and publishers', () => {
    const profile = parseTriageProfile(VALID_PROFILE);

    expect(profile.attention.recentMaintainerActivityDays).toBe(14);
    expect(profile.attention.staleMaintainerActivityDays).toBe(90);
    expect(profile.attention.protectedLabels).toContain('security');
    expect(profile.surfacing.minConfidence).toBe('medium');
    expect(profile.surfacing.labels).toContain('developer-ready');
    expect(profile.budget.maxDedupPairsPerRun).toBe(1000);
    expect(profile.publishers.reviewLane).toEqual([
      { name: 'local-markdown', outputDir: 'out/{product}/{timestamp}__{runId}' },
    ]);
  });

  it('rejects GitHub Enterprise/internal hosts for Local MVP', () => {
    const invalid = structuredClone(VALID_PROFILE);
    invalid.sources[0] = {
      type: 'github',
      host: 'github.enterprise.example.com',
      repo: 'example-org/private-repo',
      authEnv: 'GHE_TOKEN',
    };

    expect(() => parseTriageProfile(invalid, 'inline.yml')).toThrow(ConfigValidationError);
    expect(() => parseTriageProfile(invalid, 'inline.yml')).toThrow(/not supported in the Local MVP/);
  });

  it('reports missing required fields with actionable paths', () => {
    expect(() => parseTriageProfile({ ...VALID_PROFILE, product: { name: 'Example Product' } })).toThrow(
      /product.slug/,
    );
  });

  it('supports Slack channel webhook config with spec-style snake_case keys', () => {
    const profile = parseTriageProfile({
      ...VALID_PROFILE,
      publishers: {
        reviewLane: [
          {
            name: 'slack',
            mode: 'channel',
            webhook_env: 'SLACK_WEBHOOK_URL',
            include_top_findings: 3,
          },
        ],
        applyLane: [],
      },
    });

    expect(profile.publishers.reviewLane).toEqual([
      { name: 'slack', mode: 'channel', webhookEnv: 'SLACK_WEBHOOK_URL', includeTopFindings: 3 },
    ]);
  });
});
