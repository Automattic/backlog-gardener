import { StoreDb } from '../store/db.js';
import { SqliteAppStateStore } from './state.js';
import type { AppJobRecord } from './types.js';

export interface JobFilters {
  status?: AppJobRecord['status'];
  repo?: string;
  limit?: number;
}

export function readAppJobs(statePath: string, filters: JobFilters = {}): AppJobRecord[] {
  const db = new StoreDb(statePath);
  try {
    const state = new SqliteAppStateStore(db.db);
    return filterJobs(state.listJobs(), filters);
  } finally {
    db.close();
  }
}

export function renderAppJobList(jobs: AppJobRecord[]): string {
  if (jobs.length === 0) return 'No app jobs found.\n';
  return `${jobs
    .map((job) => {
      const repo = job.repo ?? 'unknown-repo';
      const error = job.error ? ` error=${singleLine(job.error)}` : '';
      const nextRun = job.nextRunAt ? ` nextRun=${job.nextRunAt}` : '';
      return `${job.id} ${job.status} ${job.eventName} ${repo} attempts=${job.attempts}/${job.maxAttempts}${nextRun} delivery=${job.deliveryId} created=${job.createdAt}${error}`;
    })
    .join('\n')}\n`;
}

function filterJobs(jobs: AppJobRecord[], filters: JobFilters): AppJobRecord[] {
  const filtered = jobs
    .filter((job) => !filters.status || job.status === filters.status)
    .filter((job) => !filters.repo || job.repo === filters.repo)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return filters.limit ? filtered.slice(0, filters.limit) : filtered;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, 160);
}
