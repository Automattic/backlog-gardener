import { describe, expect, it } from 'vitest';

import { AnthropicCompletionProvider } from '../../src/gardener/llm/anthropic.js';

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

describe('AnthropicCompletionProvider', () => {
  it('sends prompt as tool-use structured output request', async () => {
    const calls: unknown[] = [];
    const provider = new AnthropicCompletionProvider({
      model: 'claude-test',
      client: {
        messages: {
          create: async (args: unknown) => {
            calls.push(args);
            return {
              model: 'claude-test',
              usage: { input_tokens: 11, output_tokens: 7 },
              content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_recap', input: recap }],
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
      schema: { type: 'object' },
      maxTokens: 2000,
      timeoutMs: 60000,
    });

    expect(result.output.summary).toContain('Apple Pay');
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
    expect(JSON.stringify(calls[0])).toContain('emit_recap');
    expect(JSON.stringify(calls[0])).toContain('Apple Pay vanishes');
  });
});
