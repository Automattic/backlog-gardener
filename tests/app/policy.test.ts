import { describe, expect, it } from 'vitest';

import { parseGitHubAppConfig } from '../../src/gardener/app/config.js';
import { evaluateDecisionPolicy } from '../../src/gardener/app/policy.js';
import type { AppDecision, IssueRef } from '../../src/gardener/app/types.js';

const issue: IssueRef = {
  installationId: 1,
  owner: 'example-org',
  repo: 'example-product',
  fullName: 'example-org/example-product',
  issueNumber: 123,
};

describe('evaluateDecisionPolicy', () => {
  it('treats do_nothing as a safe denied publication', () => {
    const policy = evaluateDecisionPolicy(
      { type: 'do_nothing', reason: 'not useful' },
      parseGitHubAppConfig('enabled: true'),
    );

    expect(policy.allowed).toBe(false);
    expect(policy.reasons).toContain('decision_is_do_nothing');
  });

  it('allows report updates when enabled', () => {
    const config = parseGitHubAppConfig('enabled: true');
    const decision: AppDecision = {
      type: 'update_report',
      report: {
        repo: issue,
        title: 'report',
        body: 'body',
        decisionCounts: {},
        trigger: 'schedule',
        runId: 'run_1',
      },
    };

    expect(evaluateDecisionPolicy(decision, config).allowed).toBe(true);
  });

  it('denies issue comments by default', () => {
    const decision: AppDecision = {
      type: 'comment_on_issue',
      issue,
      marker: { type: 'needs-info', version: 1 },
      body: 'please add details',
      confidence: 'high',
    };

    const policy = evaluateDecisionPolicy(decision, parseGitHubAppConfig('enabled: true'));

    expect(policy.allowed).toBe(false);
    expect(policy.reasons).toContain('mode_does_not_allow_issue_comments');
    expect(policy.reasons).toContain('issue_comments_disabled');
  });

  it('allows explicitly enabled high-confidence comments when gates pass', () => {
    const config = parseGitHubAppConfig(`
enabled: true
mode: suggest-comments
issues:
  enabled: true
  comments:
    enabled: true
actions:
  issueComments: true
`);
    const decision: AppDecision = {
      type: 'comment_on_issue',
      issue,
      marker: { type: 'needs-info', version: 1 },
      body: 'please add details',
      confidence: 'high',
    };

    expect(evaluateDecisionPolicy(decision, config).allowed).toBe(true);
  });

  it('allows no-op PR review dispatch when PR reviews are enabled', () => {
    const config = parseGitHubAppConfig(`
enabled: true
prReviews:
  enabled: true
`);
    const policy = evaluateDecisionPolicy(
      {
        type: 'review_pull_request',
        pullRequest: { ...issue, pullRequestNumber: 12, draft: false, authorLogin: 'contributor' },
        eventType: 'backlog-gardener.pr-review',
        mode: 'noop',
        reason: 'pull request opened',
      },
      config,
    );

    expect(policy.allowed).toBe(true);
  });

  it('denies PR review dispatch by default and excludes drafts', () => {
    const policy = evaluateDecisionPolicy(
      {
        type: 'review_pull_request',
        pullRequest: { ...issue, pullRequestNumber: 12, draft: true, authorLogin: 'contributor' },
        eventType: 'backlog-gardener.pr-review',
        mode: 'noop',
        reason: 'pull request opened',
      },
      parseGitHubAppConfig('enabled: true'),
    );

    expect(policy.allowed).toBe(false);
    expect(policy.reasons).toContain('pr_reviews_disabled');
    expect(policy.reasons).toContain('draft_pr_excluded');
  });

  it('denies live PR review dispatch unless liveMode is enabled', () => {
    const config = parseGitHubAppConfig(`
enabled: true
prReviews:
  enabled: true
`);
    const policy = evaluateDecisionPolicy(
      {
        type: 'review_pull_request',
        pullRequest: { ...issue, pullRequestNumber: 12, draft: false, authorLogin: 'contributor' },
        eventType: 'backlog-gardener.pr-review',
        mode: 'live',
        reason: 'pull request opened',
      },
      config,
    );

    expect(policy.allowed).toBe(false);
    expect(policy.reasons).toContain('pr_review_live_mode_disabled');
  });

  it('denies comments with protected labels and existing markers', () => {
    const config = parseGitHubAppConfig(`
enabled: true
mode: suggest-comments
actions:
  issueComments: true
`);
    const decision: AppDecision = {
      type: 'comment_on_issue',
      issue,
      marker: { type: 'duplicate', version: 1 },
      body: 'duplicate',
      confidence: 'high',
    };

    const policy = evaluateDecisionPolicy(decision, config, {
      labels: ['Security'],
      existingMarkers: ['duplicate'],
    });

    expect(policy.allowed).toBe(false);
    expect(policy.reasons).toContain('issue_has_ignored_or_protected_label');
    expect(policy.reasons).toContain('marker_already_exists');
  });
});
