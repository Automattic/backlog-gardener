import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseTriageProfile } from '../../src/gardener/config/index.js';
import {
  completionConfigForRole,
  createCompletionProvider,
  createCompletionProviderForRole,
  createEmbeddingProvider,
} from '../../src/gardener/llm/factory.js';

function profile(provider: 'anthropic' | 'openai' | 'local') {
  return parseTriageProfile({
    product: { name: 'Example Product', slug: 'example-product' },
    sources: [{ type: 'github', host: 'github.com', repo: 'example-org/example-product' }],
    llm: {
      completion: { provider, model: provider === 'anthropic' ? 'claude-test' : 'gpt-test' },
      embedding: { provider: 'openai', model: 'embedding-test' },
    },
  });
}

describe('completion provider factory', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('creates local fake provider without remote credentials', () => {
    const provider = createCompletionProvider(profile('local'));

    expect(provider.name).toBe('fake');
  });

  it('requires Anthropic credentials for Anthropic provider', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');

    expect(() => createCompletionProvider(profile('anthropic'))).toThrow('ANTHROPIC_API_KEY');
  });

  it('creates local embedding provider without remote credentials', async () => {
    const provider = createEmbeddingProvider(
      parseTriageProfile({
        product: { name: 'Example Product', slug: 'example-product' },
        sources: [{ type: 'github', host: 'github.com', repo: 'example-org/example-product' }],
        llm: {
          completion: { provider: 'local', model: 'local' },
          embedding: { provider: 'local', model: 'hash-v1' },
        },
      }),
    );

    await expect(provider.embed(['apple pay', 'refund'])).resolves.toMatchObject({ usage: { tokens: 0 } });
  });

  it('resolves role-specific completion model and thinking effort', () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const parsed = parseTriageProfile({
      product: { name: 'Example Product', slug: 'example-product' },
      sources: [{ type: 'github', host: 'github.com', repo: 'example-org/example-product' }],
      llm: {
        completion: { provider: 'openai', model: 'gpt-default', thinking: 'medium' },
        roles: { evaluator: { provider: 'openai', model: 'gpt-evaluator', thinking: 'high' } },
        embedding: { provider: 'local', model: 'hash-v1' },
      },
    });

    expect(completionConfigForRole(parsed, 'triage')).toMatchObject({ model: 'gpt-default', thinking: 'medium' });
    const evaluator = createCompletionProviderForRole(parsed, 'evaluator');
    expect(evaluator.model).toBe('gpt-evaluator');
    expect(evaluator.thinkingEffort).toBe('high');
  });

  it('creates OpenAI provider when OPENAI_API_KEY is set', () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');

    const provider = createCompletionProvider(profile('openai'));

    expect(provider.name).toBe('openai');
    expect(provider.model).toBe('gpt-test');
  });
});
