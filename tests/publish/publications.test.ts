import { describe, expect, it } from 'vitest';

import { payloadHash, recordPublication } from '../../src/gardener/publish/publications.js';
import { StoreDb } from '../../src/gardener/store/index.js';

describe('publication persistence', () => {
  it('hashes payloads and records publication rows', () => {
    const db = new StoreDb(':memory:');
    db.migrate();
    db.db
      .prepare(
        'INSERT INTO runs (id, profile_slug, lane, mode, status, started_at, summary_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('run_1', 'example-product', 'warm', 'review', 'completed', '2026-04-29T00:00:00.000Z', '{}');

    recordPublication({
      db: db.db,
      runId: 'run_1',
      findingId: null,
      publisher: 'slack',
      destination: 'https://hooks.slack.test',
      payload: 'hello',
      status: 'sent',
    });

    const row = db.db.prepare('SELECT publisher, payload_hash, status FROM publications').get() as {
      publisher: string;
      payload_hash: string;
      status: string;
    };
    expect(row).toEqual({ publisher: 'slack', payload_hash: payloadHash('hello'), status: 'sent' });
    db.close();
  });
});
