import type { TriageProfile } from '../config/index.js';
import { newId, nowIso } from '../ids.js';
import type { ProgressReporter } from '../progress.js';
import { createSourceAdapter } from '../sources/index.js';
import type { FetchLike } from '../sources/http.js';
import { RepositoryBundle, StoreDb } from '../store/index.js';
import { persistSnapshot } from './snapshot.js';

export interface BackfillSummary {
  runId: string;
  status: 'completed' | 'failed';
  itemsFetched: number;
  repliesFetched: number;
  snapshots: number;
  referenceOnly: number;
}

export function parseLookback(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d+)(d|w|m|y)$/.exec(value);
  if (!match) throw new Error('Expected --since to look like 30d, 12w, 6m, or 1y');
  const amount = Number(match[1]);
  const unit = match[2];
  const days = unit === 'd' ? amount : unit === 'w' ? amount * 7 : unit === 'm' ? amount * 30 : amount * 365;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function runBackfill(args: {
  profile: TriageProfile;
  statePath: string;
  since?: Date;
  fetchImpl?: FetchLike;
  onProgress?: ProgressReporter;
}): Promise<BackfillSummary> {
  const db = new StoreDb(args.statePath);
  db.migrate();
  const repos = new RepositoryBundle(db.db);
  const runId = newId('run');
  db.db
    .prepare(
      'INSERT INTO runs (id, profile_slug, lane, mode, status, started_at, summary_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(runId, args.profile.product.slug, 'backfill', 'backfill', 'in_progress', nowIso(), '{}');
  args.onProgress?.({ type: 'run-started', runId, mode: 'backfill' });

  let itemsFetched = 0;
  let repliesFetched = 0;
  let snapshots = 0;
  let referenceOnly = 0;
  try {
    for (const source of args.profile.sources) {
      const adapter = createSourceAdapter(source, args.fetchImpl);
      args.onProgress?.({ type: 'source-started', sourceKey: adapter.sourceKey });
      const itemStream = adapter.fetchBackfillItems ? adapter.fetchBackfillItems(args.since) : adapter.fetchItems();
      for await (const itemInput of itemStream) {
        const item = repos.items.upsert(itemInput);
        args.onProgress?.({
          type: 'item-fetched',
          title: item.title,
          url: item.url,
          referenceOnly: item.referenceOnly,
        });
        itemsFetched += 1;
        if (item.referenceOnly) referenceOnly += 1;
        const replies = [];
        for await (const replyInput of adapter.fetchReplies(item)) {
          replies.push(repos.replies.upsert({ ...replyInput, itemId: item.id }));
          repliesFetched += 1;
        }
        persistSnapshot({ repos, item, replies });
        snapshots += 1;
      }
    }
    const summary: BackfillSummary = {
      runId,
      status: 'completed',
      itemsFetched,
      repliesFetched,
      snapshots,
      referenceOnly,
    };
    db.db
      .prepare('UPDATE runs SET status = ?, finished_at = ?, summary_json = ? WHERE id = ?')
      .run('completed', nowIso(), JSON.stringify(summary), runId);
    args.onProgress?.({ type: 'run-finished', runId, status: 'completed' });
    return summary;
  } catch (error) {
    db.db
      .prepare('UPDATE runs SET status = ?, finished_at = ?, summary_json = ? WHERE id = ?')
      .run(
        'failed',
        nowIso(),
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        runId,
      );
    args.onProgress?.({ type: 'run-finished', runId, status: 'failed' });
    throw error;
  } finally {
    db.close();
  }
}

export function renderBackfillSummary(summary: BackfillSummary): string {
  return [
    `Backlog Gardener backfill completed: ${summary.runId}`,
    `Items: ${summary.itemsFetched}`,
    `Replies: ${summary.repliesFetched}`,
    `Snapshots: ${summary.snapshots}`,
    `Reference-only: ${summary.referenceOnly}`,
    '',
  ].join('\n');
}
