import { describe, expect, it } from 'vitest';

import { InMemoryAppStateStore } from '../../src/gardener/app/state.js';
import { runAppWorkerTick } from '../../src/gardener/app/worker.js';

describe('app worker tick', () => {
  it('processes queued jobs in created order up to the limit', async () => {
    const state = new InMemoryAppStateStore();
    const first = state.enqueueJob({ deliveryId: 'delivery-1', eventName: 'issues', repo: 'o/r', payloadJson: '{}' });
    const second = state.enqueueJob({ deliveryId: 'delivery-2', eventName: 'issues', repo: 'o/r', payloadJson: '{}' });
    const processed: string[] = [];

    const result = await runAppWorkerTick({
      state,
      limit: 1,
      processJob: async (job) => {
        processed.push(job.id);
        state.startJob(job.id);
        state.completeJob(job.id, 'completed');
      },
    });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(processed).toEqual([first.id]);
    expect(state.listJobs()).toEqual([
      expect.objectContaining({ id: first.id, status: 'completed' }),
      expect.objectContaining({ id: second.id, status: 'queued' }),
    ]);
  });

  it('marks a job failed when processing throws', async () => {
    const state = new InMemoryAppStateStore();
    const job = state.enqueueJob({ deliveryId: 'delivery-1', eventName: 'issues', repo: 'o/r', payloadJson: '{}' });
    const errors: string[] = [];

    const result = await runAppWorkerTick({
      state,
      processJob: async () => {
        throw new Error('boom');
      },
      onError: (_job, error) => errors.push(error instanceof Error ? error.message : String(error)),
    });

    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(errors).toEqual(['boom']);
    expect(state.listJobs()[0]).toEqual(expect.objectContaining({ id: job.id, status: 'failed', error: 'boom' }));
  });
});
