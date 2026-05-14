import type { Item } from '../domain.js';
import type { EmbeddingProvider } from '../llm/openai.js';
import type { DatabaseHandle } from '../store/db.js';
import { newId, nowIso } from '../ids.js';

export interface StoredEmbedding {
  id: string;
  itemId: string;
  provider: string;
  model: string;
  bodyHash: string;
  vector: number[];
}

function parseVector(value: unknown): number[] {
  return typeof value === 'string' ? (JSON.parse(value) as number[]) : [];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function getEmbedding(
  db: DatabaseHandle,
  args: { itemId: string; provider: string; model: string; bodyHash: string },
): StoredEmbedding | null {
  const row = db
    .prepare('SELECT * FROM embeddings WHERE item_id = ? AND provider = ? AND model = ? AND body_hash = ?')
    .get(args.itemId, args.provider, args.model, args.bodyHash) as Record<string, unknown> | undefined;
  return row
    ? {
        id: String(row.id),
        itemId: String(row.item_id),
        provider: String(row.provider),
        model: String(row.model),
        bodyHash: String(row.body_hash),
        vector: parseVector(row.vector_json),
      }
    : null;
}

export async function embedMissingItems(args: {
  db: DatabaseHandle;
  items: Item[];
  provider: EmbeddingProvider;
}): Promise<{ embedded: number; tokens: number }> {
  const missing = args.items.filter(
    (item) =>
      !getEmbedding(args.db, {
        itemId: item.id,
        provider: args.provider.name,
        model: args.provider.model,
        bodyHash: item.bodyHash,
      }),
  );
  if (missing.length === 0) return { embedded: 0, tokens: 0 };
  const result = await args.provider.embed(missing.map((item) => `${item.title}\n\n${item.body}`));
  const insert = args.db.prepare(
    'INSERT INTO embeddings (id, item_id, provider, model, body_hash, vector_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  missing.forEach((item, index) => {
    insert.run(
      newId('emb'),
      item.id,
      args.provider.name,
      args.provider.model,
      item.bodyHash,
      JSON.stringify(result.vectors[index] ?? []),
      nowIso(),
    );
  });
  return { embedded: missing.length, tokens: result.usage.tokens };
}

export function topKSimilar(args: {
  db: DatabaseHandle;
  item: Item;
  provider: string;
  model: string;
  k: number;
  minScore: number;
}): Array<{ itemId: string; score: number }> {
  const current = getEmbedding(args.db, {
    itemId: args.item.id,
    provider: args.provider,
    model: args.model,
    bodyHash: args.item.bodyHash,
  });
  if (!current) return [];
  const rows = args.db
    .prepare('SELECT item_id, vector_json FROM embeddings WHERE provider = ? AND model = ? AND item_id != ?')
    .all(args.provider, args.model, args.item.id) as Array<Record<string, unknown>>;
  return rows
    .map((row) => ({
      itemId: String(row.item_id),
      score: cosineSimilarity(current.vector, parseVector(row.vector_json)),
    }))
    .filter((entry) => entry.score >= args.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, args.k);
}
