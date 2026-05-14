import { describe, expect, it } from 'vitest';

import {
  publishDecision,
  publishReport,
  type GitHubCommentSummary,
  type GitHubAppClient,
  type GitHubIssueSummary,
} from '../../src/gardener/app/publisher.js';
import { InMemoryAppStateStore } from '../../src/gardener/app/state.js';
import type { RepoRef } from '../../src/gardener/app/types.js';

class MockGitHubAppClient implements GitHubAppClient {
  issues: GitHubIssueSummary[] = [];
  comments = new Map<number, GitHubCommentSummary[]>();
  updatedComments: Array<{ commentId: number; body: string }> = [];
  dispatches: Array<{ eventType: string; clientPayload: Record<string, unknown> }> = [];
  pullRequestReviews: Array<{ pullNumber: number; body: string; event: 'COMMENT' }> = [];

  async listIssues(): Promise<GitHubIssueSummary[]> {
    return this.issues;
  }

  async createIssue(args: { title: string }): Promise<GitHubIssueSummary> {
    const issue = { number: this.issues.length + 1, title: args.title, state: 'open' as const };
    this.issues.push(issue);
    return issue;
  }

  async listIssueComments(args: { issueNumber: number }): Promise<GitHubCommentSummary[]> {
    return this.comments.get(args.issueNumber) ?? [];
  }

  async createIssueComment(args: { issueNumber: number; body: string }): Promise<GitHubCommentSummary> {
    const comment = { id: (this.comments.get(args.issueNumber)?.length ?? 0) + 100, body: args.body };
    this.comments.set(args.issueNumber, [...(this.comments.get(args.issueNumber) ?? []), comment]);
    return comment;
  }

  async updateIssueComment(args: { commentId: number; body: string }): Promise<GitHubCommentSummary> {
    this.updatedComments.push({ commentId: args.commentId, body: args.body });
    return { id: args.commentId, body: args.body };
  }

  async createRepositoryDispatch(args: { eventType: string; clientPayload: Record<string, unknown> }): Promise<void> {
    this.dispatches.push({ eventType: args.eventType, clientPayload: args.clientPayload });
  }

  async createPullRequestReview(args: {
    pullNumber: number;
    body: string;
    event: 'COMMENT';
  }): Promise<{ id: number; body: string }> {
    this.pullRequestReviews.push(args);
    return { id: this.pullRequestReviews.length + 500, body: args.body };
  }
}

const repo: RepoRef = {
  installationId: 1,
  owner: 'example-org',
  repo: 'example-product',
  fullName: 'example-org/example-product',
};

describe('publishReport', () => {
  it('creates a report issue and marker comment on first publish', async () => {
    const client = new MockGitHubAppClient();
    const state = new InMemoryAppStateStore();

    const result = await publishReport({
      client,
      state,
      report: {
        repo,
        title: '🌱 Backlog Gardener Report',
        body: 'No eligible actions.',
        decisionCounts: {},
        trigger: 'schedule',
        runId: 'run_1',
      },
    });

    expect(result.issueNumber).toBe(1);
    expect(client.comments.get(1)?.[0]?.body).toContain('<!-- backlog-gardener:report:v1 -->');
  });

  it('updates the stored report comment on later publishes', async () => {
    const client = new MockGitHubAppClient();
    const state = new InMemoryAppStateStore();

    await publishReport({
      client,
      state,
      report: { repo, title: 'Report', body: 'First', decisionCounts: {}, trigger: 'schedule', runId: 'run_1' },
    });
    await publishReport({
      client,
      state,
      report: { repo, title: 'Report', body: 'Second', decisionCounts: {}, trigger: 'schedule', runId: 'run_2' },
    });

    expect(client.updatedComments).toHaveLength(1);
    expect(client.updatedComments[0]?.body).toContain('Second');
  });
});

describe('publishDecision issue comments', () => {
  it('updates an existing marked issue comment instead of creating duplicates', async () => {
    const client = new MockGitHubAppClient();
    client.comments.set(123, [{ id: 200, body: 'Old\n<!-- backlog-gardener:summary:v1 -->' }]);

    const result = await publishDecision({
      client,
      state: new InMemoryAppStateStore(),
      decision: {
        type: 'comment_on_issue',
        issue: { ...repo, issueNumber: 123 },
        marker: { type: 'summary', version: 1 },
        confidence: 'high',
        body: 'Updated context',
      },
    });

    expect(result).toBe('published');
    expect(client.updatedComments).toEqual([
      expect.objectContaining({ commentId: 200, body: expect.stringContaining('Updated context') }),
    ]);
    expect(client.comments.get(123)).toHaveLength(1);
  });
});

describe('publishDecision PR reviews', () => {
  it('skips no-op PR review dispatches', async () => {
    const client = new MockGitHubAppClient();
    const result = await publishDecision({
      client,
      state: new InMemoryAppStateStore(),
      decision: {
        type: 'review_pull_request',
        pullRequest: { ...repo, pullRequestNumber: 123, draft: false, authorLogin: 'contributor' },
        eventType: 'backlog-gardener.pr-review',
        mode: 'noop',
        reason: 'pull request opened',
      },
    });

    expect(result).toBe('skipped');
    expect(client.dispatches).toHaveLength(0);
  });

  it('publishes live PR review decisions as pull request reviews', async () => {
    const client = new MockGitHubAppClient();
    const result = await publishDecision({
      client,
      state: new InMemoryAppStateStore(),
      decision: {
        type: 'review_pull_request',
        pullRequest: { ...repo, pullRequestNumber: 123, draft: false, authorLogin: 'contributor' },
        eventType: 'backlog-gardener.pr-review',
        mode: 'live',
        reason: 'pull request opened',
      },
    });

    expect(result).toBe('published');
    expect(client.dispatches).toHaveLength(0);
    expect(client.comments.get(123)).toBeUndefined();
    expect(client.pullRequestReviews).toEqual([
      expect.objectContaining({
        pullNumber: 123,
        event: 'COMMENT',
        body: expect.stringContaining('Backlog Gardener PR review test'),
      }),
    ]);
  });
});
