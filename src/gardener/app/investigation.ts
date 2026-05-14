import type { AttentionFacts, Finding, Item, Reply } from '../domain.js';
import { evaluateFinding } from '../evaluate/evaluator.js';
import type { EvaluationRecord, VerificationRecord } from '../evaluate/types.js';
import { verifyFinding } from '../evaluate/verifier.js';
import { newId, nowIso } from '../ids.js';
import { loadPromptSchema } from '../llm/prompts.js';
import type { CompletionProvider } from '../llm/provider.js';
import { bodyHash, snapshotHash } from '../normalize/hashes.js';
import { computeAttentionFacts } from '../pipeline/attention.js';
import { decideFinding } from '../pipeline/surfacing.js';
import type { GitHubAppConfig } from './config.js';
import type { GitHubAppClient, GitHubIssueSummary, GitHubPullRequestFileSummary } from './publisher.js';
import type { AppDecision } from './types.js';

interface PrReviewOutput {
  summary: string;
  riskAssessment: string[];
  verification: string[];
  questions: string[];
}

export interface IssueInvestigationResult {
  item: Item;
  replies: Reply[];
  attentionFacts: AttentionFacts;
  finding: Finding;
  evaluation: EvaluationRecord;
  verification: VerificationRecord;
  shouldComment: boolean;
  commentBody: string | null;
}

export async function investigateIssueWithPipeline(args: {
  client: GitHubAppClient;
  provider: CompletionProvider;
  config: GitHubAppConfig;
  owner: string;
  repo: string;
  issueNumber: number;
  codeRoot?: string;
}): Promise<IssueInvestigationResult | null> {
  if (!args.client.getIssue) return null;
  const issue = await args.client.getIssue({ owner: args.owner, repo: args.repo, issueNumber: args.issueNumber });
  const comments = await args.client.listIssueComments({
    owner: args.owner,
    repo: args.repo,
    issueNumber: args.issueNumber,
  });
  const relatedIssues = args.config.issues.includeRelatedIssues
    ? await findRelatedIssues({
        client: args.client,
        owner: args.owner,
        repo: args.repo,
        issue,
      })
    : [];
  const item = githubIssueToItem({ owner: args.owner, repo: args.repo, issue, relatedIssues });
  const replies = comments.map((comment) => githubCommentToReply(item.id, comment));
  const attentionFacts = computeAttentionFacts({
    item,
    replies,
    protectedLabels: args.config.controls.protectedLabels,
    now: new Date(),
    recentMaintainerActivityDays: 14,
    staleMaintainerActivityDays: 90,
  });
  const recapResult = await import('../llm/analyze.js').then(({ analyzeItem }) =>
    analyzeItem({
      item,
      replies,
      attentionFacts,
      productName: args.config.product.name,
      provider: args.provider,
    }),
  );
  const decision = decideFinding({
    recap: recapResult.recap,
    attentionFacts,
    minConfidence: 'medium',
    minRecurrence: 1,
    recurrenceCount: 1,
  });
  const finding: Finding = {
    id: newId('fnd'),
    targetKind: 'item',
    targetId: item.id,
    reviewPolicyHash: 'app-webhook-v1',
    snapshotHash: snapshotHash({
      itemBodyHash: item.bodyHash,
      replyBodyHashes: replies.map((reply) => reply.bodyHash),
    }),
    recap: recapResult.recap,
    attentionFacts,
    decision,
    surfacingLabel: decision.finalDecision === 'surface' ? 'worth-investigating' : null,
    lifecycleStatus: decision.finalDecision === 'surface' ? 'surfaced' : 'new',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const evaluationResult = await evaluateFinding({
    productName: args.config.product.name,
    finding,
    item,
    provider: args.provider,
  });
  const evaluation = evaluationRecordFromDecision({
    findingId: finding.id,
    provider: args.provider,
    decision: evaluationResult.decision,
  });
  const verificationResult = await verifyFinding({
    productName: args.config.product.name,
    finding,
    item,
    evaluation,
    provider: args.provider,
    ...(args.config.issues.verifyWithCode && args.codeRoot ? { codeRoot: args.codeRoot } : {}),
  });
  const verification = verificationRecordFromDecision({
    findingId: finding.id,
    evaluationId: evaluation.id,
    provider: args.provider,
    decision: verificationResult.decision,
  });
  const shouldComment = shouldPublishIssueComment({ finding, evaluation });
  return {
    item,
    replies,
    attentionFacts,
    finding,
    evaluation,
    verification,
    shouldComment,
    commentBody: shouldComment
      ? renderIssueInvestigationComment({ finding, evaluation, verification, relatedIssues })
      : null,
  };
}

export async function generateIssueInvestigationComment(args: {
  client: GitHubAppClient;
  provider: CompletionProvider;
  config: GitHubAppConfig;
  owner: string;
  repo: string;
  issueNumber: number;
  codeRoot?: string;
}): Promise<string | null> {
  const result = await investigateIssueWithPipeline(args);
  return result?.commentBody ?? null;
}

export async function generatePullRequestReviewBody(args: {
  client: GitHubAppClient;
  provider: CompletionProvider;
  owner: string;
  repo: string;
  pullNumber: number;
}): Promise<string | null> {
  if (!args.client.getPullRequest || !args.client.listPullRequestFiles) return null;
  const pr = await args.client.getPullRequest({ owner: args.owner, repo: args.repo, pullNumber: args.pullNumber });
  const repoGuidance = await loadRepoGuidance(args.client, args.owner, args.repo);
  const files = await args.client.listPullRequestFiles({
    owner: args.owner,
    repo: args.repo,
    pullNumber: args.pullNumber,
  });
  const schema = await loadPromptSchema('app-pr-review');
  const result = await args.provider.complete<PrReviewOutput>({
    promptId: 'app-pr-review',
    promptVersion: 'v1',
    inputs: {
      repo: `${args.owner}/${args.repo}`,
      pullNumber: args.pullNumber,
      title: pr.title,
      url: pr.url,
      author: pr.authorLogin ?? 'unknown',
      base: pr.baseRef,
      head: `${pr.headRef} (${pr.headSha})`,
      repoGuidance,
      body: pr.body,
      files: renderFiles(files),
    },
    schema,
    maxTokens: 1600,
    timeoutMs: 60_000,
  });
  return renderStructuredPrReview(result.output);
}

export async function enrichDecisionWithInvestigation(args: {
  decision: AppDecision;
  client: GitHubAppClient;
  provider: CompletionProvider;
  config: GitHubAppConfig;
  codeRoot?: string;
}): Promise<AppDecision> {
  if (args.decision.type === 'comment_on_issue') {
    const body = await generateIssueInvestigationComment({
      client: args.client,
      provider: args.provider,
      config: args.config,
      owner: args.decision.issue.owner,
      repo: args.decision.issue.repo,
      issueNumber: args.decision.issue.issueNumber,
      ...(args.codeRoot ? { codeRoot: args.codeRoot } : {}),
    });
    return body ? { ...args.decision, body } : { type: 'do_nothing', reason: 'investigation_decided_no_comment' };
  }
  if (args.decision.type === 'review_pull_request') {
    const reviewBody = await generatePullRequestReviewBody({
      client: args.client,
      provider: args.provider,
      owner: args.decision.pullRequest.owner,
      repo: args.decision.pullRequest.repo,
      pullNumber: args.decision.pullRequest.pullRequestNumber,
    });
    return reviewBody ? { ...args.decision, reviewBody: renderPrReviewBody(reviewBody) } : args.decision;
  }
  return args.decision;
}

function githubIssueToItem(args: {
  owner: string;
  repo: string;
  issue: GitHubIssueSummary;
  relatedIssues: GitHubIssueSummary[];
}): Item {
  const now = nowIso();
  const body = appendRelatedIssuesToBody(args.issue.body ?? '', args.relatedIssues);
  return {
    id: newId('itm'),
    sourceKey: `github:${args.owner}/${args.repo}`,
    sourceType: 'github',
    sourceId: `${args.owner}/${args.repo}#${args.issue.number}`,
    url: args.issue.url ?? `https://github.com/${args.owner}/${args.repo}/issues/${args.issue.number}`,
    title: args.issue.title,
    body,
    author: args.issue.authorLogin ?? null,
    createdAt: args.issue.createdAt ?? now,
    updatedAt: args.issue.updatedAt ?? now,
    bodyHash: bodyHash(body),
    latestSnapshotHash: null,
    referenceOnly: args.issue.state === 'closed',
    metadata: {
      labels: args.issue.labels ?? [],
      state: args.issue.state,
      stateReason: null,
      closedAt: null,
      authorAssociation: args.issue.authorAssociation ?? 'NONE',
      linkedOpenPrUrls: linkedOpenPrUrls(body),
      issueNumber: args.issue.number,
    },
    raw: args.issue,
  };
}

function githubCommentToReply(
  itemId: string,
  comment: Awaited<ReturnType<GitHubAppClient['listIssueComments']>>[number],
): Reply {
  const now = nowIso();
  const body = comment.body;
  return {
    id: newId('rpl'),
    itemId,
    sourceReplyId: String(comment.id),
    author: comment.user?.login ?? null,
    body,
    createdAt: comment.createdAt ?? now,
    updatedAt: comment.updatedAt ?? comment.createdAt ?? now,
    bodyHash: bodyHash(body),
    metadata: {
      authorAssociation: comment.authorAssociation ?? 'NONE',
      linkedOpenPrUrls: linkedOpenPrUrls(body),
    },
    raw: comment,
  };
}

function shouldPublishIssueComment(args: { finding: Finding; evaluation: EvaluationRecord }): boolean {
  if (args.finding.attentionFacts.protectedLabel.present) return false;
  if (args.finding.attentionFacts.maintainerActivity.status === 'active') return false;
  return args.evaluation.action === 'request_more_info' || args.evaluation.action === 'accept_for_developer_attention';
}

function renderIssueInvestigationComment(args: {
  finding: Finding;
  evaluation: EvaluationRecord;
  verification: VerificationRecord;
  relatedIssues: GitHubIssueSummary[];
}): string {
  const likelyFiles = args.verification.likelyFiles.slice(0, 5);
  const hypotheses = args.verification.hypotheses.slice(0, 3);
  const reproSteps = args.verification.suggestedReproSteps.slice(0, 4);
  const tests = args.verification.suggestedTests.slice(0, 3);
  return [
    '🌱 **Backlog Gardener automated investigation**',
    '',
    '_I am an automated AI triage agent. I inspected the report and available context, but I have not manually reproduced the issue._',
    '',
    `**Decision:** ${args.evaluation.action} (${args.evaluation.confidence} confidence)`,
    '',
    `**Summary:** ${args.evaluation.developerSummary || args.finding.recap.summary}`,
    '',
    `**Recommended next step:** ${args.evaluation.recommendedNextStep}`,
    '',
    '**Likely area / files:**',
    `- Subsystem: ${args.verification.subsystem}`,
    likelyFiles.length > 0
      ? `- Files to inspect: ${likelyFiles.join(', ')}`
      : '- Files to inspect: no local code match found',
    '',
    '**Investigation hypotheses:**',
    ...bulletOrFallback(hypotheses, 'No specific hypothesis generated.'),
    '',
    '**Suggested reproduction checks:**',
    ...bulletOrFallback(reproSteps, 'Reproduction steps need more detail from the reporter.'),
    '',
    '**Suggested tests:**',
    ...bulletOrFallback(tests, 'No concrete regression test suggestion generated yet.'),
    '',
    '**Related repository issues found:**',
    ...relatedIssueBullets(args.relatedIssues),
    args.evaluation.proposedExternalComment
      ? ['', '**Information that would help:**', args.evaluation.proposedExternalComment]
      : [],
    '',
    '<!-- backlog-gardener:summary:v1 -->',
  ]
    .flat()
    .join('\n');
}

function renderPrReviewBody(body: string): string {
  return [
    '🌱 **Backlog Gardener automated PR review**',
    '',
    '_Automated review. Supplemental signal only; not a maintainer approval._',
    '',
    body,
  ].join('\n');
}

function renderStructuredPrReview(output: PrReviewOutput): string {
  return [
    '## Summary',
    '',
    output.summary.trim() || 'No summary generated.',
    '',
    '## Risk assessment',
    '',
    ...bulletOrFallback(output.riskAssessment, 'No specific risk identified from the provided diff.'),
    '',
    '## Suggested verification',
    '',
    ...bulletOrFallback(output.verification, 'Run the relevant automated checks for the touched files.'),
    '',
    '## Questions requiring human input',
    '',
    ...bulletOrFallback(output.questions, 'None. The available diff/config context was sufficient for this pass.'),
  ].join('\n');
}

async function findRelatedIssues(args: {
  client: GitHubAppClient;
  owner: string;
  repo: string;
  issue: GitHubIssueSummary;
}): Promise<GitHubIssueSummary[]> {
  if (!args.client.searchIssues) return [];
  const query = issueKeywords(`${args.issue.title} ${args.issue.body ?? ''}`)
    .slice(0, 5)
    .join(' ');
  if (!query) return [];
  const issues = await args.client.searchIssues({ owner: args.owner, repo: args.repo, query, perPage: 6 });
  return issues.filter((issue) => issue.number !== args.issue.number).slice(0, 5);
}

function issueKeywords(text: string): string[] {
  const stop = new Set(['the', 'and', 'or', 'when', 'with', 'that', 'this', 'from', 'into', 'fails', 'error']);
  return [...new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])].filter((word) => !stop.has(word));
}

function appendRelatedIssuesToBody(body: string, relatedIssues: GitHubIssueSummary[]): string {
  if (relatedIssues.length === 0) return body;
  return [
    body,
    '',
    'Related repository issues found during automated investigation:',
    ...relatedIssues.map((issue) => `- #${issue.number} ${issue.title} (${issue.state}) ${issue.url ?? ''}`),
  ].join('\n');
}

function relatedIssueBullets(issues: GitHubIssueSummary[]): string[] {
  return issues.length > 0
    ? issues.map((issue) => `- #${issue.number} [${issue.title}](${issue.url ?? ''}) — ${issue.state}`)
    : ['- None found in the initial repository search.'];
}

async function loadRepoGuidance(client: GitHubAppClient, owner: string, repo: string): Promise<string> {
  if (!client.fetchTextFile) return 'No `.gardener.md` guidance file was available.';
  const text = await client.fetchTextFile({ owner, repo, path: '.gardener.md' });
  return text?.trim() ? truncate(text.trim(), 12_000) : 'No `.gardener.md` guidance file was available.';
}

function renderFiles(files: GitHubPullRequestFileSummary[]): string {
  return files
    .slice(0, 30)
    .map((file) =>
      [
        `File: ${file.filename}`,
        `Status: ${file.status}; +${file.additions}/-${file.deletions}; ${file.changes} changes`,
        file.patch ? 'Patch:\n' + truncate(file.patch, 6000) : 'Patch unavailable.',
      ].join('\n'),
    )
    .join('\n\n---\n\n');
}

function linkedOpenPrUrls(text: string): string[] {
  return [...text.matchAll(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/g)].map((match) => match[0]);
}

function evaluationRecordFromDecision(args: {
  findingId: string;
  provider: CompletionProvider;
  decision: Omit<EvaluationRecord, 'id' | 'findingId' | 'provider' | 'model' | 'createdAt'>;
}): EvaluationRecord {
  return {
    id: newId('evl'),
    findingId: args.findingId,
    provider: args.provider.name,
    model: args.provider.model,
    createdAt: nowIso(),
    ...args.decision,
  };
}

function verificationRecordFromDecision(args: {
  findingId: string;
  evaluationId: string;
  provider: CompletionProvider;
  decision: Omit<VerificationRecord, 'id' | 'findingId' | 'evaluationId' | 'provider' | 'model' | 'createdAt'>;
}): VerificationRecord {
  return {
    id: newId('vrf'),
    findingId: args.findingId,
    evaluationId: args.evaluationId,
    provider: args.provider.name,
    model: args.provider.model,
    createdAt: nowIso(),
    ...args.decision,
  };
}

function bulletOrFallback(values: string[], fallback: string): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : [`- ${fallback}`];
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… truncated …`;
}
