import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { retryAppJob } from '../../src/gardener/app/jobs.js';
import { SqliteAppStateStore } from '../../src/gardener/app/state.js';
import { StoreDb } from '../../src/gardener/store/db.js';

function withState<T>(callback: (path: string, state: SqliteAppStateStore) => T): T {
  const path = join(mkdtempSync(join(tmpdir(), 'gardener-jobs-')), 'state.db');
  const db = new StoreDb(path);
  try {
    return callback(path, new SqliteAppStateStore(db.db));
  } finally {
    db.close();
  }
}

describe('job retry CLI helpers', () => {
  it('requeues a failed job immediately', () => {
    withState((path, state) => {
      const job = state.enqueueJob({ deliveryId: 'delivery-1', eventName: 'issues', repo: 'o/r', payloadJson: '{}' });
      state.startJob(job.id);
      state.completeJob(job.id, 'failed', 'boom');

      const retried = retryAppJob(path, job.id, new Date('2026-05-15T00:00:00.000Z'));

      expect(retried).toEqual(
        expect.objectContaining({
          id: job.id,
          status: 'queued',
          attempts: 1,
          nextRunAt: '2026-05-15T00:00:00.000Z',
          error: 'manually retried at 2026-05-15T00:00:00.000Z',
        }),
      );
    });
  });

  it('rejects retrying an already queued job', () => {
    withState((path, state) => {
      const job = state.enqueueJob({ deliveryId: 'delivery-1', eventName: 'issues', repo: 'o/r', payloadJson: '{}' });

      expect(() => retryAppJob(path, job.id)).toThrow(/only failed or dead_letter jobs/);
    });
  });
});
