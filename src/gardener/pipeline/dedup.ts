import type { Item } from '../domain.js';
import type { DatabaseHandle } from '../store/db.js';
import { newId, nowIso } from '../ids.js';
import { topKSimilar } from './embed.js';

export type EdgeVerdict = 'duplicate' | 'related' | 'unique';

function pairKey(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

export function titleFingerprint(item: Item): string {
  return item.title
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function generateCandidatePairs(args: {
  db: DatabaseHandle;
  items: Item[];
  provider: string;
  model: string;
  topK: number;
  minScore: number;
}): Array<{ itemAId: string; itemBId: string; score: number; reason: string }> {
  const pairs = new Map<string, { itemAId: string; itemBId: string; score: number; reason: string }>();
  const byFingerprint = new Map<string, Item[]>();
  for (const item of args.items) {
    const fp = titleFingerprint(item);
    byFingerprint.set(fp, [...(byFingerprint.get(fp) ?? []), item]);
  }
  for (const group of byFingerprint.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const left = group[i];
        const right = group[j];
        if (!left || !right) continue;
        const [itemAId, itemBId] = pairKey(left.id, right.id);
        pairs.set(`${itemAId}|${itemBId}`, { itemAId, itemBId, score: 1, reason: 'same-title-fingerprint' });
      }
    }
  }
  for (const item of args.items) {
    for (const neighbor of topKSimilar({
      db: args.db,
      item,
      provider: args.provider,
      model: args.model,
      k: args.topK,
      minScore: args.minScore,
    })) {
      const [itemAId, itemBId] = pairKey(item.id, neighbor.itemId);
      const key = `${itemAId}|${itemBId}`;
      if (!pairs.has(key)) {
        pairs.set(key, {
          itemAId,
          itemBId,
          score: neighbor.score,
          reason: 'embedding-neighbor',
        });
      }
    }
  }
  return [...pairs.values()];
}

export function persistEdges(args: {
  db: DatabaseHandle;
  pairs: Array<{ itemAId: string; itemBId: string; score: number; reason: string; verdict?: EdgeVerdict }>;
  reviewPolicyHash: string;
}): number {
  const insert = args.db.prepare(`
    INSERT OR IGNORE INTO edges (id, item_a_id, item_b_id, verdict, score, reason, review_policy_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let count = 0;
  for (const pair of args.pairs) {
    const verdict: EdgeVerdict = pair.verdict ?? (pair.score >= 0.9 ? 'duplicate' : 'related');
    const result = insert.run(
      newId('edg'),
      pair.itemAId,
      pair.itemBId,
      verdict,
      pair.score,
      pair.reason,
      args.reviewPolicyHash,
      nowIso(),
    ) as { changes?: number };
    count += result.changes ?? 0;
  }
  return count;
}

export function persistHeuristicEdges(args: {
  db: DatabaseHandle;
  pairs: Array<{ itemAId: string; itemBId: string; score: number; reason: string }>;
  reviewPolicyHash: string;
}): number {
  return persistEdges(args);
}
