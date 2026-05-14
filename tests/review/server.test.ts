import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { bodyHash } from '../../src/gardener/normalize/hashes.js';
import { createReviewServer } from '../../src/gardener/review/server.js';
import { RepositoryBundle, StoreDb } from '../../src/gardener/store/index.js';

function listen(server: ReturnType<typeof createReviewServer>): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address) resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe('review server', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('renders findings and accepts local feedback', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gardener-review-'));
    const statePath = join(dir, 'state.db');
    const db = new StoreDb(statePath);
    db.migrate();
    const repos = new RepositoryBundle(db.db);
    db.db
      .prepare(
        'INSERT INTO runs (id, profile_slug, lane, mode, status, started_at, summary_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('run_1', 'example-product', 'warm', 'review', 'completed', '2026-04-29T00:00:00Z', '{}');
    const item = repos.items.upsert({
      sourceKey: 'github:x/y',
      sourceType: 'github',
      sourceId: 'x/y#1',
      url: 'https://github.com/x/y/issues/1',
      title: 'Apple Pay vanishes',
      body: 'Body',
      author: null,
      createdAt: '2026-04-29T00:00:00Z',
      updatedAt: '2026-04-29T00:00:00Z',
      bodyHash: bodyHash('Body'),
      latestSnapshotHash: null,
      referenceOnly: false,
      metadata: {},
      raw: {},
    });
    const finding = repos.findings.upsert({
      targetKind: 'item',
      targetId: item.id,
      reviewPolicyHash: 'test',
      snapshotHash: 'snap',
      recap: {
        decision: 'surface',
        sourceType: 'github_issue',
        shortTitle: 'Apple Pay issue',
        summary: 'Apple Pay issue',
        novelty: 'new',
        bestSolution: 'Investigate',
        risks: [],
        confidence: 'high',
        evidence: [{ label: 'Source', detail: 'Detail', sourceUrl: item.url, quote: null }],
        relatedLinks: [],
        reason: 'Reason',
      },
      attentionFacts: {
        protectedLabel: { present: false, labels: [] },
        linkedOpenPr: { present: false, urls: [] },
        maintainerActivity: { status: 'none', lastAt: null, actors: [] },
        dismissedOrSnoozed: { present: false, reason: null },
      },
      decision: {
        finalDecision: 'surface',
        recapDecision: 'surface',
        gateReasons: [],
        surfacingReason: 'Good candidate',
      },
      surfacingLabel: 'developer-ready',
      lifecycleStatus: 'surfaced',
    });
    db.close();

    const server = createReviewServer({ statePath });
    const url = await listen(server);
    const html = await (await fetch(url)).text();
    expect(html).toContain('Apple Pay issue');

    const response = await fetch(`${url}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        findingId: finding.id,
        verdict: 'useful',
        status: 'accepted',
        reason: 'actionable',
        note: 'Looks good',
      }),
      redirect: 'manual',
    });
    expect(response.status).toBe(303);
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

    const check = new StoreDb(statePath);
    check.migrate();
    expect(check.db.prepare('SELECT verdict FROM feedback WHERE finding_id = ?').get(finding.id)).toEqual({
      verdict: 'useful',
    });
    check.close();
  });
});
