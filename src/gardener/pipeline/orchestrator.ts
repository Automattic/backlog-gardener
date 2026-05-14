import { planProposedActions } from '../actions/plan.js';
import { scoreDraftPrCandidacy } from '../actions/pr-candidacy.js';
import { canMakeCompletionCall, createUsageAccumulator, recordCompletionUsage } from '../budget.js';
import type { TriageProfile } from '../config/index.js';
import type { Finding, Item } from '../domain.js';
import { evaluateFinding } from '../evaluate/evaluator.js';
import { EvaluationRepository, VerificationRepository } from '../evaluate/repository.js';
import type { EvaluationRecord, VerificationRecord } from '../evaluate/types.js';
import { verifyFinding } from '../evaluate/verifier.js';
import { createDraftPrArtifacts, type PlannedDraftPr } from '../implementer/draft-pr.js';
import type { DraftPrImplementer } from '../implementer/types.js';
import { newId, nowIso } from '../ids.js';
import { computeAttentionFacts } from './attention.js';
import { buildDuplicateClusters } from './cluster.js';
import { generateCandidatePairs, persistEdges, persistHeuristicEdges } from './dedup.js';
import { embedMissingItems } from './embed.js';
import { judgeCandidatePairs } from './pair-judge.js';
import { persistSnapshot } from './snapshot.js';
import { computeSurfacingLabel, decideFinding } from './surfacing.js';
import type { ProgressReporter } from '../progress.js';
import { writeActionPlanOutput } from '../publish/actions.js';
import { writeMarkdownOutput } from '../publish/markdown.js';
import { recordPublication } from '../publish/publications.js';
import { publishSlackSummary } from '../publish/slack.js';
import { analyzeItem } from '../llm/analyze.js';
import { createLocalCompletionProvider } from '../llm/factory.js';
import type { EmbeddingProvider } from '../llm/openai.js';
import type { CompletionProvider } from '../llm/provider.js';
import { sourceCodeRoots } from '../sources/code.js';
import { createSourceAdapter } from '../sources/index.js';
import type { FetchLike } from '../sources/http.js';
import { RepositoryBundle, StoreDb } from '../store/index.js';
import { estimateCompletionCostUsd, recordUsageEvent, usageTotalsForRun, type UsageTotals } from '../usage.js';

export interface SweepSummary {
  runId: string;
  command: 'run' | 'sweep';
  dryRun: boolean;
  externalWritesEnabled: boolean;
  status: 'completed' | 'failed';
  itemsFetched: number;
  repliesFetched: number;
  findings: number;
  surfaced: number;
  actions: number;
  prCandidates: number;
  outputDir: string | null;
  digestPath: string | null;
  actionsJsonlPath: string | null;
  actionsMarkdownPath: string | null;
  actionsHtmlPath: string | null;
  manifestPath: string | null;
  slackStatus: 'skipped' | 'sent' | 'failed';
  skippedExternalWriters: string[];
  usage: UsageTotals;
  embeddings: number;
  dedupEdges: number;
  clusters: number;
  evaluations: number;
  verifications: number;
}

function compactTimestamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d+/, '');
}

function localMarkdownOutputDir(profile: TriageProfile, runId: string, startedAt: string): string | null {
  const publisher = profile.publishers.reviewLane.find((entry) => entry.name === 'local-markdown');
  if (!publisher || publisher.name !== 'local-markdown') return null;
  const timestamp = compactTimestamp(startedAt);
  return publisher.outputDir
    .replaceAll('{product}', profile.product.slug)
    .replaceAll('{runId}', runId)
    .replaceAll('{run_id}', runId)
    .replaceAll('{timestamp}', timestamp)
    .replaceAll('{started_at}', timestamp)
    .replaceAll('{startedAt}', timestamp);
}

function baseBranchForSource(profile: TriageProfile, sourceKey: string): string {
  const source = profile.sources.find((entry) => {
    if (entry.type !== 'github') return false;
    return (entry.key ?? `github:${entry.repo}`) === sourceKey;
  });
  return source?.type === 'github' ? (source.code.branch ?? 'main') : 'main';
}

export async function runSweep(args: {
  profile: TriageProfile;
  statePath: string;
  lane: 'hot' | 'warm' | 'cold';
  fetchImpl?: FetchLike;
  completionProvider?: CompletionProvider;
  triageCompletionProvider?: CompletionProvider;
  evaluatorCompletionProvider?: CompletionProvider;
  verifierCompletionProvider?: CompletionProvider;
  embeddingProvider?: EmbeddingProvider;
  maxItems?: number;
  codeRoot?: string;
  draftPrImplementer?: DraftPrImplementer;
  command?: 'run' | 'sweep';
  dryRun?: boolean;
  externalWritesEnabled?: boolean;
  onProgress?: ProgressReporter;
}): Promise<SweepSummary> {
  const command = args.command ?? 'sweep';
  const dryRun = args.dryRun ?? false;
  const externalWritesEnabled = args.externalWritesEnabled ?? !dryRun;
  const db = new StoreDb(args.statePath);
  db.migrate();
  const repos = new RepositoryBundle(db.db);
  const evaluationsRepo = new EvaluationRepository(db.db);
  const verificationsRepo = new VerificationRepository(db.db);
  const runId = newId('run');
  const startedAt = nowIso();
  db.db
    .prepare(
      'INSERT INTO runs (id, profile_slug, lane, mode, status, started_at, summary_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(runId, args.profile.product.slug, args.lane, 'review', 'in_progress', startedAt, '{}');
  args.onProgress?.({ type: 'run-started', runId, mode: command });

  const baseCompletionProvider = args.completionProvider ?? createLocalCompletionProvider();
  const triageProvider = args.triageCompletionProvider ?? baseCompletionProvider;
  const evaluatorProvider = args.evaluatorCompletionProvider ?? baseCompletionProvider;
  const verifierProvider = args.verifierCompletionProvider ?? baseCompletionProvider;
  const fallbackProvider = createLocalCompletionProvider();
  const usage = createUsageAccumulator();
  const findings: Finding[] = [];
  const itemById = new Map<string, Item>();
  const evaluationByFindingId = new Map<string, EvaluationRecord>();
  const verificationByFindingId = new Map<string, VerificationRecord>();
  const analyzedItems: Item[] = [];
  const maxItems = args.maxItems ?? args.profile.budget.maxItemsPerRun;
  const codeRootsBySourceKey = sourceCodeRoots(args.profile, args.codeRoot);
  let embeddings = 0;
  let dedupEdges = 0;
  let clusters = 0;
  let evaluations = 0;
  let verifications = 0;
  let itemsFetched = 0;
  let repliesFetched = 0;
  try {
    sweepSources: for (const source of args.profile.sources) {
      const adapter = createSourceAdapter(source, args.fetchImpl);
      args.onProgress?.({ type: 'source-started', sourceKey: adapter.sourceKey });
      const watermark = db.db
        .prepare('SELECT last_seen_updated_at FROM watermarks WHERE profile_slug = ? AND source_key = ?')
        .get(args.profile.product.slug, adapter.sourceKey) as { last_seen_updated_at?: string } | undefined;
      const since = watermark?.last_seen_updated_at ? new Date(watermark.last_seen_updated_at) : null;
      let sourceMaxUpdatedAt = watermark?.last_seen_updated_at ?? null;
      const itemStream = since && adapter.fetchItemsSince ? adapter.fetchItemsSince(since) : adapter.fetchItems();
      for await (const itemInput of itemStream) {
        if (itemsFetched >= maxItems) break sweepSources;
        if (!sourceMaxUpdatedAt || itemInput.updatedAt > sourceMaxUpdatedAt) sourceMaxUpdatedAt = itemInput.updatedAt;
        const item = repos.items.upsert(itemInput);
        args.onProgress?.({
          type: 'item-fetched',
          title: item.title,
          url: item.url,
          referenceOnly: item.referenceOnly,
        });
        itemById.set(item.id, item);
        if (!item.referenceOnly) analyzedItems.push(item);
        itemsFetched += 1;
        const replies = [];
        for await (const replyInput of adapter.fetchReplies(item)) {
          replies.push(repos.replies.upsert({ ...replyInput, itemId: item.id }));
          repliesFetched += 1;
        }
        const snapshot = persistSnapshot({ repos, item, replies });
        const priorFinding = repos.findings.findLatestForTarget('item', item.id);
        const feedbackStatus =
          priorFinding?.snapshotHash === snapshot.snapshotHash
            ? repos.feedback
                .listForFinding(priorFinding.id)
                .find((feedback) => feedback.status === 'dismissed' || feedback.status === 'snoozed')?.status
            : null;
        const attentionFacts = computeAttentionFacts({
          item,
          replies,
          protectedLabels: args.profile.attention.protectedLabels,
          now: new Date(),
          recentMaintainerActivityDays: args.profile.attention.recentMaintainerActivityDays,
          staleMaintainerActivityDays: args.profile.attention.staleMaintainerActivityDays,
          feedbackStatus,
        });
        args.onProgress?.({ type: 'analysis-started', title: item.title });
        const { recap, usage: callUsage } = await analyzeItem({
          item,
          replies,
          attentionFacts,
          productName: args.profile.product.name,
          provider: canMakeCompletionCall(args.profile, usage) ? triageProvider : fallbackProvider,
        });
        if (callUsage.inputTokens > 0 || callUsage.outputTokens > 0) {
          recordCompletionUsage(usage, callUsage);
          recordUsageEvent(db.db, {
            runId,
            provider: triageProvider.name,
            model: triageProvider.model,
            kind: 'completion',
            inputTokens: callUsage.inputTokens,
            outputTokens: callUsage.outputTokens,
            estimatedCostUsd: estimateCompletionCostUsd({
              provider: triageProvider.name,
              inputTokens: callUsage.inputTokens,
              outputTokens: callUsage.outputTokens,
            }),
          });
        }
        const decision = decideFinding({
          recap,
          attentionFacts,
          minConfidence: args.profile.surfacing.minConfidence,
          minRecurrence: args.profile.surfacing.minRecurrence,
          recurrenceCount: 1,
        });
        const finding = repos.findings.upsert({
          targetKind: 'item',
          targetId: item.id,
          reviewPolicyHash: 'heuristic-v1',
          snapshotHash: snapshot.snapshotHash,
          recap,
          attentionFacts,
          decision,
          surfacingLabel: decision.finalDecision === 'surface' ? computeSurfacingLabel(recap) : null,
          lifecycleStatus: decision.finalDecision === 'surface' ? 'surfaced' : 'new',
        });
        findings.push(finding);
        args.onProgress?.({ type: 'finding-decided', title: item.title, decision: decision.finalDecision });
      }
      if (sourceMaxUpdatedAt) {
        db.db
          .prepare(
            `
            INSERT INTO watermarks (profile_slug, source_key, last_seen_updated_at, cursor)
            VALUES (?, ?, ?, NULL)
            ON CONFLICT(profile_slug, source_key) DO UPDATE SET
              last_seen_updated_at = excluded.last_seen_updated_at,
              cursor = excluded.cursor
          `,
          )
          .run(args.profile.product.slug, adapter.sourceKey, sourceMaxUpdatedAt);
      }
    }

    if (args.embeddingProvider) {
      args.onProgress?.({ type: 'embeddings-started', count: analyzedItems.length });
      const embeddingUsage = await embedMissingItems({
        db: db.db,
        items: analyzedItems,
        provider: args.embeddingProvider,
      });
      embeddings = embeddingUsage.embedded;
      if (embeddingUsage.tokens > 0) {
        recordUsageEvent(db.db, {
          runId,
          provider: args.embeddingProvider.name,
          model: args.embeddingProvider.model,
          kind: 'embedding',
          inputTokens: embeddingUsage.tokens,
          outputTokens: 0,
          estimatedCostUsd: 0,
        });
      }
      const pairs = generateCandidatePairs({
        db: db.db,
        items: analyzedItems,
        provider: args.embeddingProvider.name,
        model: args.embeddingProvider.model,
        topK: 5,
        minScore: 0.85,
      }).slice(0, args.profile.budget.maxDedupPairsPerRun);
      args.onProgress?.({ type: 'dedup-started', count: pairs.length });
      if (evaluatorProvider.name === 'anthropic' || evaluatorProvider.name === 'openai') {
        const judged = await judgeCandidatePairs({
          productName: args.profile.product.name,
          items: analyzedItems,
          pairs,
          provider: evaluatorProvider,
          maxPairs: args.profile.budget.maxDedupPairsPerRun,
        });
        if (judged.usage.inputTokens > 0 || judged.usage.outputTokens > 0) {
          recordUsageEvent(db.db, {
            runId,
            provider: evaluatorProvider.name,
            model: evaluatorProvider.model,
            kind: 'completion',
            inputTokens: judged.usage.inputTokens,
            outputTokens: judged.usage.outputTokens,
            estimatedCostUsd: estimateCompletionCostUsd({
              provider: evaluatorProvider.name,
              inputTokens: judged.usage.inputTokens,
              outputTokens: judged.usage.outputTokens,
            }),
          });
        }
        dedupEdges = persistEdges({ db: db.db, pairs: judged.pairs, reviewPolicyHash: 'heuristic-v1' });
      } else {
        dedupEdges = persistHeuristicEdges({ db: db.db, pairs, reviewPolicyHash: 'heuristic-v1' });
      }
      clusters = buildDuplicateClusters({ db: db.db, items: analyzedItems, reviewPolicyHash: 'heuristic-v1' }).length;
    }

    args.onProgress?.({ type: 'evaluation-started', count: findings.length });
    const acceptedForVerification = [];
    for (const finding of findings) {
      const item =
        finding.targetKind === 'item' ? (itemById.get(finding.targetId) ?? repos.items.get(finding.targetId)) : null;
      const evaluated = await evaluateFinding({
        productName: args.profile.product.name,
        finding,
        item,
        provider: evaluatorProvider,
      });
      if (evaluated.usage.inputTokens > 0 || evaluated.usage.outputTokens > 0) {
        recordUsageEvent(db.db, {
          runId,
          provider: evaluatorProvider.name,
          model: evaluatorProvider.model,
          kind: 'completion',
          inputTokens: evaluated.usage.inputTokens,
          outputTokens: evaluated.usage.outputTokens,
          estimatedCostUsd: estimateCompletionCostUsd({
            provider: evaluatorProvider.name,
            inputTokens: evaluated.usage.inputTokens,
            outputTokens: evaluated.usage.outputTokens,
          }),
        });
      }
      const evaluation = evaluationsRepo.insert({
        findingId: finding.id,
        provider: evaluatorProvider.name,
        model: evaluatorProvider.model,
        decision: evaluated.decision,
      });
      evaluationByFindingId.set(finding.id, evaluation);
      evaluations += 1;
      if (evaluation.action === 'accept_for_developer_attention' || evaluation.action === 'request_more_info') {
        acceptedForVerification.push({ finding, item, evaluation });
      }
    }

    args.onProgress?.({ type: 'verification-started', count: acceptedForVerification.length });
    for (const entry of acceptedForVerification) {
      const codeRoot = entry.item ? codeRootsBySourceKey.get(entry.item.sourceKey) : undefined;
      const verified = await verifyFinding({
        productName: args.profile.product.name,
        finding: entry.finding,
        item: entry.item,
        evaluation: entry.evaluation,
        provider: verifierProvider,
        ...(codeRoot ? { codeRoot } : {}),
      });
      if (verified.usage.inputTokens > 0 || verified.usage.outputTokens > 0) {
        recordUsageEvent(db.db, {
          runId,
          provider: verifierProvider.name,
          model: verifierProvider.model,
          kind: 'completion',
          inputTokens: verified.usage.inputTokens,
          outputTokens: verified.usage.outputTokens,
          estimatedCostUsd: estimateCompletionCostUsd({
            provider: verifierProvider.name,
            inputTokens: verified.usage.inputTokens,
            outputTokens: verified.usage.outputTokens,
          }),
        });
      }
      const verification = verificationsRepo.insert({
        findingId: entry.finding.id,
        evaluationId: entry.evaluation.id,
        provider: verifierProvider.name,
        model: verifierProvider.model,
        decision: verified.decision,
      });
      verificationByFindingId.set(entry.finding.id, verification);
      verifications += 1;
    }

    const outputDir = localMarkdownOutputDir(args.profile, runId, startedAt);
    if (outputDir) args.onProgress?.({ type: 'publishing-started', publisher: 'local-markdown' });
    const output = outputDir
      ? writeMarkdownOutput({
          outputDir,
          runId,
          productName: args.profile.product.name,
          findings,
        })
      : null;
    if (output) {
      for (const finding of findings) {
        recordPublication({
          db: db.db,
          runId,
          findingId: finding.id,
          publisher: 'local-markdown',
          destination: outputDir ?? '',
          payload: `${output.digestPath}:${finding.id}`,
          status: 'written',
        });
      }
    }
    const surfacedFindings = findings.filter((finding) => finding.decision.finalDecision === 'surface');
    const actionEntries = findings.map((finding) => {
      const item =
        finding.targetKind === 'item' ? (itemById.get(finding.targetId) ?? repos.items.get(finding.targetId)) : null;
      const evaluation = evaluationByFindingId.get(finding.id);
      const verification = verificationByFindingId.get(finding.id);
      return {
        finding,
        item,
        ...(evaluation ? { evaluation } : {}),
        ...(verification ? { verification } : {}),
      };
    });
    const prCandidacies = actionEntries
      .map((entry) => ({ entry, candidacy: scoreDraftPrCandidacy(entry) }))
      .filter((candidate) => candidate.candidacy.eligible);
    const draftPrs = new Map<string, PlannedDraftPr>();
    if (args.draftPrImplementer && outputDir) {
      for (const candidate of prCandidacies) {
        const sourceRoot = candidate.entry.item ? codeRootsBySourceKey.get(candidate.entry.item.sourceKey) : undefined;
        const draftPr = await createDraftPrArtifacts({
          actionId: newId('act'),
          outputDir,
          sourceRoot,
          entry: candidate.entry,
          candidacy: candidate.candidacy,
          implementer: args.draftPrImplementer,
          baseBranch: candidate.entry.item ? baseBranchForSource(args.profile, candidate.entry.item.sourceKey) : 'main',
        });
        if (draftPr) draftPrs.set(candidate.entry.finding.id, draftPr);
      }
    }
    const { actions, surfacedDrops } = planProposedActions({
      profile: args.profile,
      runId,
      entries: actionEntries,
      dryRun,
      externalWritesEnabled,
      draftPrs,
    });
    const skippedExternalWriters = new Set<string>();
    if (!externalWritesEnabled) {
      if (actions.some((action) => action.target.system === 'github')) skippedExternalWriters.add('github');
      if (actions.some((action) => action.target.system === 'linear')) skippedExternalWriters.add('linear');
    }

    const slackPublisher = args.profile.publishers.reviewLane.find((entry) => entry.name === 'slack');
    let slackStatus: SweepSummary['slackStatus'] = 'skipped';
    if (slackPublisher?.name === 'slack') {
      if (!externalWritesEnabled) {
        skippedExternalWriters.add('slack');
      } else {
        args.onProgress?.({ type: 'publishing-started', publisher: 'slack' });
        const webhookUrl = process.env[slackPublisher.webhookEnv];
        if (webhookUrl) {
          try {
            await publishSlackSummary({
              webhookUrl,
              productName: args.profile.product.name,
              runId,
              surfaced: surfacedFindings.length,
              deferred: findings.filter((finding) => finding.decision.finalDecision === 'defer').length,
              digestPath: output?.digestPath ?? null,
              topFindings: surfacedFindings.slice(0, slackPublisher.includeTopFindings),
              fetchImpl: args.fetchImpl,
            });
            slackStatus = 'sent';
          } catch {
            slackStatus = 'failed';
          }
          recordPublication({
            db: db.db,
            runId,
            findingId: null,
            publisher: 'slack',
            destination: webhookUrl,
            payload: JSON.stringify({
              runId,
              surfaced: surfacedFindings.length,
              digestPath: output?.digestPath ?? null,
            }),
            status: slackStatus,
          });
        }
      }
    }

    const usageTotals = usageTotalsForRun(db.db, runId);
    const completedAt = nowIso();
    const actionArtifacts = outputDir
      ? writeActionPlanOutput({
          outputDir,
          runId,
          productName: args.profile.product.name,
          dryRun,
          externalWritesEnabled,
          actions,
          surfacedDrops,
          digestPath: output?.digestPath ?? null,
          manifest: {
            schemaVersion: 'gardener.run.v1',
            runId,
            product: { slug: args.profile.product.slug, name: args.profile.product.name },
            command,
            dryRun,
            externalWritesEnabled,
            lane: args.lane,
            status: 'completed',
            startedAt,
            completedAt,
            counts: {
              itemsFetched,
              repliesFetched,
              findings: findings.length,
              surfaced: surfacedFindings.length,
              actions: actions.length,
              addContextActions: actions.filter((action) => action.type === 'add_context_to_existing_issue').length,
              createIssueActions: actions.filter((action) => action.type === 'create_issue').length,
              openPrActions: actions.filter((action) => action.type === 'open_pr').length,
              surfacedWithoutAction: surfacedDrops.length,
              prCandidates: prCandidacies.length,
              dedupEdges,
              clusters,
              evaluations,
              verifications,
            },
            surfacedDrops,
            usage: usageTotals,
            skippedExternalWriters: [...skippedExternalWriters],
          },
        })
      : null;

    const summary: SweepSummary = {
      runId,
      command,
      dryRun,
      externalWritesEnabled,
      status: 'completed',
      itemsFetched,
      repliesFetched,
      findings: findings.length,
      surfaced: surfacedFindings.length,
      actions: actions.length,
      prCandidates: prCandidacies.length,
      outputDir,
      digestPath: output?.digestPath ?? null,
      actionsJsonlPath: actionArtifacts?.actionsJsonlPath ?? null,
      actionsMarkdownPath: actionArtifacts?.actionsMarkdownPath ?? null,
      actionsHtmlPath: actionArtifacts?.actionsHtmlPath ?? null,
      manifestPath: actionArtifacts?.manifestPath ?? null,
      slackStatus,
      skippedExternalWriters: [...skippedExternalWriters],
      usage: usageTotals,
      embeddings,
      dedupEdges,
      clusters,
      evaluations,
      verifications,
    };
    db.db
      .prepare('UPDATE runs SET status = ?, finished_at = ?, summary_json = ? WHERE id = ?')
      .run('completed', completedAt, JSON.stringify(summary), runId);
    args.onProgress?.({ type: 'run-finished', runId, status: 'completed' });
    return summary;
  } catch (error) {
    db.db
      .prepare('UPDATE runs SET status = ?, finished_at = ?, summary_json = ? WHERE id = ?')
      .run(
        'failed',
        nowIso(),
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        runId,
      );
    args.onProgress?.({ type: 'run-finished', runId, status: 'failed' });
    throw error;
  } finally {
    db.close();
  }
}

export function renderSweepSummary(summary: SweepSummary, options?: { statePath?: string }): string {
  const nextSteps = renderNextSteps(summary, options?.statePath);
  return [
    `Backlog Gardener ${summary.command} completed: ${summary.runId}`,
    `External writes: ${summary.externalWritesEnabled ? 'enabled' : 'disabled'}${summary.dryRun ? ' (dry run)' : ''}`,
    summary.skippedExternalWriters.length > 0
      ? `Skipped external writers: ${summary.skippedExternalWriters.join(', ')}`
      : null,
    `Items: ${summary.itemsFetched}`,
    `Replies: ${summary.repliesFetched}`,
    `Findings: ${summary.findings}`,
    `Surfaced: ${summary.surfaced}`,
    `Actions planned: ${summary.actions}`,
    `Draft PR candidates: ${summary.prCandidates}`,
    summary.actionsMarkdownPath ? `Action plan: ${summary.actionsMarkdownPath}` : null,
    summary.actionsJsonlPath ? `Actions JSONL: ${summary.actionsJsonlPath}` : null,
    summary.actionsHtmlPath ? `Actions HTML: ${summary.actionsHtmlPath}` : null,
    summary.manifestPath ? `Manifest: ${summary.manifestPath}` : null,
    summary.digestPath ? `Digest: ${summary.digestPath}` : null,
    `Slack: ${summary.slackStatus}`,
    `Completion calls: ${summary.usage.completionCalls}`,
    `Estimated cost: $${summary.usage.estimatedCostUsd.toFixed(4)}`,
    `Embeddings: ${summary.embeddings}`,
    `Dedup edges: ${summary.dedupEdges}`,
    `Clusters: ${summary.clusters}`,
    `Evaluations: ${summary.evaluations}`,
    `Verifications: ${summary.verifications}`,
    ...nextSteps,
    '',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function renderNextSteps(summary: SweepSummary, statePath: string | undefined): (string | null)[] {
  if (summary.surfaced === 0 && summary.actions === 0) return [];
  const lines: (string | null)[] = ['', 'Next steps:'];
  if (summary.actionsHtmlPath) {
    lines.push(`- Open the action plan: ${summary.actionsHtmlPath}`);
  } else if (summary.actionsMarkdownPath) {
    lines.push(`- Open the action plan: ${summary.actionsMarkdownPath}`);
  }
  if (summary.outputDir) {
    lines.push(
      `- Record feedback: edit the "## Human review" block in each fnd_*.md under ${summary.outputDir}, then:`,
      `    pnpm gardener feedback import --state ${statePath ?? '<state>'} --path ${summary.outputDir}/<file>.md`,
    );
  }
  lines.push(
    `- Or use the review UI: pnpm gardener review --state ${statePath ?? '<state>'}`,
    `    Then open http://127.0.0.1:4317`,
  );
  return lines;
}

export const renderRunSummary = renderSweepSummary;
