import type { TriageProfile } from '../config/index.js';
import type { Finding, Item, RecapConfidence } from '../domain.js';
import type { EvaluationRecord, VerificationRecord } from '../evaluate/types.js';
import type { PlannedDraftPr } from '../implementer/draft-pr.js';
import { newId, nowIso } from '../ids.js';
import { shortTitleForRecap } from '../publish/markdown.js';
import type { ActionEvidence, ActionTarget, ProposedAction } from './types.js';

export interface ActionPlanningEntry {
  finding: Finding;
  item: Item | null;
  evaluation?: EvaluationRecord;
  verification?: VerificationRecord;
}

export interface ActionPlanningArgs {
  profile: TriageProfile;
  runId: string;
  entries: ActionPlanningEntry[];
  dryRun: boolean;
  externalWritesEnabled: boolean;
  createdAt?: string;
  draftPrs?: Map<string, PlannedDraftPr>;
}

function primaryGithubRepo(profile: TriageProfile): string | null {
  return profile.sources.find((source) => source.type === 'github')?.repo ?? null;
}

function repoFromGithubItem(item: Item, fallback: string | null): string {
  if (item.sourceId.includes('#')) return item.sourceId.split('#')[0] || fallback || 'unknown/repo';
  const match = /github\.com\/([^/]+\/[^/]+)\//.exec(item.url);
  return match?.[1] ?? fallback ?? 'unknown/repo';
}

function issueNumber(item: Item): number | null {
  if (typeof item.metadata.issueNumber === 'number') return item.metadata.issueNumber;
  const match = /\/issues\/(\d+)/.exec(item.url) ?? /#(\d+)$/.exec(item.sourceId);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function confidenceFrom(entry: ActionPlanningEntry): RecapConfidence {
  return entry.evaluation?.confidence ?? entry.finding.recap.confidence;
}

function markdownEvidence(evidence: ActionEvidence[]): string {
  if (evidence.length === 0) return '- No source evidence was captured.';
  return evidence
    .map((entry) => {
      const quote = entry.quote ? `\n  > ${entry.quote}` : '';
      return `- [${entry.label}](${entry.sourceUrl}) — ${entry.detail}${quote}`;
    })
    .join('\n');
}

function verificationNotes(verification: VerificationRecord | undefined): string {
  if (!verification) return '';
  const likelyFiles = verification.likelyFiles.slice(0, 5);
  const suggestedTests = verification.suggestedTests.slice(0, 3);
  const sections = [
    `\n## Implementation notes`,
    '',
    `- Subsystem: ${verification.subsystem}`,
    likelyFiles.length > 0 ? `- Likely files: ${likelyFiles.join(', ')}` : null,
    suggestedTests.length > 0 ? `- Suggested tests: ${suggestedTests.join(' ')}` : null,
  ].filter((line): line is string => line !== null);
  return sections.join('\n');
}

function existingIssueBody(entry: ActionPlanningEntry): string {
  const { finding, evaluation, verification } = entry;
  return [
    `## Backlog Gardener context`,
    '',
    `Dry-run note: no external write was performed.`,
    '',
    `**Summary:** ${evaluation?.developerSummary || finding.recap.summary}`,
    '',
    `**Suggested next step:** ${evaluation?.recommendedNextStep || finding.recap.bestSolution || 'Investigate the linked report and confirm current behavior.'}`,
    verificationNotes(verification),
    '',
    `## Evidence`,
    '',
    markdownEvidence(finding.recap.evidence).split('\n').slice(0, 6).join('\n'),
  ].join('\n');
}

function newIssueBody(entry: ActionPlanningEntry): string {
  const { finding, item, evaluation, verification } = entry;
  return [
    `## Summary`,
    '',
    evaluation?.developerSummary || finding.recap.summary,
    '',
    `## Source`,
    '',
    item ? `- ${item.url}` : '- Source item unavailable in local cache.',
    '',
    `## Suggested next step`,
    '',
    evaluation?.recommendedNextStep ||
      finding.recap.bestSolution ||
      'Investigate the report and decide whether this should enter the backlog.',
    verificationNotes(verification),
    '',
    `## Evidence`,
    '',
    markdownEvidence(finding.recap.evidence).split('\n').slice(0, 8).join('\n'),
    '',
    `Dry-run note: Backlog Gardener did not create this issue because external writes were disabled.`,
  ].join('\n');
}

function commonActionFields(args: {
  runId: string;
  productSlug: string;
  entry: ActionPlanningEntry;
  dryRun: boolean;
  externalWritesEnabled: boolean;
  createdAt: string;
  blockedReasons?: string[];
  actionId?: string;
}): Pick<
  ProposedAction,
  | 'schemaVersion'
  | 'actionId'
  | 'runId'
  | 'productSlug'
  | 'dryRun'
  | 'confidence'
  | 'sourceFindingIds'
  | 'sourceUrls'
  | 'evidence'
  | 'safety'
  | 'createdAt'
> {
  const sourceUrls = unique([
    args.entry.item?.url,
    ...args.entry.finding.recap.evidence.map((entry) => entry.sourceUrl),
  ]);
  return {
    schemaVersion: 'gardener.action.v1',
    actionId: args.actionId ?? newId('act'),
    runId: args.runId,
    productSlug: args.productSlug,
    dryRun: args.dryRun,
    confidence: confidenceFrom(args.entry),
    sourceFindingIds: [args.entry.finding.id],
    sourceUrls,
    evidence: args.entry.finding.recap.evidence,
    safety: {
      externalWritesEnabled: args.externalWritesEnabled,
      requiresApproval: true,
      blockedReasons: args.blockedReasons ?? [],
    },
    createdAt: args.createdAt,
  };
}

function actionStatus(blockedReasons: string[]): ProposedAction['status'] {
  return blockedReasons.length > 0 ? 'blocked' : 'would_apply';
}

function existingIssueAction(args: {
  entry: ActionPlanningEntry;
  runId: string;
  productSlug: string;
  dryRun: boolean;
  externalWritesEnabled: boolean;
  createdAt: string;
  fallbackRepo: string | null;
}): ProposedAction {
  const item = args.entry.item;
  const blockedReasons = item ? [] : ['source-item-missing'];
  const number = item ? issueNumber(item) : null;
  if (number === null) blockedReasons.push('github-issue-number-missing');
  const repo = item ? repoFromGithubItem(item, args.fallbackRepo) : (args.fallbackRepo ?? 'unknown/repo');
  const target: ActionTarget = {
    system: 'github',
    kind: 'issue',
    repo,
    issueNumber: number ?? 0,
    url: item?.url ?? '',
  };
  return {
    ...commonActionFields({ ...args, blockedReasons }),
    type: 'add_context_to_existing_issue',
    status: actionStatus(blockedReasons),
    title: number
      ? `#${number} — ${shortTitleForRecap(args.entry.finding.recap)}`
      : `${repo} — ${shortTitleForRecap(args.entry.finding.recap)}`,
    body: existingIssueBody(args.entry),
    target,
    rationale: args.entry.evaluation?.reason ?? args.entry.finding.decision.surfacingReason,
  };
}

function createIssueAction(args: {
  entry: ActionPlanningEntry;
  runId: string;
  productSlug: string;
  dryRun: boolean;
  externalWritesEnabled: boolean;
  createdAt: string;
  repo: string | null;
}): ProposedAction {
  const blockedReasons = args.repo ? [] : ['github-target-repo-missing'];
  const target: ActionTarget = {
    system: 'github',
    kind: 'new_issue',
    repo: args.repo ?? 'unknown/repo',
    labels: args.entry.finding.surfacingLabel ? [args.entry.finding.surfacingLabel] : [],
  };
  return {
    ...commonActionFields({ ...args, blockedReasons }),
    type: 'create_issue',
    status: actionStatus(blockedReasons),
    title: shortTitleForRecap(args.entry.finding.recap),
    body: newIssueBody(args.entry),
    target,
    rationale: args.entry.evaluation?.reason ?? args.entry.finding.decision.surfacingReason,
  };
}

function openPrAction(args: {
  entry: ActionPlanningEntry;
  runId: string;
  productSlug: string;
  dryRun: boolean;
  externalWritesEnabled: boolean;
  createdAt: string;
  draftPr: PlannedDraftPr;
}): ProposedAction {
  return {
    ...commonActionFields({
      runId: args.runId,
      productSlug: args.productSlug,
      entry: args.entry,
      dryRun: args.dryRun,
      externalWritesEnabled: args.externalWritesEnabled,
      createdAt: args.createdAt,
      actionId: args.draftPr.actionId,
    }),
    type: 'open_pr',
    status: 'would_apply',
    title: args.draftPr.title,
    body: args.draftPr.body,
    target: args.draftPr.target,
    rationale: args.draftPr.rationale,
    prArtifacts: args.draftPr.artifacts,
  };
}

function isConcreteLikelyFile(file: string, allowTestOnly: boolean): boolean {
  const normalized = file.toLowerCase();
  if (
    normalized.includes('no relevant') ||
    normalized.includes('unknown') ||
    normalized.includes('not included') ||
    normalized.includes('provided snippets') ||
    normalized.includes('search ') ||
    normalized.includes('starting point')
  )
    return false;
  const candidate = file.split(/[\s,—]+/)[0] ?? '';
  const lowerCandidate = candidate.toLowerCase();
  if (lowerCandidate.startsWith('docs/') || lowerCandidate.endsWith('readme.md')) return false;
  if (!allowTestOnly && lowerCandidate.startsWith('tests/')) return false;
  return /^[A-Za-z0-9_./*{}-]+$/.test(candidate) && (candidate.includes('/') || candidate.includes('.'));
}

function hasNetNewExistingIssueContext(entry: ActionPlanningEntry): boolean {
  const itemUrl = entry.item?.url;
  const externalEvidence = entry.finding.recap.evidence.some(
    (evidence) => itemUrl && !evidence.sourceUrl.startsWith(itemUrl),
  );
  const verification = entry.verification;
  const likelyFiles = verification?.likelyFiles ?? [];
  const text = [
    entry.item?.title,
    entry.item?.body,
    entry.finding.recap.summary,
    entry.finding.recap.bestSolution,
  ].join('\n');
  const allowTestOnly = /\b(phpcs|lint|eslint|test-only|tests? only|reserved keyword)\b/i.test(text);
  const hasUsefulVerification =
    verification?.action === 'debugging_plan_ready' &&
    likelyFiles.some((file) => isConcreteLikelyFile(file, allowTestOnly));
  return externalEvidence || hasUsefulVerification;
}

function textIndicatesActiveWork(entry: ActionPlanningEntry): boolean {
  return [
    entry.finding.recap.summary,
    entry.finding.recap.reason,
    entry.finding.recap.bestSolution,
    entry.evaluation?.reason,
    entry.evaluation?.recommendedNextStep,
    ...entry.finding.recap.evidence.map((evidence) => `${evidence.detail} ${evidence.quote ?? ''}`),
  ]
    .join('\n')
    .toLowerCase()
    .includes('working on a fix');
}

export type ActionDropReason =
  | 'finding-not-surfaced'
  | 'feedback-dismissed-or-snoozed'
  | 'protected-label'
  | 'linked-open-pr'
  | 'active-maintainer'
  | 'evaluator-rejected'
  | 'text-indicates-active-work'
  | 'no-net-new-context-for-existing-issue';

export interface SurfacedDrop {
  findingId: string;
  reason: ActionDropReason;
  itemUrl: string | null;
}

function eligibilityReason(entry: ActionPlanningEntry): ActionDropReason | null {
  const { finding } = entry;
  if (finding.decision.finalDecision !== 'surface') return 'finding-not-surfaced';
  if (finding.lifecycleStatus === 'dismissed' || finding.lifecycleStatus === 'snoozed')
    return 'feedback-dismissed-or-snoozed';
  if (finding.attentionFacts.protectedLabel.present) return 'protected-label';
  if (finding.attentionFacts.linkedOpenPr.present) return 'linked-open-pr';
  if (finding.attentionFacts.maintainerActivity.status === 'active') return 'active-maintainer';
  if (entry.evaluation && entry.evaluation.action !== 'accept_for_developer_attention') return 'evaluator-rejected';
  if (textIndicatesActiveWork(entry)) return 'text-indicates-active-work';
  return null;
}

export interface ActionPlanResult {
  actions: ProposedAction[];
  surfacedDrops: SurfacedDrop[];
}

export function planProposedActions(args: ActionPlanningArgs): ActionPlanResult {
  const createdAt = args.createdAt ?? nowIso();
  const githubRepo = primaryGithubRepo(args.profile);
  const actions: ProposedAction[] = [];
  const surfacedDrops: SurfacedDrop[] = [];
  const recordSurfacedDrop = (entry: ActionPlanningEntry, reason: ActionDropReason) => {
    if (entry.finding.decision.finalDecision !== 'surface') return;
    surfacedDrops.push({ findingId: entry.finding.id, reason, itemUrl: entry.item?.url ?? null });
  };
  for (const entry of args.entries) {
    const eligibilityDrop = eligibilityReason(entry);
    if (eligibilityDrop) {
      recordSurfacedDrop(entry, eligibilityDrop);
      continue;
    }
    const draftPr = args.draftPrs?.get(entry.finding.id);
    if (draftPr) {
      actions.push(
        openPrAction({
          entry,
          runId: args.runId,
          productSlug: args.profile.product.slug,
          dryRun: args.dryRun,
          externalWritesEnabled: args.externalWritesEnabled,
          createdAt,
          draftPr,
        }),
      );
      continue;
    }
    if (entry.item?.sourceType === 'github') {
      if (!hasNetNewExistingIssueContext(entry)) {
        recordSurfacedDrop(entry, 'no-net-new-context-for-existing-issue');
        continue;
      }
      actions.push(
        existingIssueAction({
          entry,
          runId: args.runId,
          productSlug: args.profile.product.slug,
          dryRun: args.dryRun,
          externalWritesEnabled: args.externalWritesEnabled,
          createdAt,
          fallbackRepo: githubRepo,
        }),
      );
      continue;
    }
    actions.push(
      createIssueAction({
        entry,
        runId: args.runId,
        productSlug: args.profile.product.slug,
        dryRun: args.dryRun,
        externalWritesEnabled: args.externalWritesEnabled,
        createdAt,
        repo: githubRepo,
      }),
    );
  }
  return { actions, surfacedDrops };
}
