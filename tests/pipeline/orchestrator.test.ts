import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseTriageProfile } from '../../src/gardener/config/index.js';
import { runSweep } from '../../src/gardener/pipeline/orchestrator.js';
import { RepositoryBundle, StoreDb } from '../../src/gardener/store/index.js';
import type { FetchLike } from '../../src/gardener/sources/http.js';
import type { DraftPrImplementer } from '../../src/gardener/implementer/types.js';

function response(body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
}

describe('sweep orchestration', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('runs a fixture-backed GitHub sweep into SQLite, Slack, and local markdown', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gardener-sweep-'));
    const profile = parseTriageProfile({
      product: { name: 'Example Product', slug: 'example-product' },
      sources: [{ type: 'github', host: 'github.com', repo: 'example-org/example-product' }],
      llm: {
        completion: { provider: 'anthropic', model: 'claude' },
        embedding: { provider: 'openai', model: 'embedding' },
      },
      publishers: {
        reviewLane: [
          { name: 'local-markdown', outputDir: join(dir, 'out/{runId}') },
          { name: 'slack', webhookEnv: 'TEST_SLACK_WEBHOOK_URL' },
        ],
        applyLane: [],
      },
    });
    const fetchImpl: FetchLike = async (input, init) => {
      const url = String(input);
      if (url.startsWith('https://hooks.slack.test/')) {
        expect(String(init?.body)).toContain('Backlog Gardener finished');
        return response('ok');
      }
      if (url.includes('/comments')) return response([]);
      return response([
        {
          number: 8421,
          html_url: 'https://github.com/example-org/example-product/issues/8421',
          title: 'Apple Pay vanishes',
          body: 'Apple Pay disappears after cart update.',
          user: { login: 'merchant' },
          created_at: '2026-04-20T00:00:00Z',
          updated_at: '2026-04-21T00:00:00Z',
          state: 'open',
          author_association: 'NONE',
          labels: [],
        },
      ]);
    };

    process.env.TEST_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/T000/B000/xxx';
    const summary = await runSweep({
      profile,
      statePath: join(dir, 'state.db'),
      lane: 'warm',
      fetchImpl,
    });

    expect(summary.itemsFetched).toBe(1);
    expect(summary.findings).toBe(1);
    expect(summary.surfaced).toBe(1);
    expect(summary.digestPath).toBeTruthy();
    expect(summary.slackStatus).toBe('sent');
    expect(summary.usage.completionCalls).toBe(1);
    expect(summary.usage.estimatedCostUsd).toBeGreaterThan(0);
    expect(readFileSync(summary.digestPath!, 'utf8')).toContain('Apple Pay vanishes');
    const db = new StoreDb(join(dir, 'state.db'));
    db.migrate();
    const pubs = db.db.prepare('SELECT publisher, status FROM publications ORDER BY publisher').all() as Array<{
      publisher: string;
      status: string;
    }>;
    expect(pubs).toEqual(
      expect.arrayContaining([
        { publisher: 'local-markdown', status: 'written' },
        { publisher: 'slack', status: 'sent' },
      ]),
    );
    db.close();
    delete process.env.TEST_SLACK_WEBHOOK_URL;
  });

  it('runs a dry-run action plan without posting to Slack', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gardener-run-'));
    const profile = parseTriageProfile({
      product: { name: 'Example Product', slug: 'example-product' },
      sources: [{ type: 'github', host: 'github.com', repo: 'example-org/example-product' }],
      llm: {
        completion: { provider: 'local', model: 'local' },
        embedding: { provider: 'local', model: 'hash-v1' },
      },
      publishers: {
        reviewLane: [
          { name: 'local-markdown', outputDir: join(dir, 'out/{runId}') },
          { name: 'slack', webhookEnv: 'TEST_SLACK_WEBHOOK_URL' },
        ],
        applyLane: [],
      },
    });
    const fetchImpl: FetchLike = async (input) => {
      const url = String(input);
      if (url.startsWith('https://hooks.slack.test/')) throw new Error('Slack should not be called in dry-run mode');
      if (url.includes('/comments')) return response([]);
      return response([
        {
          number: 8421,
          html_url: 'https://github.com/example-org/example-product/issues/8421',
          title: 'Apple Pay vanishes',
          body: 'Apple Pay disappears after cart update.',
          user: { login: 'merchant' },
          created_at: '2026-04-20T00:00:00Z',
          updated_at: '2026-04-21T00:00:00Z',
          state: 'open',
          author_association: 'NONE',
          labels: [],
        },
      ]);
    };

    process.env.TEST_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/T000/B000/xxx';
    const summary = await runSweep({
      profile,
      statePath: join(dir, 'state.db'),
      lane: 'warm',
      command: 'run',
      dryRun: true,
      externalWritesEnabled: false,
      fetchImpl,
    });

    expect(summary.command).toBe('run');
    expect(summary.dryRun).toBe(true);
    expect(summary.externalWritesEnabled).toBe(false);
    expect(summary.slackStatus).toBe('skipped');
    expect(summary.skippedExternalWriters).toEqual(expect.arrayContaining(['slack']));
    expect(summary.actions).toBe(0);
    expect(summary.prCandidates).toBe(0);
    expect(summary.actionsJsonlPath).toBeTruthy();
    expect(summary.actionsMarkdownPath).toBeTruthy();
    expect(summary.actionsHtmlPath).toBeTruthy();
    expect(summary.manifestPath).toBeTruthy();
    expect(readFileSync(summary.actionsJsonlPath!, 'utf8')).toBe('');
    const md = readFileSync(summary.actionsMarkdownPath!, 'utf8');
    expect(md).toContain('## Surfaced findings without an action');
    expect(md).toContain('No net-new implementation context');
    const html = readFileSync(summary.actionsHtmlPath!, 'utf8');
    expect(html).toContain('Surfaced findings without an action');
    const manifest = JSON.parse(readFileSync(summary.manifestPath!, 'utf8')) as {
      dryRun: boolean;
      externalWritesEnabled: boolean;
      counts: { actions: number; prCandidates: number; surfacedWithoutAction: number };
      surfacedDrops: Array<{ findingId: string; reason: string }>;
      outputs: { actionsHtml: string };
    };
    expect(manifest).toMatchObject({
      dryRun: true,
      externalWritesEnabled: false,
      counts: { actions: 0, prCandidates: 0, surfacedWithoutAction: 1 },
      outputs: { actionsHtml: 'actions.html' },
    });
    expect(manifest.surfacedDrops).toHaveLength(1);
    expect(manifest.surfacedDrops[0]).toMatchObject({ reason: 'no-net-new-context-for-existing-issue' });
    delete process.env.TEST_SLACK_WEBHOOK_URL;
  });

  it('emits an open_pr action only after an isolated implementer creates patch artifacts', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gardener-run-'));
    const codeRoot = join(dir, 'code');
    const repoRoot = join(codeRoot, 'github.com', 'example-org', 'example-product');
    mkdirSync(join(repoRoot, 'client', 'components', 'account-balances'), { recursive: true });
    writeFileSync(
      join(repoRoot, 'client', 'components', 'account-balances', 'index.tsx'),
      'export function DepositsLoadingSkeleton() { return <div>deposits loading skeleton payments overview help icon</div>; }\n',
    );
    const profile = parseTriageProfile({
      product: { name: 'Example Product', slug: 'example-product' },
      sources: [
        {
          type: 'github',
          host: 'github.com',
          repo: 'example-org/example-product',
          code: { checkout: true, branch: 'develop' },
        },
      ],
      llm: {
        completion: { provider: 'local', model: 'local' },
        embedding: { provider: 'local', model: 'hash-v1' },
      },
      publishers: {
        reviewLane: [{ name: 'local-markdown', outputDir: join(dir, 'out/{runId}') }],
        applyLane: [],
      },
    });
    const fetchImpl: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes('/comments')) return response([]);
      return response([
        {
          number: 9547,
          html_url: 'https://github.com/example-org/example-product/issues/9547',
          title: 'Deposits card on payments overview screen looks weird in loading state',
          body: 'Steps to reproduce: go to Payments Overview, scroll to Deposits, and see the loading skeleton. Expected centered loading placeholder. Actual help icon appears inside the loading state screenshot.',
          user: { login: 'merchant' },
          created_at: '2026-04-20T00:00:00Z',
          updated_at: '2026-04-21T00:00:00Z',
          state: 'open',
          author_association: 'NONE',
          labels: [],
        },
      ]);
    };
    const implementer: DraftPrImplementer = {
      name: 'fake',
      async implement(input) {
        writeFileSync(
          join(input.workspacePath, 'client', 'components', 'account-balances', 'index.tsx'),
          'export function DepositsLoadingSkeleton() { return <div>fixed loading skeleton</div>; }\n',
        );
        return {
          status: 'patch_created',
          title: 'Fix Deposits loading skeleton layout',
          body: '## What\nFixes the Deposits loading skeleton layout.\n',
          patch:
            'diff --git a/client/components/account-balances/index.tsx b/client/components/account-balances/index.tsx\n--- a/client/components/account-balances/index.tsx\n+++ b/client/components/account-balances/index.tsx\n@@\n-help icon\n+fixed loading skeleton\n',
          changedFiles: ['client/components/account-balances/index.tsx'],
          verification: { status: 'not_run', commands: [], summary: 'Fake implementer test.' },
        };
      },
    };

    const summary = await runSweep({
      profile,
      statePath: join(dir, 'state.db'),
      lane: 'warm',
      command: 'run',
      dryRun: true,
      externalWritesEnabled: false,
      fetchImpl,
      codeRoot,
      draftPrImplementer: implementer,
    });

    expect(summary.prCandidates).toBe(1);
    expect(summary.actions).toBe(1);
    const action = JSON.parse(readFileSync(summary.actionsJsonlPath!, 'utf8').trim()) as {
      type: string;
      prArtifacts: { patchPath: string; prBodyPath: string; verificationPath: string };
    };
    expect(action.type).toBe('open_pr');
    expect(readFileSync(action.prArtifacts.patchPath, 'utf8')).toContain('diff --git');
    expect(readFileSync(action.prArtifacts.prBodyPath, 'utf8')).toContain('Fixes the Deposits loading skeleton');
    expect(readFileSync(action.prArtifacts.verificationPath, 'utf8')).toContain('Fake implementer test');
    expect(readFileSync(summary.actionsHtmlPath!, 'utf8')).toContain('Fix Deposits loading skeleton layout');
    expect(readFileSync(summary.actionsHtmlPath!, 'utf8')).toContain('open_pr');
    expect(readFileSync(join(repoRoot, 'client', 'components', 'account-balances', 'index.tsx'), 'utf8')).toContain(
      'help icon',
    );
  });

  it('suppresses unchanged findings that were dismissed in prior feedback', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gardener-sweep-'));
    const statePath = join(dir, 'state.db');
    const profile = parseTriageProfile({
      product: { name: 'Example Product', slug: 'example-product' },
      sources: [{ type: 'github', host: 'github.com', repo: 'example-org/example-product' }],
      llm: {
        completion: { provider: 'anthropic', model: 'claude' },
        embedding: { provider: 'openai', model: 'embedding' },
      },
      publishers: {
        reviewLane: [{ name: 'local-markdown', outputDir: join(dir, 'out/{runId}') }],
        applyLane: [],
      },
    });
    const fetchImpl: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes('/comments')) return response([]);
      return response([
        {
          number: 8421,
          html_url: 'https://github.com/example-org/example-product/issues/8421',
          title: 'Apple Pay vanishes',
          body: 'Apple Pay disappears after cart update.',
          user: { login: 'merchant' },
          created_at: '2026-04-20T00:00:00Z',
          updated_at: '2026-04-21T00:00:00Z',
          state: 'open',
          author_association: 'NONE',
          labels: [],
        },
      ]);
    };

    const first = await runSweep({ profile, statePath, lane: 'warm', fetchImpl });
    expect(first.surfaced).toBe(1);
    const db = new StoreDb(statePath);
    db.migrate();
    const repos = new RepositoryBundle(db.db);
    const finding = repos.findings.list(1)[0]!;
    repos.feedback.upsert({
      findingId: finding.id,
      verdict: 'not-useful',
      reasons: ['already-known'],
      status: 'dismissed',
      note: 'Already known.',
      reviewer: 'dev@example.com',
    });
    db.close();

    const second = await runSweep({ profile, statePath, lane: 'warm', fetchImpl });
    expect(second.surfaced).toBe(0);
  });
});
