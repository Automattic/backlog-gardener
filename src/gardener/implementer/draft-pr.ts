import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { ActionTarget, ProposedPrArtifacts } from '../actions/types.js';
import type { ActionPlanningEntry } from '../actions/plan.js';
import type { DraftPrCandidacy } from '../actions/pr-candidacy.js';
import type { DraftPrImplementer, DraftPrImplementerResult } from './types.js';

const COPY_EXCLUDE = new Set(['.git', 'node_modules', 'vendor', 'dist', 'coverage', 'out', '.gardener-state']);

export interface PlannedDraftPr {
  actionId: string;
  findingId: string;
  title: string;
  body: string;
  target: Extract<ActionTarget, { system: 'github'; kind: 'pull_request' }>;
  artifacts: ProposedPrArtifacts;
  rationale: string;
}

export class NoopDraftPrImplementer implements DraftPrImplementer {
  readonly name = 'noop';

  async implement(): Promise<DraftPrImplementerResult> {
    return { status: 'not_attempted', reason: 'No draft PR implementer is configured.' };
  }
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 56) || 'backlog-gardener-fix'
  );
}

function issueNumber(entry: ActionPlanningEntry): number | null {
  const value = entry.item?.metadata.issueNumber;
  if (typeof value === 'number') return value;
  const match = entry.item?.url.match(/\/issues\/(\d+)/) ?? entry.item?.sourceId.match(/#(\d+)$/);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

function repoFromEntry(entry: ActionPlanningEntry): string {
  if (entry.item?.sourceId.includes('#')) return entry.item.sourceId.split('#')[0] || 'unknown/repo';
  const match = entry.item?.url.match(/github\.com\/([^/]+\/[^/]+)\//);
  return match?.[1] ?? 'unknown/repo';
}

function copyWorkspace(sourceRoot: string, workspacePath: string): void {
  rmSync(workspacePath, { recursive: true, force: true });
  mkdirSync(workspacePath, { recursive: true });
  cpSync(sourceRoot, workspacePath, {
    recursive: true,
    filter: (source) => !COPY_EXCLUDE.has(basename(source)),
  });
}

export async function createDraftPrArtifacts(args: {
  actionId: string;
  outputDir: string;
  sourceRoot: string | undefined;
  entry: ActionPlanningEntry;
  candidacy: DraftPrCandidacy;
  implementer: DraftPrImplementer;
  baseBranch: string;
}): Promise<PlannedDraftPr | null> {
  if (!args.sourceRoot || !existsSync(args.sourceRoot)) return null;
  const workspacePath = join(args.outputDir, 'pr-workspaces', args.actionId);
  copyWorkspace(args.sourceRoot, workspacePath);
  const result = await args.implementer.implement({
    entry: args.entry,
    candidacy: args.candidacy,
    sourceRoot: args.sourceRoot,
    workspacePath,
  });
  if (result.status !== 'patch_created' || result.patch.trim().length === 0) return null;

  const candidatesDir = join(args.outputDir, 'pr-candidates');
  mkdirSync(candidatesDir, { recursive: true });
  const patchPath = join(candidatesDir, `${args.actionId}.patch`);
  const prBodyPath = join(candidatesDir, `${args.actionId}.pr.md`);
  const verificationPath = join(candidatesDir, `${args.actionId}.verification.json`);
  writeFileSync(patchPath, result.patch.endsWith('\n') ? result.patch : `${result.patch}\n`);
  writeFileSync(prBodyPath, result.body.endsWith('\n') ? result.body : `${result.body}\n`);
  writeFileSync(
    verificationPath,
    `${JSON.stringify(
      {
        schemaVersion: 'gardener.pr_verification.v1',
        actionId: args.actionId,
        implementer: args.implementer.name,
        status: result.verification.status,
        commands: result.verification.commands,
        summary: result.verification.summary,
        changedFiles: result.changedFiles,
        workspacePath,
      },
      null,
      2,
    )}\n`,
  );

  const repo = repoFromEntry(args.entry);
  const number = issueNumber(args.entry);
  return {
    actionId: args.actionId,
    findingId: args.entry.finding.id,
    title: result.title,
    body: result.body,
    target: {
      system: 'github',
      kind: 'pull_request',
      repo,
      baseBranch: args.baseBranch,
      branchName: `gardener/${number ? `${number}-` : ''}${slug(result.title)}`,
    },
    artifacts: {
      patchPath,
      prBodyPath,
      verificationPath,
      verificationStatus: result.verification.status,
    },
    rationale: args.candidacy.reason,
  };
}
