import type { GitHubAppConfig } from './config.js';
import { buildEmptyReportDecision } from './decision.js';
import { evaluateDecisionPolicy } from './policy.js';
import { publishDecision, type GitHubAppClient } from './publisher.js';
import type { AppStateStore } from './state.js';
import type { RepoRef } from './types.js';

export async function runScheduledReportSweep(args: {
  repo: RepoRef;
  config: GitHubAppConfig;
  state: AppStateStore;
  client?: GitHubAppClient;
}): Promise<{ runId: string; published: boolean; reasons: string[] }> {
  const run = args.state.startRun({
    installationId: args.repo.installationId,
    repo: args.repo.fullName,
    productSlug: args.config.product.slug,
    trigger: 'schedule',
    eventName: 'schedule.sweep',
    deliveryId: null,
  });
  const decision = buildEmptyReportDecision({
    repo: args.repo,
    productName: args.config.product.name,
    runId: run.id,
    trigger: 'schedule',
    reportTitle: args.config.report.title,
  });
  const policy = evaluateDecisionPolicy(decision, args.config);
  args.state.recordDecision({
    runId: run.id,
    repo: args.repo.fullName,
    issueNumber: null,
    decisionType: decision.type,
    marker: 'report',
    policyAllowed: policy.allowed,
    policyReasons: policy.reasons,
  });
  if (policy.allowed && args.client) await publishDecision({ client: args.client, state: args.state, decision });
  args.state.completeRun(run.id, 'completed');
  return { runId: run.id, published: policy.allowed && Boolean(args.client), reasons: policy.reasons };
}
