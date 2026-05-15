import { describe, expect, it } from 'vitest';

import { SqliteAppStateStore } from '../../src/gardener/app/state.js';
import { StoreDb } from '../../src/gardener/store/db.js';

describe('SqliteAppStateStore', () => {
  it('persists deliveries, decisions, comments, cooldowns, and PR reviews', () => {
    const db = new StoreDb(':memory:');
    const state = new SqliteAppStateStore(db.db);

    expect(state.hasProcessedDelivery('delivery-1')).toBe(false);
    state.recordDelivery('delivery-1');
    expect(state.hasProcessedDelivery('delivery-1')).toBe(true);

    const job = state.enqueueJob({
      deliveryId: 'delivery-1',
      eventName: 'issues.opened',
      repo: 'o/r',
      payloadJson: '{"ok":true}',
    });
    expect(
      state.enqueueJob({ deliveryId: 'delivery-1', eventName: 'issues.opened', repo: 'o/r', payloadJson: '{}' }).id,
    ).toBe(job.id);
    state.startJob(job.id);
    state.completeJob(job.id, 'completed');

    const run = state.startRun({
      installationId: 1,
      repo: 'o/r',
      productSlug: 'test',
      trigger: 'webhook',
      eventName: 'issues.opened',
      deliveryId: 'delivery-1',
    });
    state.recordDecision({
      runId: run.id,
      repo: 'o/r',
      issueNumber: 2,
      decisionType: 'comment_on_issue',
      confidence: 'high',
      marker: 'summary',
      policyAllowed: true,
      policyReasons: ['allowed'],
    });
    expect(state.listDecisions(run.id)[0]).toEqual(expect.objectContaining({ decisionType: 'comment_on_issue' }));

    const artifact = state.recordInvestigationArtifact({
      jobId: job.id,
      runId: run.id,
      deliveryId: 'delivery-1',
      repo: 'o/r',
      subjectType: 'issue',
      subjectNumber: 2,
      status: 'suppressed',
      suppressionReason: 'maintainer_activity_active',
      publicationStatus: 'skipped',
      generatedBody: null,
      details: { evaluationAction: 'request_more_info' },
    });
    expect(state.listInvestigationArtifacts(run.id)[0]).toEqual(
      expect.objectContaining({ id: artifact.id, suppressionReason: 'maintainer_activity_active' }),
    );
    state.updateInvestigationPublication(artifact.id, 'published');
    expect(state.listInvestigationArtifacts(run.id)[0]?.publicationStatus).toBe('published');

    expect(state.acquireInvestigationLock({ key: 'o/r:issue:2', owner: job.id })).toBe(true);
    expect(state.acquireInvestigationLock({ key: 'o/r:issue:2', owner: 'other-job' })).toBe(false);
    state.releaseInvestigationLock('o/r:issue:2', job.id);
    expect(state.acquireInvestigationLock({ key: 'o/r:issue:2', owner: 'other-job' })).toBe(true);

    state.upsertBotComment({
      installationId: 1,
      repo: 'o/r',
      issueNumber: 2,
      commentId: 123,
      marker: 'summary',
      bodyHash: 'hash',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(state.findBotComment({ installationId: 1, repo: 'o/r', issueNumber: 2, marker: 'summary' })?.commentId).toBe(
      123,
    );

    state.setCooldown({
      installationId: 1,
      repo: 'o/r',
      issueNumber: 2,
      marker: 'summary',
      until: '2999-01-01T00:00:00.000Z',
    });
    expect(state.isCooldownActive({ installationId: 1, repo: 'o/r', issueNumber: 2, marker: 'summary' })).toBe(true);

    expect(state.hasReviewedPullRequest({ installationId: 1, repo: 'o/r', pullRequestNumber: 3, headSha: 'abc' })).toBe(
      false,
    );
    state.recordPullRequestReview({
      installationId: 1,
      repo: 'o/r',
      pullRequestNumber: 3,
      headSha: 'abc',
      reviewId: 99,
    });
    expect(state.hasReviewedPullRequest({ installationId: 1, repo: 'o/r', pullRequestNumber: 3, headSha: 'abc' })).toBe(
      true,
    );
  });
});
