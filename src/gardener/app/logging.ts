import type { WebhookHandlingResult } from './webhooks.js';

export interface WebhookDecisionLogEntry {
  event: 'github_webhook_processed' | 'github_webhook_skipped';
  deliveryId: string;
  runId: string | null;
  decisionType: string | null;
  repo: string | null;
  issueNumber?: number;
  pullRequestNumber?: number;
  mode?: 'noop' | 'live';
  eventType?: string;
  reasons: string[];
}

export function buildWebhookDecisionLogEntry(args: {
  deliveryId: string;
  result: WebhookHandlingResult;
}): WebhookDecisionLogEntry {
  const { result } = args;
  const entry: WebhookDecisionLogEntry = {
    event: result.status === 'processed' ? 'github_webhook_processed' : 'github_webhook_skipped',
    deliveryId: args.deliveryId,
    runId: result.runId,
    decisionType: result.decision?.type ?? null,
    repo: repoFromDecision(result.decision),
    reasons: result.reasons,
  };

  if (result.decision?.type === 'comment_on_issue') entry.issueNumber = result.decision.issue.issueNumber;
  if (result.decision?.type === 'review_pull_request') {
    entry.pullRequestNumber = result.decision.pullRequest.pullRequestNumber;
    entry.mode = result.decision.mode;
    entry.eventType = result.decision.eventType;
  }

  return entry;
}

export function writeStructuredLog(entry: unknown): void {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

function repoFromDecision(decision: WebhookHandlingResult['decision']): string | null {
  if (!decision) return null;
  if (decision.type === 'update_report') return decision.report.repo.fullName;
  if (decision.type === 'comment_on_issue') return decision.issue.fullName;
  if (decision.type === 'review_pull_request') return decision.pullRequest.fullName;
  return null;
}
