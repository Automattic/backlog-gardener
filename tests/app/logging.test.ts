import { describe, expect, it } from 'vitest';

import { buildWebhookDecisionLogEntry } from '../../src/gardener/app/logging.js';
import type { WebhookHandlingResult } from '../../src/gardener/app/webhooks.js';

describe('buildWebhookDecisionLogEntry', () => {
  it('formats no-op PR review dispatch decisions for safe webhook testing', () => {
    const result: WebhookHandlingResult = {
      status: 'processed',
      runId: 'run-1',
      reasons: ['allowed'],
      decision: {
        type: 'review_pull_request',
        eventType: 'backlog-gardener.pr-review',
        mode: 'noop',
        reason: 'pull request pull_request.opened',
        pullRequest: {
          installationId: 42,
          owner: 'example-user',
          repo: 'example-repo',
          fullName: 'example-user/example-repo',
          pullRequestNumber: 7,
          draft: false,
          authorLogin: 'contributor',
        },
      },
    };

    expect(buildWebhookDecisionLogEntry({ deliveryId: 'delivery-1', result })).toEqual({
      event: 'github_webhook_processed',
      deliveryId: 'delivery-1',
      runId: 'run-1',
      decisionType: 'review_pull_request',
      repo: 'example-user/example-repo',
      pullRequestNumber: 7,
      mode: 'noop',
      eventType: 'backlog-gardener.pr-review',
      reasons: ['allowed'],
    });
  });

  it('formats skipped webhook deliveries', () => {
    expect(
      buildWebhookDecisionLogEntry({
        deliveryId: 'delivery-2',
        result: { status: 'skipped', runId: null, decision: null, reasons: ['duplicate_delivery'] },
      }),
    ).toEqual({
      event: 'github_webhook_skipped',
      deliveryId: 'delivery-2',
      runId: null,
      decisionType: null,
      repo: null,
      reasons: ['duplicate_delivery'],
    });
  });
});
