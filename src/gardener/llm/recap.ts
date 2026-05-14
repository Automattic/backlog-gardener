import { z } from 'zod';

const EvidenceSchema = z
  .object({
    label: z.string().min(1),
    detail: z.string().min(1),
    sourceUrl: z.string().url(),
    quote: z.string().nullable(),
  })
  .strict();

const RelatedLinkSchema = z
  .object({
    url: z.string().url(),
    title: z.string().min(1),
  })
  .strict();

export const RecapSchema = z
  .object({
    decision: z.enum(['surface', 'defer', 'dedupe', 'needs-info']),
    sourceType: z.enum(['github_issue', 'wporg_review', 'wporg_forum']),
    shortTitle: z
      .string()
      .min(1)
      .max(80)
      .refine((value) => !value.endsWith('.'), { message: 'shortTitle must not end with a period' }),
    summary: z.string().min(1),
    novelty: z.enum(['new', 'recurring', 'escalating', 'longstanding']),
    bestSolution: z.string(),
    risks: z.array(z.string()),
    confidence: z.enum(['high', 'medium', 'low']),
    evidence: z.array(EvidenceSchema),
    relatedLinks: z.array(RelatedLinkSchema),
    reason: z.string().min(1),
  })
  .strict()
  .refine(
    (recap) =>
      recap.decision !== 'surface' ||
      ((recap.confidence === 'high' || recap.confidence === 'medium') &&
        recap.evidence.length > 0 &&
        recap.bestSolution.trim().length > 0),
    {
      path: ['decision'],
      message: 'surface requires medium/high confidence, evidence, and bestSolution',
    },
  )
  .refine((recap) => recap.decision !== 'needs-info' || recap.bestSolution.trim().length > 0, {
    path: ['bestSolution'],
    message: 'needs-info requires bestSolution to say what is missing',
  })
  .refine((recap) => recap.decision !== 'dedupe' || recap.relatedLinks.length > 0, {
    path: ['relatedLinks'],
    message: 'dedupe requires at least one related link',
  });

export type ValidatedRecap = z.infer<typeof RecapSchema>;

export function validateRecap(value: unknown): ValidatedRecap {
  return RecapSchema.parse(value);
}
