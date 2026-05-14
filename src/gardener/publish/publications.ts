import { createHash } from 'node:crypto';

import { newId, nowIso } from '../ids.js';
import type { DatabaseHandle } from '../store/db.js';

export function payloadHash(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

export function recordPublication(args: {
  db: DatabaseHandle;
  runId: string;
  findingId: string | null;
  publisher: string;
  destination: string;
  payload: string;
  status: 'sent' | 'failed' | 'skipped' | 'written';
}): void {
  args.db
    .prepare(
      `
    INSERT INTO publications (id, run_id, finding_id, publisher, destination, payload_hash, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      newId('pub'),
      args.runId,
      args.findingId,
      args.publisher,
      args.destination,
      payloadHash(args.payload),
      args.status,
      nowIso(),
    );
}
