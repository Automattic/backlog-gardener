import { describe, expect, it } from 'vitest';

import { renderAppJobList } from '../../src/gardener/app/jobs.js';
import type { AppJobRecord } from '../../src/gardener/app/types.js';

const job: AppJobRecord = {
  id: 'app_job_1',
  deliveryId: 'delivery-1',
  eventName: 'issues',
  repo: 'o/r',
  status: 'failed',
  payloadJson: '{}',
  createdAt: '2026-05-15T00:00:00.000Z',
  startedAt: '2026-05-15T00:00:01.000Z',
  completedAt: '2026-05-15T00:00:02.000Z',
  error: 'Something failed\nwith details',
};

describe('app job rendering', () => {
  it('renders compact job rows', () => {
    expect(renderAppJobList([job])).toContain(
      'app_job_1 failed issues o/r delivery=delivery-1 created=2026-05-15T00:00:00.000Z error=Something failed with details',
    );
  });

  it('renders empty state', () => {
    expect(renderAppJobList([])).toBe('No app jobs found.\n');
  });
});
