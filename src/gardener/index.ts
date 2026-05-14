export { buildProgram, main } from './cli.js';
export { planProposedActions } from './actions/plan.js';
export { scoreDraftPrCandidacy } from './actions/pr-candidacy.js';
export type { DraftPrCandidacy } from './actions/pr-candidacy.js';
export type {
  ActionEvidence,
  ActionTarget,
  ProposedAction,
  ProposedActionStatus,
  ProposedActionType,
  ProposedPrArtifacts,
} from './actions/types.js';
export { createDraftPrArtifacts, NoopDraftPrImplementer } from './implementer/draft-pr.js';
export type {
  DraftPrImplementer,
  DraftPrImplementerInput,
  DraftPrImplementerResult,
  DraftPrImplementationStatus,
  DraftPrVerificationStatus,
} from './implementer/types.js';
export type { SweepLane } from './cli.js';

export { ConfigValidationError, loadTriageProfile, parseTriageProfile } from './config/index.js';
export { SourceConfigSchema, TriageProfileSchema } from './config/index.js';
export type {
  GitHubSourceConfig,
  SourceConfig,
  TriageProfile,
  WporgForumSourceConfig,
  WporgReviewsSourceConfig,
} from './config/index.js';

export type * from './domain.js';
export { analyzeItem } from './llm/analyze.js';
export { collectCodeContext, renderCodeContext } from './evaluate/code-context.js';
export { evaluateFinding, localEvaluateFinding } from './evaluate/evaluator.js';
export { EvaluationRepository, VerificationRepository } from './evaluate/repository.js';
export type {
  EvaluationAction,
  EvaluationDecision,
  EvaluationRecord,
  VerificationAction,
  VerificationDecision,
  VerificationRecord,
} from './evaluate/types.js';
export { verifyFinding } from './evaluate/verifier.js';
export {
  completionConfigForRole,
  createCompletionProvider,
  createCompletionProviderForRole,
  createEmbeddingProvider,
  createLocalCompletionProvider,
  createLocalEmbeddingProvider,
} from './llm/factory.js';
export { AnthropicCompletionProvider } from './llm/anthropic.js';
export { OpenAICompletionProvider, OpenAIEmbeddingProvider } from './llm/openai.js';
export type { EmbeddingProvider } from './llm/openai.js';
export { FakeCompletionProvider } from './llm/provider.js';
export type { CompletionProvider, CompletionResult, CompletionUsage } from './llm/provider.js';
export { validateRecap, RecapSchema } from './llm/recap.js';
export { parseLookback, runBackfill, renderBackfillSummary } from './pipeline/backfill.js';
export { runSweep, renderSweepSummary, renderRunSummary } from './pipeline/orchestrator.js';
export { cosineSimilarity, embedMissingItems, topKSimilar } from './pipeline/embed.js';
export { buildDuplicateClusters } from './pipeline/cluster.js';
export { generateCandidatePairs, persistEdges, persistHeuristicEdges, titleFingerprint } from './pipeline/dedup.js';
export { judgeCandidatePairs } from './pipeline/pair-judge.js';
export type { JudgedPair, PairJudgeVerdict } from './pipeline/pair-judge.js';
export { computeAttentionFacts } from './pipeline/attention.js';
export { computeSurfacingLabel, decideFinding } from './pipeline/surfacing.js';
export { renderActionsHtml, renderActionsMarkdown, writeActionPlanOutput } from './publish/actions.js';
export { renderDigest, renderFindingMarkdown, writeMarkdownOutput } from './publish/markdown.js';
export { readReviewFindings, readReviewRuns } from './review/data.js';
export { renderReviewPage } from './review/render.js';
export { createReviewServer, startReviewServer } from './review/server.js';
export { renderProgressEvent } from './progress.js';
export type { ProgressEvent, ProgressReporter } from './progress.js';
export { publishSlackSummary } from './publish/slack.js';
export { payloadHash, recordPublication } from './publish/publications.js';
export { RepositoryBundle, StoreDb } from './store/index.js';
export { estimateCompletionCostUsd, recordUsageEvent, usageTotalsForRun } from './usage.js';
export type { UsageEventInput, UsageTotals } from './usage.js';
export {
  checkoutPathForGitHubSource,
  codeRootForSource,
  sourceCodeRoots,
  syncGitHubSource,
  syncProfileSources,
} from './sources/code.js';
export { createSourceAdapter } from './sources/index.js';
export type { SourceAdapter } from './sources/index.js';
