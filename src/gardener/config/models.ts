import { z } from 'zod';

const RepoNameSchema = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, {
  message: 'expected owner/repo',
});

const ProductSchema = z
  .object({
    name: z.string().min(1),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, {
      message: 'slug must be kebab-case',
    }),
  })
  .strict();

const FetchScopeSchema = z
  .object({
    states: z.array(z.enum(['open', 'closed'])).default(['open']),
    closedIssueMode: z.enum(['reference-only']).default('reference-only'),
    closedSinceDays: z.number().int().positive().default(365),
  })
  .strict();

const DEFAULT_NORMAL_FETCH_SCOPE = {
  states: ['open'] as Array<'open' | 'closed'>,
  closedIssueMode: 'reference-only' as const,
  closedSinceDays: 365,
};

const DEFAULT_BACKFILL_FETCH_SCOPE = {
  states: ['open', 'closed'] as Array<'open' | 'closed'>,
  closedIssueMode: 'reference-only' as const,
  closedSinceDays: 365,
};

const DEFAULT_SOURCE_FETCH = {
  normal: DEFAULT_NORMAL_FETCH_SCOPE,
  backfill: DEFAULT_BACKFILL_FETCH_SCOPE,
  referenceSearch: { includeClosed: true },
};

const SourceFetchSchema = z
  .object({
    normal: FetchScopeSchema.default(DEFAULT_NORMAL_FETCH_SCOPE),
    backfill: FetchScopeSchema.default(DEFAULT_BACKFILL_FETCH_SCOPE),
    referenceSearch: z
      .object({
        includeClosed: z.boolean().default(true),
      })
      .strict()
      .default({ includeClosed: true }),
    maxItemsPerRun: z.number().int().positive().optional(),
  })
  .strict()
  .default(DEFAULT_SOURCE_FETCH);

const SourceCodeSchema = z
  .object({
    checkout: z.boolean().default(false),
    branch: z.string().min(1).optional(),
  })
  .strict()
  .default({ checkout: false });

const SourceBaseSchema = z
  .object({
    key: z.string().min(1).optional(),
    isCustomerFacing: z.boolean().default(true),
    fetch: SourceFetchSchema,
    code: SourceCodeSchema,
  })
  .strict();

const GitHubSourceSchema = SourceBaseSchema.extend({
  type: z.literal('github'),
  host: z.literal('github.com', {
    error: 'GitHub Enterprise/internal hosts are not supported in the Local MVP; use github.com only.',
  }),
  repo: RepoNameSchema,
  authEnv: z.string().min(1).optional(),
}).strict();

const WporgReviewsSourceSchema = SourceBaseSchema.extend({
  type: z.literal('wporg-reviews'),
  pluginSlug: z.string().min(1),
}).strict();

const WporgForumSourceSchema = SourceBaseSchema.extend({
  type: z.literal('wporg-forum'),
  pluginSlug: z.string().min(1),
}).strict();

export const SourceConfigSchema = z.discriminatedUnion('type', [
  GitHubSourceSchema,
  WporgReviewsSourceSchema,
  WporgForumSourceSchema,
]);

const CompletionModelSchema = z
  .object({
    provider: z.enum(['anthropic', 'openai', 'local']),
    model: z.string().min(1),
    thinking: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  })
  .strict();

const LlmConfigSchema = z
  .object({
    completion: CompletionModelSchema,
    roles: z
      .object({
        triage: CompletionModelSchema.optional(),
        evaluator: CompletionModelSchema.optional(),
        verifier: CompletionModelSchema.optional(),
      })
      .strict()
      .default({}),
    embedding: z
      .object({
        provider: z.enum(['openai', 'local']),
        model: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const DEFAULT_ATTENTION_CONFIG = {
  recentMaintainerActivityDays: 14,
  staleMaintainerActivityDays: 90,
  protectedLabels: ['security', 'release-blocker', 'partner-escalation'],
};

const AttentionConfigSchema = z
  .object({
    recentMaintainerActivityDays: z.number().int().positive().default(14),
    staleMaintainerActivityDays: z.number().int().positive().default(90),
    protectedLabels: z.array(z.string().min(1)).default(['security', 'release-blocker', 'partner-escalation']),
  })
  .strict()
  .default(DEFAULT_ATTENTION_CONFIG);

const DEFAULT_SURFACING_CONFIG = {
  minConfidence: 'medium' as const,
  minRecurrence: 1,
  labels: ['developer-ready', 'worth-investigating'] as Array<'developer-ready' | 'worth-investigating'>,
};

const SurfacingConfigSchema = z
  .object({
    minConfidence: z.enum(['medium', 'high']).default('medium'),
    minRecurrence: z.number().int().positive().default(1),
    labels: z
      .array(z.enum(['developer-ready', 'worth-investigating']))
      .default(['developer-ready', 'worth-investigating']),
  })
  .strict()
  .default(DEFAULT_SURFACING_CONFIG);

const DEFAULT_BUDGET_CONFIG = {
  dailyLimitUsd: 20,
  perRunLimitUsd: 10,
  backfillLimitUsd: 20,
  maxItemsPerRun: 250,
  maxCompletionCallsPerRun: 500,
  maxEmbeddingTextsPerRun: 5000,
  maxDedupPairsPerRun: 1000,
  onExhausted: 'stop-cleanly' as const,
};

const BudgetConfigSchema = z
  .object({
    dailyLimitUsd: z.number().positive().default(20),
    perRunLimitUsd: z.number().positive().default(10),
    backfillLimitUsd: z.number().positive().default(20),
    maxItemsPerRun: z.number().int().positive().default(250),
    maxCompletionCallsPerRun: z.number().int().positive().default(500),
    maxEmbeddingTextsPerRun: z.number().int().positive().default(5000),
    maxDedupPairsPerRun: z.number().int().positive().default(1000),
    onExhausted: z.enum(['stop-cleanly']).default('stop-cleanly'),
  })
  .strict()
  .default(DEFAULT_BUDGET_CONFIG);

const LocalMarkdownPublisherSchema = z
  .object({
    name: z.literal('local-markdown'),
    outputDir: z.string().min(1).default('out/{product}/{timestamp}__{runId}'),
  })
  .strict();

const SlackPublisherSchema = z
  .object({
    name: z.literal('slack'),
    mode: z.literal('channel').default('channel'),
    webhookEnv: z.string().min(1).optional(),
    webhook_env: z.string().min(1).optional(),
    includeTopFindings: z.number().int().positive().optional(),
    include_top_findings: z.number().int().positive().optional(),
  })
  .strict()
  .transform((value) => ({
    name: value.name,
    mode: value.mode,
    webhookEnv: value.webhookEnv ?? value.webhook_env ?? 'SLACK_WEBHOOK_URL',
    includeTopFindings: value.includeTopFindings ?? value.include_top_findings ?? 5,
  }));

const ReviewLanePublisherSchema = z.union([LocalMarkdownPublisherSchema, SlackPublisherSchema]);

const DEFAULT_PUBLISHERS_CONFIG = {
  reviewLane: [{ name: 'local-markdown' as const, outputDir: 'out/{product}/{timestamp}__{runId}' }],
  applyLane: [] as never[],
};

const PublishersConfigSchema = z
  .object({
    reviewLane: z.array(ReviewLanePublisherSchema).default(DEFAULT_PUBLISHERS_CONFIG.reviewLane),
    applyLane: z.array(z.never()).default([]),
  })
  .strict()
  .default(DEFAULT_PUBLISHERS_CONFIG);

export const TriageProfileSchema = z
  .object({
    product: ProductSchema,
    sources: z.array(SourceConfigSchema).min(1),
    llm: LlmConfigSchema,
    attention: AttentionConfigSchema,
    surfacing: SurfacingConfigSchema,
    budget: BudgetConfigSchema,
    publishers: PublishersConfigSchema,
  })
  .strict();

export type SourceConfig = z.output<typeof SourceConfigSchema>;
export type GitHubSourceConfig = Extract<SourceConfig, { type: 'github' }>;
export type WporgReviewsSourceConfig = Extract<SourceConfig, { type: 'wporg-reviews' }>;
export type WporgForumSourceConfig = Extract<SourceConfig, { type: 'wporg-forum' }>;
export type TriageProfile = z.output<typeof TriageProfileSchema>;
