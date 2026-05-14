import { describe, expect, it } from 'vitest';

import { parseGitHubAppConfig } from '../../src/gardener/app/config.js';
import { InMemoryAppStateStore } from '../../src/gardener/app/state.js';
import { handleGitHubWebhook } from '../../src/gardener/app/webhooks.js';

const payload = {
  action: 'opened',
  installation: { id: 42 },
  repository: {
    name: 'example-product',
    full_name: 'example-org/example-product',
    owner: { login: 'example-org' },
  },
  issue: { number: 123, title: 'Bug', labels: [] },
};

const pullRequestPayload = {
  action: 'opened',
  installation: { id: 42 },
  repository: {
    name: 'example-product',
    full_name: 'example-org/example-product',
    owner: { login: 'example-org' },
  },
  pull_request: { number: 456, draft: false, user: { login: 'contributor' } },
};

describe('handleGitHubWebhook', () => {
  it('records supported issue comment decisions', () => {
    const state = new InMemoryAppStateStore();
    const result = handleGitHubWebhook({
      eventName: 'issues',
      deliveryId: 'delivery-1',
      payload,
      config: parseGitHubAppConfig(`
enabled: true
mode: suggest-comments
issues:
  enabled: true
  comments:
    enabled: true
actions:
  issueComments: true
`),
      state,
    });

    expect(result.status).toBe('processed');
    expect(result.runId).toBeTruthy();
    expect(result.decision?.type).toBe('comment_on_issue');
    expect(result.reasons).toContain('allowed');
    expect(state.listDecisions(result.runId ?? '')).toHaveLength(1);
  });

  it('skips duplicate deliveries', () => {
    const state = new InMemoryAppStateStore();
    const args = {
      eventName: 'issues',
      deliveryId: 'delivery-1',
      payload,
      config: parseGitHubAppConfig('enabled: true'),
      state,
    };

    handleGitHubWebhook(args);
    const second = handleGitHubWebhook(args);

    expect(second.status).toBe('skipped');
    expect(second.reasons).toContain('duplicate_delivery');
  });

  it('records no-op PR review dispatch decisions for PR webhooks', () => {
    const state = new InMemoryAppStateStore();
    const result = handleGitHubWebhook({
      eventName: 'pull_request',
      deliveryId: 'delivery-pr-1',
      payload: pullRequestPayload,
      config: parseGitHubAppConfig(`
enabled: true
prReviews:
  enabled: true
`),
      state,
    });

    expect(result.status).toBe('processed');
    expect(result.decision?.type).toBe('review_pull_request');
    expect(result.reasons).toContain('allowed');
    expect(state.listDecisions(result.runId ?? '')[0]?.decisionType).toBe('review_pull_request');
  });

  it('skips already-reviewed PR head SHAs', () => {
    const state = new InMemoryAppStateStore();
    state.recordPullRequestReview({
      installationId: 42,
      repo: 'example-org/example-product',
      pullRequestNumber: 456,
      headSha: 'abc123',
    });
    const result = handleGitHubWebhook({
      eventName: 'pull_request',
      deliveryId: 'delivery-pr-reviewed',
      payload: { ...pullRequestPayload, pull_request: { ...pullRequestPayload.pull_request, head: { sha: 'abc123' } } },
      config: parseGitHubAppConfig(`
enabled: true
prReviews:
  enabled: true
`),
      state,
    });

    expect(result.status).toBe('processed');
    expect(result.reasons).toContain('cooldown_active');
  });

  it('skips disabled PR review triggers', () => {
    const result = handleGitHubWebhook({
      eventName: 'pull_request',
      deliveryId: 'delivery-pr-2',
      payload: { ...pullRequestPayload, action: 'synchronize' },
      config: parseGitHubAppConfig('enabled: true'),
      state: new InMemoryAppStateStore(),
    });

    expect(result.status).toBe('skipped');
    expect(result.reasons).toContain('unsupported_event');
  });

  it('skips issue comment events to avoid bot comment loops', () => {
    const result = handleGitHubWebhook({
      eventName: 'issue_comment',
      deliveryId: 'delivery-comment-1',
      payload: { ...payload, action: 'created' },
      config: parseGitHubAppConfig('enabled: true'),
      state: new InMemoryAppStateStore(),
    });

    expect(result.status).toBe('skipped');
    expect(result.reasons).toContain('unsupported_event');
  });

  it('skips unsupported events', () => {
    const result = handleGitHubWebhook({
      eventName: 'pull_request_review',
      deliveryId: 'delivery-2',
      payload,
      config: parseGitHubAppConfig('enabled: true'),
      state: new InMemoryAppStateStore(),
    });

    expect(result.status).toBe('skipped');
    expect(result.reasons).toContain('unsupported_event');
  });
});
