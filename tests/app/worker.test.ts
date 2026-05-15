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
        state.completeJob(job.id, 'completed');
      },
    });

    expect(result).toEqual({ processed: 1, retried: 0, deadLettered: 0 });
    expect(processed).toEqual([first.id]);
    expect(state.listJobs()).toEqual([
      expect.objectContaining({ id: first.id, status: 'completed', attempts: 1 }),
      expect.objectContaining({ id: second.id, status: 'queued', attempts: 0 }),
    ]);
  });

  it('skips queued jobs scheduled for the future', async () => {
    const state = new InMemoryAppStateStore();
    const job = state.enqueueJob({ deliveryId: 'delivery-1', eventName: 'issues', repo: 'o/r', payloadJson: '{}' });
    state.scheduleJobRetry(job.id, '2026-05-15T00:01:00.000Z', 'try later');

    const result = await runAppWorkerTick({
      state,
      now: new Date('2026-05-15T00:00:00.000Z'),
      processJob: async () => {
        throw new Error('should not run');
      },
    });

    expect(result).toEqual({ processed: 0, retried: 0, deadLettered: 0 });
    expect(state.listJobs()[0]).toEqual(expect.objectContaining({ id: job.id, status: 'queued', attempts: 0 }));
  });

  it('schedules retry with exponential backoff when processing throws before max attempts', async () => {
    const state = new InMemoryAppStateStore();
    const job = state.enqueueJob({ deliveryId: 'delivery-1', eventName: 'issues', repo: 'o/r', payloadJson: '{}' });
    const errors: string[] = [];

    const result = await runAppWorkerTick({
      state,
      now: new Date('2026-05-15T00:00:00.000Z'),
      baseRetryDelaySeconds: 10,
      processJob: async () => {
        throw new Error('boom');
      },
      onError: (_job, error) => errors.push(error instanceof Error ? error.message : String(error)),
    });

    expect(result).toEqual({ processed: 0, retried: 1, deadLettered: 0 });
    expect(errors).toEqual(['boom']);
    expect(state.listJobs()[0]).toEqual(
      expect.objectContaining({
        id: job.id,
        status: 'queued',
        attempts: 1,
        nextRunAt: '2026-05-15T00:00:10.000Z',
        error: 'boom',
      }),
    );
  });

  it('dead-letters jobs after max attempts', async () => {
    const state = new InMemoryAppStateStore();
    const job = state.enqueueJob({ deliveryId: 'delivery-1', eventName: 'issues', repo: 'o/r', payloadJson: '{}' });
    state.startJob(job.id);
    state.scheduleJobRetry(job.id, '2026-05-15T00:00:00.000Z', 'first failure');
    state.startJob(job.id);
    state.scheduleJobRetry(job.id, '2026-05-15T00:00:00.000Z', 'second failure');

    const result = await runAppWorkerTick({
      state,
      now: new Date('2026-05-15T00:00:00.000Z'),
      processJob: async () => {
        throw new Error('final failure');
      },
    });

    expect(result).toEqual({ processed: 0, retried: 0, deadLettered: 1 });
    expect(state.listJobs()[0]).toEqual(
      expect.objectContaining({ id: job.id, status: 'dead_letter', attempts: 3, error: 'final failure' }),
    );
  });
});
