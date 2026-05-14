import { describe, expect, it } from 'vitest';

import { OpenAICompletionProvider, OpenAIEmbeddingProvider } from '../../src/gardener/llm/openai.js';

const recap = {
  decision: 'surface',
  sourceType: 'github_issue',
  shortTitle: 'Apple Pay disappears after cart update',
  summary: 'Apple Pay disappears after cart update.',
  novelty: 'new',
  bestSolution: 'Investigate checkout fragment rendering.',
  risks: [],
  confidence: 'medium',
  evidence: [
    {
      label: 'Source report',
      detail: 'Reporter describes the symptom.',
      sourceUrl: 'https://github.com/example-org/example-product/issues/8421',
      quote: null,
    },
  ],
  relatedLinks: [],
  reason: 'Actionable report.',
};

describe('OpenAICompletionProvider', () => {
  it('reports malformed structured output with actionable context', async () => {
    const provider = new OpenAICompletionProvider({
      model: 'gpt-test',
      client: {
        responses: {
          create: async () => ({
            model: 'gpt-test',
            output_text: '{"action":"accept',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        },
      } as never,
    });

    await expect(
      provider.complete({
        promptId: 'evaluate',
        promptVersion: 'v1',
        inputs: {},
        schema: { type: 'object' },
        maxTokens: 10,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/truncated/);
  });

  it('sends strict JSON schema response requests', async () => {
    const calls: unknown[] = [];
    const provider = new OpenAICompletionProvider({
      model: 'gpt-test',
      thinkingEffort: 'high',
      client: {
        responses: {
          create: async (args: unknown) => {
            calls.push(args);
            return {
              model: 'gpt-test',
              output_text: JSON.stringify(recap),
              usage: { input_tokens: 13, output_tokens: 17 },
            };
          },
        },
      } as never,
    });

    const result = await provider.complete<typeof recap>({
      promptId: 'analyze',
      promptVersion: 'v1',
      inputs: {
        product: 'Example Product',
        sourceType: 'github_issue',
        title: 'Apple Pay vanishes',
        url: 'https://github.com/example-org/example-product/issues/8421',
        body: 'Body',
        replies: [],
        attentionFacts: {},
      },
      schema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
      maxTokens: 2000,
      timeoutMs: 60000,
    });

    expect(result.output.summary).toContain('Apple Pay');
    expect(result.usage).toEqual({ inputTokens: 13, outputTokens: 17 });
    expect(JSON.stringify(calls[0])).toContain('json_schema');
    expect(JSON.stringify(calls[0])).toContain('Apple Pay vanishes');
    expect(JSON.stringify(calls[0])).toContain('high');
  });
});

describe('OpenAIEmbeddingProvider', () => {
  it('returns embedding vectors and usage', async () => {
    const provider = new OpenAIEmbeddingProvider({
      model: 'text-embedding-test',
      client: {
        embeddings: {
          create: async (args: unknown) => {
            expect(JSON.stringify(args)).toContain('checkout');
            return {
              data: [{ embedding: [0.1, 0.2, 0.3] }],
              usage: { total_tokens: 5 },
            };
          },
        },
      } as never,
    });

    await expect(provider.embed(['checkout issue'])).resolves.toEqual({
      vectors: [[0.1, 0.2, 0.3]],
      usage: { tokens: 5 },
    });
  });
});
