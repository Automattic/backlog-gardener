import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildProgram } from '../src/gardener/cli.js';
import type { SweepSummary } from '../src/gardener/pipeline/orchestrator.js';

function commandNames(): string[] {
  return buildProgram().commands.map((command) => command.name());
}

function summary(overrides: Partial<SweepSummary> = {}): SweepSummary {
  return {
    runId: 'run_test',
    command: 'run',
    dryRun: true,
    externalWritesEnabled: false,
    status: 'completed',
    itemsFetched: 1,
    repliesFetched: 0,
    findings: 1,
    surfaced: 1,
    actions: 1,
    prCandidates: 0,
    outputDir: 'out/example-product/run_test',
    digestPath: 'out/example-product/run_test/digest.md',
    actionsJsonlPath: 'out/example-product/run_test/actions.jsonl',
    actionsMarkdownPath: 'out/example-product/run_test/actions.md',
    actionsHtmlPath: 'out/example-product/run_test/actions.html',
    manifestPath: 'out/example-product/run_test/manifest.json',
    slackStatus: 'skipped',
    skippedExternalWriters: ['github'],
    usage: { completionCalls: 0, embeddingCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    embeddings: 0,
    dedupEdges: 0,
    clusters: 0,
    evaluations: 0,
    verifications: 0,
    ...overrides,
  };
}

function writeProfile(dir: string, options: { checkoutCode?: boolean } = {}): string {
  const path = join(dir, 'profile.yml');
  writeFileSync(
    path,
    `product:\n  name: Example Product\n  slug: example-product\nsources:\n  - type: github\n    host: github.com\n    repo: example-org/example-product\n${options.checkoutCode ? '    code:\n      checkout: true\n      branch: develop\n' : ''}llm:\n  completion:\n    provider: local\n    model: local\n  embedding:\n    provider: local\n    model: hash-v1\npublishers:\n  reviewLane:\n    - name: local-markdown\n      outputDir: ${JSON.stringify(join(dir, 'out/{runId}'))}\n  applyLane: []\n`,
  );
  return path;
}

describe('gardener CLI skeleton', () => {
  let dir: string | null = null;

  afterEach(() => {
    vi.restoreAllMocks();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('exposes the primary run command and support commands', () => {
    expect(commandNames()).toEqual(
      expect.arrayContaining(['run', 'backfill', 'sources', 'review', 'status', 'feedback']),
    );
    expect(commandNames()).not.toContain('sweep');
  });

  it('renders top-level help with run as the primary command', () => {
    const help = buildProgram().helpInformation();
    const runHelp =
      buildProgram()
        .commands.find((command) => command.name() === 'run')
        ?.helpInformation() ?? '';

    expect(help).toContain('Backlog Gardener local action-planning CLI');
    expect(help).toContain('run');
    expect(help).toContain('backfill');
    expect(help).toContain('feedback');
    expect(runHelp).toContain('--dry-run');
    expect(runHelp).toContain('--no-sync-sources');
    expect(runHelp).toContain('--max-items');
    expect(runHelp).not.toContain('--state');
  });

  it('runs the full pipeline in dry-run mode through the run command', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gardener-cli-'));
    const profilePath = writeProfile(dir);
    const runSweep = vi.fn(async () => summary());
    const program = buildProgram({ runSweep });
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await program.parseAsync(
      ['node', 'gardener', 'run', '--profile', profilePath, '--lane', 'warm', '--dry-run', '--json'],
      { from: 'node' },
    );

    expect(runSweep).toHaveBeenCalledWith(
      expect.objectContaining({
        statePath: join('.gardener-state', 'example-product.db'),
        command: 'run',
        dryRun: true,
        externalWritesEnabled: false,
      }),
    );
    expect(write).toHaveBeenCalledWith(expect.stringContaining('"actions": 1'));
    expect(write).not.toHaveBeenCalledWith(expect.stringContaining('"dryRun": true,\n  "profile"'));
  });

  it('syncs configured source checkouts before a dry-run', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gardener-cli-'));
    const profilePath = writeProfile(dir, { checkoutCode: true });
    const runSweep = vi.fn(async () => summary());
    const syncProfileSources = vi.fn(() => [
      {
        sourceKey: 'github:example-org/example-product',
        repo: 'example-org/example-product',
        path: '.gardener-worktrees/github.com/example-org/example-product',
        status: 'updated' as const,
      },
    ]);
    const program = buildProgram({ runSweep, syncProfileSources });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await program.parseAsync(['node', 'gardener', 'run', '--profile', profilePath, '--dry-run'], { from: 'node' });

    expect(syncProfileSources).toHaveBeenCalledTimes(1);
    expect(runSweep).toHaveBeenCalledTimes(1);
  });

  it('continues when automatic source sync fails', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gardener-cli-'));
    const profilePath = writeProfile(dir, { checkoutCode: true });
    const runSweep = vi.fn(async () => summary());
    const syncProfileSources = vi.fn(() => {
      throw new Error('git pull failed');
    });
    const program = buildProgram({ runSweep, syncProfileSources });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await program.parseAsync(['node', 'gardener', 'run', '--profile', profilePath, '--dry-run'], { from: 'node' });

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Source sync skipped: git pull failed'));
    expect(runSweep).toHaveBeenCalledTimes(1);
  });

  it('can skip automatic source sync for debugging', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gardener-cli-'));
    const profilePath = writeProfile(dir, { checkoutCode: true });
    const runSweep = vi.fn(async () => summary());
    const syncProfileSources = vi.fn(() => []);
    const program = buildProgram({ runSweep, syncProfileSources });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await program.parseAsync(['node', 'gardener', 'run', '--profile', profilePath, '--dry-run', '--no-sync-sources'], {
      from: 'node',
    });

    expect(syncProfileSources).not.toHaveBeenCalled();
    expect(runSweep).toHaveBeenCalledTimes(1);
  });

  it('fails non-dry-run run mode until external writers are implemented', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gardener-cli-'));
    const profilePath = writeProfile(dir);
    const runSweep = vi.fn(async () => summary());
    const program = buildProgram({ runSweep });

    await expect(
      program.parseAsync(['node', 'gardener', 'run', '--profile', profilePath], { from: 'node' }),
    ).rejects.toThrow('External write mode is not implemented yet');
    expect(runSweep).not.toHaveBeenCalled();
  });

  it('exposes nested feedback commands', () => {
    const feedback = buildProgram().commands.find((command) => command.name() === 'feedback');

    expect(feedback?.commands.map((command) => command.name())).toEqual(expect.arrayContaining(['mark', 'import']));
  });
});
