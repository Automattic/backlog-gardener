import { describe, expect, it } from 'vitest';

import { normalizeGitHubComment, normalizeGitHubIssue } from '../../src/gardener/sources/github.js';

describe('GitHub fixture normalization', () => {
  it('normalizes public issues with typed metadata', () => {
    const item = normalizeGitHubIssue({
      sourceKey: 'github:example-org/example-product',
      repo: 'example-org/example-product',
      raw: {
        number: 8421,
        html_url: 'https://github.com/example-org/example-product/issues/8421',
        title: 'Apple Pay vanishes',
        body: 'See https://github.com/example-org/example-product/pull/9999',
        user: { login: 'merchant' },
        created_at: '2026-04-20T00:00:00.000Z',
        updated_at: '2026-04-21T00:00:00.000Z',
        state: 'open',
        state_reason: null,
        author_association: 'NONE',
        labels: [{ name: 'bug' }],
      },
    });

    expect(item?.sourceId).toBe('example-org/example-product#8421');
    expect(item?.metadata).toMatchObject({
      labels: ['bug'],
      state: 'open',
      stateReason: null,
      authorAssociation: 'NONE',
      linkedOpenPrUrls: ['https://github.com/example-org/example-product/pull/9999'],
    });
  });

  it('marks closed issues reference-only and excludes PRs', () => {
    const closed = normalizeGitHubIssue({
      sourceKey: 'github:x/y',
      repo: 'x/y',
      raw: {
        number: 1,
        html_url: 'https://github.com/x/y/issues/1',
        title: 'Closed',
        body: '',
        created_at: '2026-04-20T00:00:00.000Z',
        updated_at: '2026-04-21T00:00:00.000Z',
        state: 'closed',
        state_reason: 'completed',
      },
    });
    const pr = normalizeGitHubIssue({
      sourceKey: 'github:x/y',
      repo: 'x/y',
      raw: {
        number: 2,
        html_url: 'https://github.com/x/y/pull/2',
        title: 'PR',
        body: '',
        created_at: '2026-04-20T00:00:00.000Z',
        updated_at: '2026-04-21T00:00:00.000Z',
        state: 'open',
        pull_request: {},
      },
    });

    expect(closed?.referenceOnly).toBe(true);
    expect(pr).toBeNull();
  });

  it('normalizes comments as first-class replies', () => {
    const reply = normalizeGitHubComment({
      id: 901001,
      body: 'Can you share details?',
      user: { login: 'support-engineer' },
      created_at: '2026-04-23T09:11:30.000Z',
      updated_at: '2026-04-23T09:11:30.000Z',
      author_association: 'MEMBER',
    });

    expect(reply.sourceReplyId).toBe('901001');
    expect(reply.metadata.authorAssociation).toBe('MEMBER');
  });
});
