import type { AppStateStore } from './state.js';
import type { AppJobRecord } from './types.js';

export interface AppWorkerTickOptions {
  state: AppStateStore;
  limit?: number;
  now?: Date;
  baseRetryDelaySeconds?: number;
  processJob: (job: AppJobRecord) => Promise<void>;
  onError?: (job: AppJobRecord, error: unknown) => void;
}

export interface AppWorkerTickResult {
  processed: number;
  retried: number;
  deadLettered: number;
}

export async function runAppWorkerTick(options: AppWorkerTickOptions): Promise<AppWorkerTickResult> {
  const now = options.now ?? new Date();
  const queuedJobs = options.state
    .listJobs()
    .filter((job) => job.status === 'queued')
    .filter((job) => !job.nextRunAt || Date.parse(job.nextRunAt) <= now.getTime())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, options.limit ?? 1);

  let processed = 0;
  let retried = 0;
  let deadLettered = 0;
  for (const job of queuedJobs) {
    try {
      options.state.startJob(job.id);
      await options.processJob(job);
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempt = job.attempts + 1;
      if (attempt >= job.maxAttempts) {
        deadLettered += 1;
        options.state.completeJob(job.id, 'dead_letter', message);
      } else {
        retried += 1;
        options.state.scheduleJobRetry(job.id, nextRetryAt(now, options.baseRetryDelaySeconds ?? 30, attempt), message);
      }
      options.onError?.(job, error);
    }
  }

  return { processed, retried, deadLettered };
}

function nextRetryAt(now: Date, baseDelaySeconds: number, attempt: number): string {
  const delaySeconds = baseDelaySeconds * 2 ** Math.max(0, attempt - 1);
  return new Date(now.getTime() + delaySeconds * 1000).toISOString();
}
