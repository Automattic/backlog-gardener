import { appendBotMarker, REPORT_MARKER } from './markers.js';
import type { AppDecision, AppTrigger, RepoRef } from './types.js';

export interface DecisionInput {
  repo: RepoRef;
  productSlug: string;
  runId: string;
  trigger: AppTrigger;
  eventName: string;
  issueNumber?: number;
  issueTitle?: string;
  issueUrl?: string;
  pullRequest?: {
    number: number;
    url?: string;
    draft: boolean;
    authorLogin: string | null;
    headSha?: string;
  };
  prReviewEventType?: string;
  prReviewLiveMode?: boolean;
}

export function decideFromWebhook(input: DecisionInput): AppDecision {
  if (input.pullRequest) {
    return {
      type: 'review_pull_request',
      pullRequest: {
        ...input.repo,
        pullRequestNumber: input.pullRequest.number,
        draft: input.pullRequest.draft,
        authorLogin: input.pullRequest.authorLogin,
        ...(input.pullRequest.url ? { url: input.pullRequest.url } : {}),
        ...(input.pullRequest.headSha ? { headSha: input.pullRequest.headSha } : {}),
      },
      eventType: input.prReviewEventType ?? 'backlog-gardener.pr-review',
      mode: input.prReviewLiveMode ? 'live' : 'noop',
      reason: `pull request ${input.eventName}`,
    };
  }
  if (!input.issueNumber) return { type: 'do_nothing', reason: 'event_has_no_issue_context' };
  return {
    type: 'comment_on_issue',
    issue: {
      ...input.repo,
      issueNumber: input.issueNumber,
      ...(input.issueUrl ? { url: input.issueUrl } : {}),
    },
    marker: { type: 'summary', version: 1 },
    confidence: 'high',
    body: [
      '🌱 **Backlog Gardener issue test**',
      '',
      `Received \`${input.eventName}\` for this issue.`,
      '',
      input.issueTitle ? `Issue: **${input.issueTitle}**` : null,
      '',
      '_This is a test comment from the Backlog Gardener GitHub App._',
    ]
      .filter((line): line is string => line !== null)
      .join('\n'),
  };
}

export function buildEmptyReportDecision(input: {
  repo: RepoRef;
  productName: string;
  runId: string;
  trigger: AppTrigger;
  reportTitle: string;
}): AppDecision {
  const body = appendBotMarker(
    [
      `# 🌱 Backlog Gardener Report — ${input.productName}`,
      '',
      `Repository: \`${input.repo.fullName}\``,
      `Run: \`${input.runId}\``,
      `Trigger: \`${input.trigger}\``,
      '',
      'No eligible actions were found for this run.',
    ].join('\n'),
    REPORT_MARKER,
  );
  return {
    type: 'update_report',
    report: {
      repo: input.repo,
      title: input.reportTitle,
      body,
      decisionCounts: { do_nothing: 1 },
      trigger: input.trigger,
      runId: input.runId,
    },
  };
}
