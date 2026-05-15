import YAML from 'yaml';
import { z } from 'zod';

const SECRET_COMMAND_PATTERNS = [
  /(^|[;&|\s])printenv($|[;&|\s])/i,
  /(^|[;&|\s])env($|[;&|\s])/i,
  /(^|[;&|\s])set($|[;&|\s])/i,
  /(^|[;&|\s])cat\s+\.env\b/i,
  /\.secrets\b/i,
  /GARDENER_APP_PRIVATE_KEY|GARDENER_APP_WEBHOOK_SECRET|OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN/i,
  /\b(curl|wget)\b[^|;&]*\|\s*(sh|bash|zsh)\b/i,
] as const;

function safeInvestigationCommand(command: string): boolean {
  return !SECRET_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

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
    investigation: z
      .object({
        enabled: z.boolean().default(false),
        defaultRecipe: z.string().min(1).default('default'),
        allowedCommandPrefixes: z.array(z.string().min(1)).default([]),
        recipes: z
          .record(
            z.string().min(1),
            z
              .object({
                description: z.string().default(''),
                timeoutSeconds: z.number().int().positive().max(1800).default(300),
                maxOutputChars: z.number().int().positive().max(100_000).default(20_000),
                commands: z
                  .array(
                    z.string().min(1).refine(safeInvestigationCommand, {
                      message:
                        'investigation recipe commands must not dump env/secrets or pipe remote scripts into a shell',
                    }),
                  )
                  .min(1),
              })
              .strict(),
          )
          .default({}),
      })
      .strict()
      .default({ enabled: false, defaultRecipe: 'default', allowedCommandPrefixes: [], recipes: {} }),
    prReviews: z
      .object({
        enabled: z.boolean().default(false),
        liveMode: z.boolean().default(false),
        eventType: z.string().min(1).default('backlog-gardener.pr-review'),
        includeDrafts: z.boolean().default(false),
        inlineComments: z.boolean().default(false),
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
        inlineComments: false,
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
  return GitHubAppConfigSchema.parse((YAML.parse(source) as Record<string, unknown> | null | undefined) ?? {});
}
