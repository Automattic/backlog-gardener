import type { AttentionFacts, Item, Recap, Reply } from '../domain.js';
import type { CompletionProvider } from './provider.js';
import { loadPromptSchema } from './prompts.js';
import { validateRecap } from './recap.js';

export interface AnalyzeInput {
  item: Item;
  replies: Reply[];
  attentionFacts: AttentionFacts;
  productName: string;
  provider: CompletionProvider;
}

function sourceType(item: Item): Recap['sourceType'] {
  if (item.sourceType === 'github') return 'github_issue';
  if (item.sourceType === 'wporg-reviews') return 'wporg_review';
  return 'wporg_forum';
}

export async function analyzeItem(
  input: AnalyzeInput,
): Promise<{ recap: Recap; usage: { inputTokens: number; outputTokens: number } }> {
  const schema = await loadPromptSchema('analyze');
  const result = await input.provider.complete<unknown>({
    promptId: 'analyze',
    promptVersion: 'v1',
    inputs: {
      product: input.productName,
      sourceType: sourceType(input.item),
      title: input.item.title,
      url: input.item.url,
      body: input.item.body,
      replies: input.replies.map((reply) => ({ author: reply.author, body: reply.body, createdAt: reply.createdAt })),
      attentionFacts: input.attentionFacts,
    },
    schema,
    maxTokens: 2_000,
    timeoutMs: 60_000,
  });
  return { recap: validateRecap(result.output), usage: result.usage };
}
