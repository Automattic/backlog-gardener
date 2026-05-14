import type { TriageProfile } from '../config/index.js';
import type { Recap } from '../domain.js';
import { AnthropicCompletionProvider } from './anthropic.js';
import { OpenAICompletionProvider, OpenAIEmbeddingProvider, type EmbeddingProvider } from './openai.js';
import { FakeCompletionProvider, type CompletionProvider } from './provider.js';

type CompletionRole = 'triage' | 'evaluator' | 'verifier';
type CompletionConfig = TriageProfile['llm']['completion'];

function heuristicRecap(itemTitle: string, itemUrl: string, sourceType: Recap['sourceType']): Recap {
  return {
    decision: 'surface',
    sourceType,
    shortTitle: shortTitleFromItemTitle(itemTitle),
    summary: itemTitle,
    novelty: 'new',
    bestSolution: 'Investigate the report and confirm whether it reproduces on the current product release.',
    risks: [],
    confidence: 'medium',
    evidence: [
      {
        label: 'Source report',
        detail: 'The source item describes a potentially actionable product issue.',
        sourceUrl: itemUrl,
        quote: null,
      },
    ],
    relatedLinks: [],
    reason: 'Local deterministic recap; no remote LLM provider was used for this item.',
  };
}

function shortTitleFromItemTitle(itemTitle: string): string {
  const trimmed = itemTitle.trim().replace(/\s+/g, ' ').replace(/\.+$/, '');
  if (trimmed.length === 0) return 'Untitled';
  return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 79).trimEnd()}…`;
}

function recapSourceType(sourceType: unknown): Recap['sourceType'] {
  if (sourceType === 'github_issue' || sourceType === 'wporg_review' || sourceType === 'wporg_forum') return sourceType;
  if (sourceType === 'github') return 'github_issue';
  if (sourceType === 'wporg-reviews') return 'wporg_review';
  return 'wporg_forum';
}

function requireEnv(name: string, provider: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${provider} provider requires ${name} to be set`);
  return value;
}

export function createLocalCompletionProvider(): CompletionProvider {
  return new FakeCompletionProvider((inputs) =>
    heuristicRecap(String(inputs.title ?? 'Untitled'), String(inputs.url ?? ''), recapSourceType(inputs.sourceType)),
  );
}

export function createLocalEmbeddingProvider(): EmbeddingProvider {
  return {
    name: 'local',
    model: 'hash-v1',
    async embed(texts) {
      return {
        vectors: texts.map((text) => {
          const buckets = [0, 0, 0, 0, 0, 0, 0, 0];
          for (const word of text.toLowerCase().split(/\W+/).filter(Boolean)) {
            let hash = 0;
            for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
            buckets[hash % buckets.length]! += 1;
          }
          return buckets;
        }),
        usage: { tokens: 0 },
      };
    },
  };
}

export function createEmbeddingProvider(profile: TriageProfile): EmbeddingProvider {
  const config = profile.llm.embedding;
  if (config.provider === 'local') return createLocalEmbeddingProvider();
  return new OpenAIEmbeddingProvider({
    apiKey: requireEnv('OPENAI_API_KEY', 'OpenAI embeddings'),
    model: config.model,
  });
}

function providerForConfig(config: CompletionConfig): CompletionProvider {
  if (config.provider === 'local') return createLocalCompletionProvider();
  if (config.provider === 'anthropic') {
    return new AnthropicCompletionProvider({
      apiKey: requireEnv('ANTHROPIC_API_KEY', 'Anthropic'),
      model: config.model,
      ...(config.thinking ? { thinkingEffort: config.thinking } : {}),
    });
  }
  return new OpenAICompletionProvider({
    apiKey: requireEnv('OPENAI_API_KEY', 'OpenAI'),
    model: config.model,
    ...(config.thinking ? { thinkingEffort: config.thinking } : {}),
  });
}

export function completionConfigForRole(profile: TriageProfile, role: CompletionRole): CompletionConfig {
  return profile.llm.roles[role] ?? profile.llm.completion;
}

export function createCompletionProviderForRole(profile: TriageProfile, role: CompletionRole): CompletionProvider {
  return providerForConfig(completionConfigForRole(profile, role));
}

export function createCompletionProvider(profile: TriageProfile): CompletionProvider {
  return providerForConfig(profile.llm.completion);
}
