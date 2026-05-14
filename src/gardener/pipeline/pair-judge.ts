import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Item } from '../domain.js';
import type { CompletionProvider } from '../llm/provider.js';

export interface PairJudgeVerdict {
  verdict: 'duplicate' | 'related' | 'unique';
  confidence: 'low' | 'medium' | 'high';
  reason: string;
}

export interface JudgedPair {
  itemAId: string;
  itemBId: string;
  score: number;
  verdict: PairJudgeVerdict['verdict'];
  reason: string;
}

function promptRoot(): string {
  return join(new URL('../prompts/dedup', import.meta.url).pathname);
}

async function loadSchema(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(promptRoot(), 'schema.json'), 'utf8')) as Record<string, unknown>;
}

function itemText(item: Item): string {
  return [`Title: ${item.title}`, `URL: ${item.url}`, '', item.body].join('\n');
}

export async function judgeCandidatePairs(args: {
  productName: string;
  items: Item[];
  pairs: Array<{ itemAId: string; itemBId: string; score: number; reason: string }>;
  provider: CompletionProvider;
  maxPairs: number;
}): Promise<{ pairs: JudgedPair[]; usage: { inputTokens: number; outputTokens: number } }> {
  const schema = await loadSchema();
  const itemById = new Map(args.items.map((item) => [item.id, item]));
  const judged: JudgedPair[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  for (const pair of args.pairs.slice(0, args.maxPairs)) {
    const itemA = itemById.get(pair.itemAId);
    const itemB = itemById.get(pair.itemBId);
    if (!itemA || !itemB) continue;
    const result = await args.provider.complete<PairJudgeVerdict>({
      promptId: 'dedup',
      promptVersion: 'v1',
      inputs: {
        product: args.productName,
        itemA: itemText(itemA),
        itemB: itemText(itemB),
      },
      schema,
      maxTokens: 600,
      timeoutMs: 30_000,
    });
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    if (result.output.verdict !== 'unique') {
      judged.push({
        itemAId: pair.itemAId,
        itemBId: pair.itemBId,
        score: pair.score,
        verdict: result.output.verdict,
        reason: `llm-pair-judge: ${result.output.reason}`,
      });
    }
  }
  return { pairs: judged, usage };
}
