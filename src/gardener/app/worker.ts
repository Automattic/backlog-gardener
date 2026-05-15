import type { AppStateStore } from './state.js';
import type { AppJobRecord } from './types.js';

export interface AppWorkerTickOptions {
  state: AppStateStore;
  limit?: number;
  processJob: (job: AppJobRecord) => Promise<void>;
  onError?: (job: AppJobRecord, error: unknown) => void;
}

export interface AppWorkerTickResult {
  processed: number;
  failed: number;
}

export async function runAppWorkerTick(options: AppWorkerTickOptions): Promise<AppWorkerTickResult> {
  const queuedJobs = options.state
    .listJobs()
    .filter((job) => job.status === 'queued')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, options.limit ?? 1);

  let processed = 0;
  let failed = 0;
  for (const job of queuedJobs) {
    try {
      await options.processJob(job);
      processed += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      options.state.completeJob(job.id, 'failed', message);
      options.onError?.(job, error);
    }
  }

  return { processed, failed };
}
