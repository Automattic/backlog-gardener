import { describe, expect, it } from 'vitest';

import { DEFAULT_GITHUB_APP_CONFIG } from '../../src/gardener/app/config.js';
import {
  enrichDecisionWithInvestigation,
  enrichDecisionWithInvestigationResult,
  generateIssueInvestigationComment,
  generatePullRequestReviewBody,
} from '../../src/gardener/app/investigation.js';
import type { GitHubAppClient } from '../../src/gardener/app/publisher.js';
import type { AppDecision, RepoRef } from '../../src/gardener/app/types.js';
import type { CompletionProvider } from '../../src/gardener/llm/provider.js';

class FakeProvider implements CompletionProvider {
  readonly name = 'fake';
  readonly model = 'fake';
  readonly thinkingEffort = undefined;

  async complete<T>(args: { promptId: string }): Promise<{
    output: T;
    model: string;
    usage: { inputTokens: number; outputTokens: number };
  }> {
    const outputs: Record<string, unknown> = {
      analyze: {
        decision: 'needs-info',
        sourceType: 'github_issue',
        shortTitle: 'Checkout fails',
        summary: 'Checkout fails with a validation error.',
        novelty: 'new',
        bestSolution: 'Collect the exact validation error and inspect checkout validation handling.',
        risks: [],
        confidence: 'medium',
        evidence: [
          {
            label: 'Source report',
            detail: 'Reporter says checkout fails with a validation error.',
            sourceUrl: 'https://github.com/o/r/issues/2',
            quote: 'Checkout fails with a validation error.',
          },
        ],
        relatedLinks: [],
        reason: 'The issue has a plausible failure mode but lacks exact error details.',
      },
      evaluate: {
        action: 'request_more_info',
        confidence: 'medium',
        reason: 'The report needs the exact validation error and environment details.',
        developerSummary: 'Checkout save fails with a validation error.',
        recommendedNextStep: 'Ask for exact error text, environment, and reproduction details.',
        proposedExternalComment: 'Please provide the exact validation error and relevant environment details.',
        requiresHumanApproval: true,
        riskFlags: ['external-comment-draft'],
      },
      verify: {
        action: 'needs_code_context',
        confidence: 'low',
        subsystem: 'Checkout/settings validation',
        likelyFiles: [],
        hypotheses: ['A validation schema rejects the test-mode setting payload.'],
        suggestedReproSteps: ['Toggle test mode, save settings, and capture the validation error.'],
        suggestedTests: ['Add a regression test for saving test-mode settings.'],
        developerNotes: 'No local code context was provided.',
        requiresHumanApproval: false,
      },
      'app-pr-review': {
        summary: 'Generated PR review summary.',
        riskAssessment: ['Risk one.'],
        verification: ['Run test one.'],
        questions: [],
      },
    };
    return { output: outputs[args.promptId] as T, model: this.model, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

const client: GitHubAppClient = {
  async listIssues() {
    return [];
  },
  async createIssue() {
    throw new Error('not used');
  },
  async getIssue() {
    return {
      number: 2,
      title: 'Checkout fails',
      state: 'open',
      body: 'Checkout fails with a validation error.',
      url: 'https://github.com/o/r/issues/2',
      authorLogin: 'merchant',
      labels: ['bug'],
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
      authorAssociation: 'NONE',
    };
  },
  async listIssueComments() {
    return [
      {
        id: 1,
        body: 'I can reproduce this too.',
        user: { login: 'other-merchant' },
        createdAt: '2026-05-14T00:01:00.000Z',
        updatedAt: '2026-05-14T00:01:00.000Z',
        authorAssociation: 'NONE',
      },
    ];
  },
  async createIssueComment() {
    throw new Error('not used');
  },
  async updateIssueComment() {
    throw new Error('not used');
  },
  async fetchTextFile(args: { path: string }) {
    return args.path === '.gardener.md' ? 'Project guidance: avoid asking questions answered by config files.' : null;
  },
  async getPullRequest() {
    return {
      number: 1,
      title: 'Fix checkout validation',
      body: 'Fixes validation.',
      url: 'https://github.com/o/r/pull/1',
      draft: false,
      authorLogin: 'dev',
      baseRef: 'main',
      headRef: 'fix-validation',
      headSha: 'abc123',
    };
  },
  async listPullRequestFiles() {
    return [
      {
        filename: 'src/checkout.ts',
        status: 'modified',
        additions: 10,
        deletions: 2,
        changes: 12,
        patch: '@@ -1 +1 @@\n-old\n+new',
      },
    ];
  },
};

const repo: RepoRef = { installationId: 1, owner: 'o', repo: 'r', fullName: 'o/r' };

describe('app investigation generation', () => {
  it('generates issue investigation comments through the existing analysis/evaluation/verification pipeline', async () => {
    const body = await generateIssueInvestigationComment({
      client,
      provider: new FakeProvider(),
      config: DEFAULT_GITHUB_APP_CONFIG,
      owner: 'o',
      repo: 'r',
      issueNumber: 2,
    });

    expect(body).toContain('Backlog Gardener automated investigation');
    expect(body).toContain('**Decision:** request_more_info');
    expect(body).toContain('Likely area / files');
    expect(body).toContain('Suggested reproduction checks');
  });

  it('returns persisted-artifact details when issue comments are suppressed', async () => {
    const maintainerClient: GitHubAppClient = {
      ...client,
      async getIssue() {
        return {
          number: 2,
          title: 'Checkout fails',
          state: 'open',
          body: 'Checkout fails with a validation error.',
          url: 'https://github.com/o/r/issues/2',
          authorLogin: 'maintainer',
          labels: ['bug'],
          createdAt: '2026-05-14T00:00:00.000Z',
          updatedAt: '2026-05-14T00:00:00.000Z',
          authorAssociation: 'OWNER',
        };
      },
    };
    const decision: AppDecision = {
      type: 'comment_on_issue',
      issue: { ...repo, issueNumber: 2 },
      marker: { type: 'summary', version: 1 },
      confidence: 'high',
      body: 'placeholder',
    };

    const result = await enrichDecisionWithInvestigationResult({
      decision,
      client: maintainerClient,
      provider: new FakeProvider(),
      config: DEFAULT_GITHUB_APP_CONFIG,
    });

    expect(result.decision).toEqual({ type: 'do_nothing', reason: 'maintainer_activity_active' });
    expect(result.artifact).toEqual(
      expect.objectContaining({
        subjectType: 'issue',
        subjectNumber: 2,
        status: 'suppressed',
        suppressionReason: 'maintainer_activity_active',
        generatedBody: null,
      }),
    );
    expect(result.artifact?.details).toEqual(
      expect.objectContaining({
        evaluation: expect.objectContaining({ action: 'defer_because_already_active' }),
        attentionFacts: expect.objectContaining({
          maintainerActivity: expect.objectContaining({ status: 'active' }),
        }),
      }),
    );
  });

  it('generates PR review bodies with the completion provider', async () => {
    await expect(
      generatePullRequestReviewBody({
        client,
        provider: new FakeProvider(),
        owner: 'o',
        repo: 'r',
        pullNumber: 1,
      }),
    ).resolves.toContain('## Summary');
  });

  it('enriches app decisions before publishing', async () => {
    const decision: AppDecision = {
      type: 'review_pull_request',
      pullRequest: { ...repo, pullRequestNumber: 1, draft: false, authorLogin: 'dev' },
      eventType: 'backlog-gardener.pr-review',
      mode: 'live',
      reason: 'pull request pull_request.opened',
    };

    await expect(
      enrichDecisionWithInvestigation({
        decision,
        client,
        provider: new FakeProvider(),
        config: DEFAULT_GITHUB_APP_CONFIG,
      }),
    ).resolves.toEqual({
      ...decision,
      reviewBody: expect.stringContaining('## Risk assessment'),
    });
  });

  it('returns persisted-artifact details for generated PR reviews', async () => {
    const decision: AppDecision = {
      type: 'review_pull_request',
      pullRequest: { ...repo, pullRequestNumber: 1, draft: false, authorLogin: 'dev' },
      eventType: 'backlog-gardener.pr-review',
      mode: 'live',
      reason: 'pull request pull_request.opened',
    };

    const result = await enrichDecisionWithInvestigationResult({
      decision,
      client,
      provider: new FakeProvider(),
      config: DEFAULT_GITHUB_APP_CONFIG,
    });

    expect(result.decision).toEqual({ ...decision, reviewBody: expect.stringContaining('## Risk assessment') });
    expect(result.artifact).toEqual(
      expect.objectContaining({
        subjectType: 'pull_request',
        subjectNumber: 1,
        status: 'review_ready',
        suppressionReason: null,
        generatedBody: expect.stringContaining('Backlog Gardener automated PR review'),
      }),
    );
    expect(result.artifact?.details).toEqual(
      expect.objectContaining({
        output: expect.objectContaining({ summary: 'Generated PR review summary.' }),
        files: [expect.objectContaining({ filename: 'src/checkout.ts' })],
      }),
    );
  });
});
