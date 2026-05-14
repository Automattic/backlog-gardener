import { describe, expect, it } from 'vitest';

import { parseGitHubAppConfig } from '../../src/gardener/app/config.js';
import { runScheduledReportSweep } from '../../src/gardener/app/scheduler.js';
import { InMemoryAppStateStore } from '../../src/gardener/app/state.js';
import type { GitHubCommentSummary, GitHubAppClient, GitHubIssueSummary } from '../../src/gardener/app/publisher.js';
import type { RepoRef } from '../../src/gardener/app/types.js';

class MockGitHubAppClient implements GitHubAppClient {
  issues: GitHubIssueSummary[] = [];
  comments = new Map<number, GitHubCommentSummary[]>();

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
    const comment = { id: 100 + (this.comments.get(args.issueNumber)?.length ?? 0), body: args.body };
    this.comments.set(args.issueNumber, [...(this.comments.get(args.issueNumber) ?? []), comment]);
    return comment;
  }

  async updateIssueComment(args: { commentId: number; body: string }): Promise<GitHubCommentSummary> {
    return { id: args.commentId, body: args.body };
  }
}

const repo: RepoRef = {
  installationId: 1,
  owner: 'example-org',
  repo: 'example-product',
  fullName: 'example-org/example-product',
};

describe('runScheduledReportSweep', () => {
  it('publishes a report through the GitHub client when enabled', async () => {
    const client = new MockGitHubAppClient();
    const result = await runScheduledReportSweep({
      repo,
      config: parseGitHubAppConfig('enabled: true'),
      state: new InMemoryAppStateStore(),
      client,
    });

    expect(result.published).toBe(true);
    expect(client.issues[0]?.title).toBe('🌱 Backlog Gardener Report');
    expect(client.comments.get(1)?.[0]?.body).toContain('No eligible actions were found');
  });

  it('does not publish when config is disabled', async () => {
    const client = new MockGitHubAppClient();
    const result = await runScheduledReportSweep({
      repo,
      config: parseGitHubAppConfig(null),
      state: new InMemoryAppStateStore(),
      client,
    });

    expect(result.published).toBe(false);
    expect(result.reasons).toContain('config_disabled');
    expect(client.issues).toHaveLength(0);
  });
});
