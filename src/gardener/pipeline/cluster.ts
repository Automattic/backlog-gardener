import type { Item } from '../domain.js';
import { newId, nowIso } from '../ids.js';
import type { DatabaseHandle } from '../store/db.js';

export interface ClusterResult {
  clusterId: string;
  itemIds: string[];
  theme: string;
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(value: string): void {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value: string): string {
    this.add(value);
    const parent = this.parent.get(value);
    if (parent === undefined || parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }

  groups(): string[][] {
    const groups = new Map<string, string[]>();
    for (const value of this.parent.keys()) {
      const root = this.find(value);
      groups.set(root, [...(groups.get(root) ?? []), value]);
    }
    return [...groups.values()];
  }
}

function themeFor(items: Item[]): string {
  const representative = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return representative?.title ?? 'Related reports';
}

export function buildDuplicateClusters(args: {
  db: DatabaseHandle;
  items: Item[];
  reviewPolicyHash: string;
}): ClusterResult[] {
  const uf = new UnionFind();
  for (const item of args.items) uf.add(item.id);
  const duplicateEdges = args.db
    .prepare('SELECT item_a_id, item_b_id FROM edges WHERE verdict = ? AND review_policy_hash = ?')
    .all('duplicate', args.reviewPolicyHash) as Array<Record<string, unknown>>;
  for (const edge of duplicateEdges) {
    uf.union(String(edge.item_a_id), String(edge.item_b_id));
  }

  const itemById = new Map(args.items.map((item) => [item.id, item]));
  const upsertCluster = args.db.prepare(`
    INSERT INTO clusters (id, theme, representative_item_id, review_policy_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      theme = excluded.theme,
      representative_item_id = excluded.representative_item_id,
      updated_at = excluded.updated_at
  `);
  const insertMember = args.db.prepare('INSERT OR IGNORE INTO cluster_items (cluster_id, item_id) VALUES (?, ?)');

  const results: ClusterResult[] = [];
  for (const group of uf.groups().filter((ids) => ids.length > 1)) {
    const members = group.map((id) => itemById.get(id)).filter((item): item is Item => item !== undefined);
    if (members.length < 2) continue;
    const sortedIds = members.map((item) => item.id).sort();
    const existing = args.db
      .prepare(
        `SELECT ci.cluster_id FROM cluster_items ci
         WHERE ci.item_id IN (${sortedIds.map(() => '?').join(',')})
         GROUP BY ci.cluster_id
         HAVING COUNT(*) > 0
         LIMIT 1`,
      )
      .get(...sortedIds) as { cluster_id?: string } | undefined;
    const clusterId = existing?.cluster_id ?? newId('cls');
    const theme = themeFor(members);
    const representative = [...members].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]!;
    const now = nowIso();
    upsertCluster.run(clusterId, theme, representative.id, args.reviewPolicyHash, now, now);
    for (const itemId of sortedIds) insertMember.run(clusterId, itemId);
    results.push({ clusterId, itemIds: sortedIds, theme });
  }
  return results;
}
