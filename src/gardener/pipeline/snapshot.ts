import type { Item, Reply, Snapshot } from '../domain.js';
import { nowIso } from '../ids.js';
import { snapshotHash } from '../normalize/hashes.js';
import type { RepositoryBundle } from '../store/index.js';

export function persistSnapshot(args: { repos: RepositoryBundle; item: Item; replies: Reply[] }): Snapshot {
  const hash = snapshotHash({
    itemBodyHash: args.item.bodyHash,
    replyBodyHashes: args.replies.map((reply) => reply.bodyHash),
  });
  const snapshot = args.repos.snapshots.insert({
    itemId: args.item.id,
    snapshotHash: hash,
    bodyHash: args.item.bodyHash,
    takenAt: nowIso(),
  });
  args.repos.items.upsert({ ...args.item, latestSnapshotHash: snapshot.snapshotHash });
  return snapshot;
}
