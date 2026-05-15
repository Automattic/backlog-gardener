import type { GitHubAppConfig } from './config.js';
import { decideFromWebhook } from './decision.js';
import { evaluateDecisionPolicy } from './policy.js';
import type { AppStateStore } from './state.js';
import type { AppDecision, RepoRef } from './types.js';

export interface GitHubWebhookPayload {
  action?: string;
  installation?: { id?: number };
  repository?: { name?: string; full_name?: string; owner?: { login?: string } };
  issue?: {
    number?: number;
    title?: string;
    html_url?: string;
    labels?: Array<{ name?: string } | string>;
    pull_request?: unknown;
  };
  comment?: {
    body?: string;
    user?: { login?: string; type?: string } | null;
    author_association?: string;
  };
  pull_request?: {
    number?: number;
    html_url?: string;
    draft?: boolean;
    user?: { login?: string } | null;
    labels?: Array<{ name?: string } | string>;
    head?: { sha?: string };
  };
}

export interface HandleWebhookArgs {
  eventName: string;
  deliveryId: string;
  payload: GitHubWebhookPayload;
  config: GitHubAppConfig;
  state: AppStateStore;
  decide?: (input: Parameters<typeof decideFromWebhook>[0]) => AppDecision;
}

export interface WebhookHandlingResult {
  status: 'processed' | 'skipped';
  runId: string | null;
  decision: AppDecision | null;
  reasons: string[];
}

const SUPPORTED_ISSUE_ACTIONS = new Set(['opened', 'edited', 'reopened']);
const SUPPORTED_PULL_REQUEST_ACTIONS = new Set(['opened', 'ready_for_review', 'synchronize']);

export function handleGitHubWebhook(args: HandleWebhookArgs): WebhookHandlingResult {
  if (args.state.hasProcessedDelivery(args.deliveryId)) {
    return { status: 'skipped', runId: null, decision: null, reasons: ['duplicate_delivery'] };
  }
  args.state.recordDelivery(args.deliveryId);

  const repo = repoRefFromPayload(args.payload);
  if (!repo) return { status: 'skipped', runId: null, decision: null, reasons: ['missing_repo_or_installation'] };

  const eventAction = args.payload.action ?? '';
  if (!isSupportedEvent(args.eventName, eventAction, args.config)) {
    return { status: 'skipped', runId: null, decision: null, reasons: ['unsupported_event'] };
  }

  const run = args.state.startRun({
    installationId: repo.installationId,
    repo: repo.fullName,
    productSlug: args.config.product.slug,
    trigger: 'webhook',
    eventName: `${args.eventName}.${eventAction}`,
    deliveryId: args.deliveryId,
  });

  const decision = (args.decide ?? decideFromWebhook)({
    repo,
    productSlug: args.config.product.slug,
    runId: run.id,
    trigger: 'webhook',
    eventName: `${args.eventName}.${eventAction}`,
    ...(args.payload.issue?.number ? { issueNumber: args.payload.issue.number } : {}),
    ...(args.payload.issue?.title ? { issueTitle: args.payload.issue.title } : {}),
    ...(args.payload.issue?.html_url ? { issueUrl: args.payload.issue.html_url } : {}),
    ...(args.payload.pull_request?.number
      ? {
          pullRequest: {
            number: args.payload.pull_request.number,
            draft: args.payload.pull_request.draft ?? false,
            authorLogin: args.payload.pull_request.user?.login ?? null,
            ...(args.payload.pull_request.html_url ? { url: args.payload.pull_request.html_url } : {}),
            ...(args.payload.pull_request.head?.sha ? { headSha: args.payload.pull_request.head.sha } : {}),
          },
          prReviewEventType: args.config.prReviews.eventType,
          prReviewLiveMode: args.config.prReviews.liveMode,
        }
      : {}),
  });

  const policy = evaluateDecisionPolicy(decision, args.config, {
    labels: labelsFromPayload(args.payload),
    cooldownActive: prReviewAlreadyRecorded({ decision, state: args.state }),
  });

  args.state.recordDecision({
    runId: run.id,
    repo: repo.fullName,
    issueNumber: args.payload.issue?.number ?? args.payload.pull_request?.number ?? null,
    decisionType: decision.type,
    confidence: decision.type === 'comment_on_issue' ? decision.confidence : null,
    marker:
      decision.type === 'comment_on_issue' ? decision.marker.type : decision.type === 'update_report' ? 'report' : null,
    policyAllowed: policy.allowed,
    policyReasons: policy.reasons,
  });
  args.state.completeRun(run.id, 'completed');
  return { status: 'processed', runId: run.id, decision, reasons: policy.reasons };
}

function isSupportedEvent(eventName: string, action: string, config: GitHubAppConfig): boolean {
  if (eventName === 'installation' || eventName === 'installation_repositories') return true;
  if (eventName === 'issues') return SUPPORTED_ISSUE_ACTIONS.has(action);
  if (eventName === 'pull_request')
    return SUPPORTED_PULL_REQUEST_ACTIONS.has(action) && prReviewTriggerEnabled(action, config);
  return false;
}

function repoRefFromPayload(payload: GitHubWebhookPayload): RepoRef | null {
  const installationId = payload.installation?.id;
  const fullName = payload.repository?.full_name;
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  if (!installationId || !fullName || !owner || !repo) return null;
  return { installationId, owner, repo, fullName };
}

function labelsFromPayload(payload: GitHubWebhookPayload): string[] {
  return [...(payload.issue?.labels ?? []), ...(payload.pull_request?.labels ?? [])].flatMap((label) => {
    if (typeof label === 'string') return [label];
    return label.name ? [label.name] : [];
  });
}

function prReviewAlreadyRecorded(args: { decision: AppDecision; state: AppStateStore }): boolean {
  if (args.decision.type !== 'review_pull_request' || !args.decision.pullRequest.headSha) return false;
  return args.state.hasReviewedPullRequest({
    installationId: args.decision.pullRequest.installationId,
    repo: args.decision.pullRequest.fullName,
    pullRequestNumber: args.decision.pullRequest.pullRequestNumber,
    headSha: args.decision.pullRequest.headSha,
  });
}

function prReviewTriggerEnabled(action: string, config: GitHubAppConfig): boolean {
  if (action === 'opened') return config.prReviews.triggers.opened;
  if (action === 'ready_for_review') return config.prReviews.triggers.readyForReview;
  if (action === 'synchronize') return config.prReviews.triggers.synchronize;
  return false;
}
