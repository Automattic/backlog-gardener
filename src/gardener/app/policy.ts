import type { GitHubAppConfig } from './config.js';
import type { AppDecision, BotMarkerType, PolicyResult } from './types.js';

export interface IssuePolicyContext {
  labels?: string[];
  existingMarkers?: BotMarkerType[];
  cooldownActive?: boolean;
  maintainerHandledRecently?: boolean;
  vetoed?: boolean;
  budgetAvailable?: boolean;
  rateLimitAvailable?: boolean;
}

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 } as const;

export function evaluateDecisionPolicy(
  decision: AppDecision,
  config: GitHubAppConfig,
  context: IssuePolicyContext = {},
): PolicyResult {
  const reasons: string[] = [];

  if (!config.enabled) reasons.push('config_disabled');

  if (decision.type === 'do_nothing') {
    return { allowed: false, reasons: [...reasons, 'decision_is_do_nothing'] };
  }

  if (decision.type === 'update_report') {
    if (!config.report.enabled) reasons.push('report_disabled');
    return resultFromReasons(reasons);
  }

  if (decision.type === 'review_pull_request') {
    if (!config.prReviews.enabled) reasons.push('pr_reviews_disabled');
    if (decision.mode === 'live' && !config.prReviews.liveMode) reasons.push('pr_review_live_mode_disabled');
    if (decision.pullRequest.draft && !config.prReviews.includeDrafts) reasons.push('draft_pr_excluded');
    const labels = (context.labels ?? []).map((label) => label.toLowerCase());
    const ignored = [...config.controls.ignoreLabels, ...config.controls.protectedLabels].map((label) =>
      label.toLowerCase(),
    );
    if (ignored.some((label) => labels.includes(label))) reasons.push('pr_has_ignored_or_protected_label');
    if (context.cooldownActive) reasons.push('cooldown_active');
    if (context.budgetAvailable === false) reasons.push('budget_unavailable');
    if (context.rateLimitAvailable === false) reasons.push('rate_limit_unavailable');
    return resultFromReasons(reasons);
  }

  if (decision.type === 'comment_on_issue') {
    if (config.mode !== 'suggest-comments') reasons.push('mode_does_not_allow_issue_comments');
    if (!config.issues.enabled) reasons.push('issues_disabled');
    if (!config.issues.comments.enabled || !config.actions.issueComments) reasons.push('issue_comments_disabled');
    if (!meetsConfidence(decision.confidence, config.thresholds.minCommentConfidence))
      reasons.push('comment_confidence_too_low');
    if (
      decision.marker.type === 'duplicate' &&
      !meetsConfidence(decision.confidence, config.thresholds.minDuplicateConfidence)
    ) {
      reasons.push('duplicate_confidence_too_low');
    }
    const labels = (context.labels ?? []).map((label) => label.toLowerCase());
    const ignored = [...config.controls.ignoreLabels, ...config.controls.protectedLabels].map((label) =>
      label.toLowerCase(),
    );
    if (ignored.some((label) => labels.includes(label))) reasons.push('issue_has_ignored_or_protected_label');
    if ((context.existingMarkers ?? []).includes(decision.marker.type)) reasons.push('marker_already_exists');
    if (context.cooldownActive) reasons.push('cooldown_active');
    if (context.maintainerHandledRecently) reasons.push('maintainer_handled_recently');
    if (context.vetoed) reasons.push('human_veto');
    if (context.budgetAvailable === false) reasons.push('budget_unavailable');
    if (context.rateLimitAvailable === false) reasons.push('rate_limit_unavailable');
    return resultFromReasons(reasons);
  }

  return { allowed: false, reasons: ['unsupported_decision'] };
}

function meetsConfidence(value: 'medium' | 'high', threshold: 'medium' | 'high'): boolean {
  return CONFIDENCE_RANK[value] >= CONFIDENCE_RANK[threshold];
}

function resultFromReasons(reasons: string[]): PolicyResult {
  return { allowed: reasons.length === 0, reasons: reasons.length === 0 ? ['allowed'] : reasons };
}
