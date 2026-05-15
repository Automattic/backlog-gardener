import YAML from 'yaml';
import { z } from 'zod';

export const GitHubAppConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    mode: z.enum(['report-only', 'suggest-comments']).default('report-only'),
    model: z
      .object({
        provider: z.literal('openai').default('openai'),
        name: z.string().min(1).default('gpt-4.1-mini'),
      })
      .strict()
      .default({ provider: 'openai', name: 'gpt-4.1-mini' }),
    product: z
      .object({
        slug: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]*$/, { message: 'product.slug must be kebab-case' })
          .default('default'),
        name: z.string().min(1).default('Default'),
      })
      .strict()
      .default({ slug: 'default', name: 'Default' }),
    report: z
      .object({
        enabled: z.boolean().default(true),
        title: z.string().min(1).default('🌱 Backlog Gardener Report'),
        updateStrategy: z.literal('single-comment').default('single-comment'),
      })
      .strict()
      .default({ enabled: true, title: '🌱 Backlog Gardener Report', updateStrategy: 'single-comment' }),
    code: z
      .object({
        checkout: z.boolean().default(true),
        branch: z.string().min(1).default('main'),
      })
      .strict()
      .default({ checkout: true, branch: 'main' }),
    issues: z
      .object({
        enabled: z.boolean().default(false),
        comments: z
          .object({
            enabled: z.boolean().default(false),
            minConfidence: z.enum(['medium', 'high']).default('high'),
          })
          .strict()
          .default({ enabled: false, minConfidence: 'high' }),
        includeRelatedIssues: z.boolean().default(true),
        verifyWithCode: z.boolean().default(true),
      })
      .strict()
      .default({
        enabled: false,
        comments: { enabled: false, minConfidence: 'high' },
        includeRelatedIssues: true,
        verifyWithCode: true,
      }),
    actions: z
      .object({
        issueComments: z.boolean().default(false),
      })
      .strict()
      .default({
        issueComments: false,
      }),
    prReviews: z
      .object({
        enabled: z.boolean().default(false),
        liveMode: z.boolean().default(false),
        eventType: z.string().min(1).default('backlog-gardener.pr-review'),
        includeDrafts: z.boolean().default(false),
        cooldownHours: z.number().int().nonnegative().default(24),
        triggers: z
          .object({
            opened: z.boolean().default(true),
            readyForReview: z.boolean().default(true),
            synchronize: z.boolean().default(false),
          })
          .strict()
          .default({ opened: true, readyForReview: true, synchronize: false }),
      })
      .strict()
      .default({
        enabled: false,
        liveMode: false,
        eventType: 'backlog-gardener.pr-review',
        includeDrafts: false,
        cooldownHours: 24,
        triggers: { opened: true, readyForReview: true, synchronize: false },
      }),
    thresholds: z
      .object({
        minReportConfidence: z.enum(['medium', 'high']).default('medium'),
        minCommentConfidence: z.enum(['medium', 'high']).default('high'),
        minDuplicateConfidence: z.enum(['medium', 'high']).default('high'),
      })
      .strict()
      .default({ minReportConfidence: 'medium', minCommentConfidence: 'high', minDuplicateConfidence: 'high' }),
    cooldowns: z
      .object({
        sameIssueCommentDays: z.number().int().nonnegative().default(14),
        sameMarkerDays: z.number().int().nonnegative().default(30),
      })
      .strict()
      .default({ sameIssueCommentDays: 14, sameMarkerDays: 30 }),
    controls: z
      .object({
        ignoreLabels: z.array(z.string().min(1)).default(['gardener-ignore']),
        protectedLabels: z.array(z.string().min(1)).default(['security']),
        approvalLabels: z.array(z.string().min(1)).default(['gardener-approved']),
        vetoReactions: z.array(z.string().min(1)).default(['-1']),
      })
      .strict()
      .default({
        ignoreLabels: ['gardener-ignore'],
        protectedLabels: ['security'],
        approvalLabels: ['gardener-approved'],
        vetoReactions: ['-1'],
      }),
  })
  .strict();

export type GitHubAppConfig = z.output<typeof GitHubAppConfigSchema>;

export const DEFAULT_GITHUB_APP_CONFIG: GitHubAppConfig = GitHubAppConfigSchema.parse({});

export function parseGitHubAppConfig(source: string | null | undefined): GitHubAppConfig {
  if (!source?.trim()) return DEFAULT_GITHUB_APP_CONFIG;
  const parsed = normalizeLegacyConfig(YAML.parse(source) as Record<string, unknown> | null | undefined);
  return GitHubAppConfigSchema.parse(parsed ?? {});
}

function normalizeLegacyConfig(config: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!config) return {};
  const normalized: Record<string, unknown> = { ...config };
  const pullRequests = normalized.pullRequests as Record<string, unknown> | undefined;
  if (pullRequests && !normalized.prReviews) {
    const reviews = pullRequests.reviews as Record<string, unknown> | undefined;
    normalized.prReviews = {
      enabled: reviews?.enabled ?? pullRequests.enabled,
      liveMode: reviews?.liveMode,
      includeDrafts: pullRequests.includeDrafts,
      triggers: pullRequests.triggers,
    };
  }
  delete normalized.pullRequests;

  const issues = normalized.issues as Record<string, unknown> | undefined;
  const comments = issues?.comments as Record<string, unknown> | undefined;
  if (issues && comments) {
    normalized.issues = { ...issues, enabled: issues.enabled ?? comments.enabled };
    const actions = (normalized.actions as Record<string, unknown> | undefined) ?? {};
    normalized.actions = { ...actions, issueComments: actions.issueComments ?? comments.enabled };
    const thresholds = (normalized.thresholds as Record<string, unknown> | undefined) ?? {};
    normalized.thresholds = {
      ...thresholds,
      minCommentConfidence: thresholds.minCommentConfidence ?? comments.minConfidence,
    };
  }
  return normalized;
}
