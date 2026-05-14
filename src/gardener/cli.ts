#!/usr/bin/env node

import 'dotenv/config';

import { Command, Option } from 'commander';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { importFeedback, markFeedback } from './feedback/commands.js';
import { createCompletionProvider, createCompletionProviderForRole, createEmbeddingProvider } from './llm/factory.js';
import { parseLookback, runBackfill, renderBackfillSummary } from './pipeline/backfill.js';
import { runSweep, renderRunSummary } from './pipeline/orchestrator.js';
import { renderProgressEvent } from './progress.js';
import { startReviewServer } from './review/server.js';
import { syncProfileSources } from './sources/code.js';
import { readStatus, renderStatus } from './status.js';
import { loadTriageProfile } from './config/index.js';

export type SweepLane = 'hot' | 'warm' | 'cold';

export interface CliDependencies {
  runSweep?: typeof runSweep;
  syncProfileSources?: typeof syncProfileSources;
}

const EXTERNAL_WRITE_MODE_UNIMPLEMENTED =
  'External write mode is not implemented yet. Re-run with --dry-run to generate the action plan without external writes.';

function defaultStatePath(productSlug: string): string {
  return join('.gardener-state', `${productSlug}.db`);
}

function hasLocalOutputPublisher(profile: Awaited<ReturnType<typeof loadTriageProfile>>): boolean {
  return profile.publishers.reviewLane.some((publisher) => publisher.name === 'local-markdown');
}

export function buildProgram(deps: CliDependencies = {}): Command {
  const program = new Command();
  const runPipeline = deps.runSweep ?? runSweep;
  const syncSources = deps.syncProfileSources ?? syncProfileSources;

  program.name('gardener').description('Backlog Gardener local action-planning CLI').version('0.0.0');

  program
    .command('run')
    .description('run the full Backlog Gardener pipeline and produce an action plan')
    .requiredOption('--profile <path>', 'path to a triage profile YAML file')
    .addOption(new Option('--lane <lane>', 'run lane').choices(['hot', 'warm', 'cold']).default('warm'))
    .option('--dry-run', 'run the full pipeline but perform no external writes')
    .option('--no-sync-sources', 'skip automatic source checkout sync before verification')
    .option('--json', 'emit machine-readable JSON')
    .option('--max-items <count>', 'limit the number of source items processed for a test run', (value) => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('--max-items must be a positive integer');
      return parsed;
    })
    .addOption(new Option('--state <path>', 'developer override for the internal SQLite state path').hideHelp())
    .action(
      async (opts: {
        profile: string;
        state?: string;
        lane: SweepLane;
        dryRun?: boolean;
        syncSources?: boolean;
        json?: boolean;
        maxItems?: number;
      }) => {
        const profile = await loadTriageProfile(opts.profile);
        if (!hasLocalOutputPublisher(profile)) {
          throw new Error(
            'gardener run requires a local-markdown publisher so it can write portable action artifacts.',
          );
        }
        if (!opts.dryRun) throw new Error(EXTERNAL_WRITE_MODE_UNIMPLEMENTED);
        const statePath = opts.state ?? defaultStatePath(profile.product.slug);
        const onProgress = opts.json
          ? undefined
          : (event: Parameters<typeof renderProgressEvent>[0]) =>
              process.stderr.write(`${renderProgressEvent(event)}\n`);
        if (opts.syncSources !== false) {
          try {
            const syncResults = syncSources(profile);
            if (!opts.json) {
              for (const result of syncResults) {
                process.stderr.write(`Source ${result.status}: ${result.repo} -> ${result.path}\n`);
              }
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`Source sync skipped: ${message}\n`);
          }
        }
        const summary = await runPipeline({
          profile,
          statePath,
          lane: opts.lane,
          command: 'run',
          dryRun: true,
          externalWritesEnabled: false,
          completionProvider: createCompletionProvider(profile),
          triageCompletionProvider: createCompletionProviderForRole(profile, 'triage'),
          evaluatorCompletionProvider: createCompletionProviderForRole(profile, 'evaluator'),
          verifierCompletionProvider: createCompletionProviderForRole(profile, 'verifier'),
          embeddingProvider: createEmbeddingProvider(profile),
          ...(opts.maxItems ? { maxItems: opts.maxItems } : {}),
          ...(onProgress ? { onProgress } : {}),
        });
        process.stdout.write(
          opts.json ? `${JSON.stringify(summary, null, 2)}\n` : renderRunSummary(summary, { statePath }),
        );
      },
    );

  program
    .command('backfill')
    .description('backfill source history for calibration and reference context')
    .requiredOption('--profile <path>', 'path to a triage profile YAML file')
    .requiredOption('--state <path>', 'path to the local SQLite state database')
    .option('--since <duration>', 'lookback window, for example 365d')
    .option('--json', 'emit machine-readable JSON')
    .action(async (opts: { profile: string; state: string; since?: string; json?: boolean }) => {
      const profile = await loadTriageProfile(opts.profile);
      const since = parseLookback(opts.since);
      const onProgress = opts.json
        ? undefined
        : (event: Parameters<typeof renderProgressEvent>[0]) => process.stderr.write(`${renderProgressEvent(event)}\n`);
      const summary = await runBackfill({
        profile,
        statePath: opts.state,
        ...(since ? { since } : {}),
        ...(onProgress ? { onProgress } : {}),
      });
      process.stdout.write(opts.json ? `${JSON.stringify(summary, null, 2)}\n` : renderBackfillSummary(summary));
    });

  const sources = program.command('sources').description('manage local source checkouts');

  sources
    .command('sync')
    .description('clone or update configured source repositories for verifier code context')
    .requiredOption('--profile <path>', 'path to a triage profile YAML file')
    .option('--root <path>', 'local checkout root', '.gardener-worktrees')
    .action(async (opts: { profile: string; root: string }) => {
      const profile = await loadTriageProfile(opts.profile);
      const results = syncProfileSources(profile, opts.root);
      if (results.length === 0) {
        process.stdout.write('No source repositories are configured for checkout.\n');
        return;
      }
      for (const result of results) {
        process.stdout.write(`${result.status}: ${result.repo} -> ${result.path}\n`);
      }
    });

  program
    .command('review')
    .description('open a local web UI for reviewing findings and recording feedback')
    .requiredOption('--state <path>', 'path to the local SQLite state database')
    .option('--host <host>', 'host to bind', '127.0.0.1')
    .option('--port <port>', 'port to bind', (value) => Number.parseInt(value, 10), 4317)
    .action(async (opts: { state: string; host: string; port: number }) => {
      const server = await startReviewServer({ statePath: opts.state, host: opts.host, port: opts.port });
      process.stdout.write(`Backlog Gardener review UI: ${server.url}\n`);
      process.stdout.write('Press Ctrl+C to stop.\n');
    });

  program
    .command('status')
    .description('show recent runs, findings, feedback, and budget status')
    .requiredOption('--state <path>', 'path to the local SQLite state database')
    .option('--json', 'emit machine-readable JSON')
    .action((opts: { state: string; json?: boolean }) => {
      const summary = readStatus(opts.state);
      process.stdout.write(opts.json ? `${JSON.stringify(summary, null, 2)}\n` : renderStatus(summary));
    });

  const feedback = program.command('feedback').description('record or import human review feedback');

  feedback
    .command('mark')
    .description('record structured feedback for one finding')
    .argument('<findingId>', 'finding id to mark')
    .requiredOption('--state <path>', 'path to the local SQLite state database')
    .requiredOption('--verdict <verdict>', 'useful, maybe-useful, or not-useful')
    .option('--reason <reason...>', 'one or more reason codes')
    .requiredOption('--status <status>', 'finding lifecycle status')
    .option('--note <text>', 'free-form reviewer note')
    .option('--reviewer <id>', 'reviewer identifier')
    .action(
      (
        findingId: string,
        opts: { state: string; verdict: string; reason?: string[]; status: string; note?: string; reviewer?: string },
      ) => {
        process.stdout.write(
          markFeedback({
            statePath: opts.state,
            findingId,
            verdict: opts.verdict as Parameters<typeof markFeedback>[0]['verdict'],
            reasons: opts.reason ?? [],
            status: opts.status as Parameters<typeof markFeedback>[0]['status'],
            note: opts.note ?? null,
            reviewer: opts.reviewer ?? null,
          }),
        );
      },
    );

  feedback
    .command('import')
    .description('import feedback blocks from a markdown digest or finding file')
    .argument('<path>', 'markdown file to import')
    .requiredOption('--state <path>', 'path to the local SQLite state database')
    .option('--reviewer <id>', 'default reviewer identifier')
    .action((path: string, opts: { state: string; reviewer?: string }) => {
      process.stdout.write(importFeedback({ statePath: opts.state, path, reviewer: opts.reviewer ?? null }));
    });

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && fileURLToPath(import.meta.url) === entry;
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
