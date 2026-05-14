import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import type { GitHubSourceConfig, SourceConfig, TriageProfile } from '../config/index.js';

export const DEFAULT_CODE_ROOT = '.gardener-worktrees';

export type SourceSyncStatus = 'cloned' | 'updated' | 'reset';

export interface GitRunner {
  run(args: string[], cwd?: string): void;
}

const systemGitRunner: GitRunner = {
  run(args, cwd) {
    const result = spawnSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
    }
  },
};

function runGit(args: string[], cwd?: string, runner: GitRunner = systemGitRunner): void {
  runner.run(args, cwd);
}

export function checkoutPathForGitHubSource(source: GitHubSourceConfig, root = DEFAULT_CODE_ROOT): string {
  const [owner, repo] = source.repo.split('/');
  return join(root, source.host, owner ?? 'unknown', repo ?? source.repo);
}

export function codeRootForSource(source: SourceConfig, root = DEFAULT_CODE_ROOT): string | null {
  if (source.type !== 'github' || !source.code.checkout) return null;
  return checkoutPathForGitHubSource(source, root);
}

export interface SourceSyncResult {
  sourceKey: string;
  repo: string;
  path: string;
  status: SourceSyncStatus;
}

function branchRef(branch: string | undefined): string {
  return branch ?? 'HEAD';
}

function remoteRef(branch: string | undefined): string {
  return branch ? `origin/${branch}` : 'FETCH_HEAD';
}

function updateExistingCheckout(args: { path: string; branch?: string; runner?: GitRunner }): SourceSyncStatus {
  const ref = branchRef(args.branch);
  runGit(['fetch', '--depth', '1', 'origin', ref], args.path, args.runner);
  if (args.branch) runGit(['checkout', args.branch], args.path, args.runner);
  try {
    runGit(['pull', '--ff-only'], args.path, args.runner);
    return 'updated';
  } catch {
    runGit(['reset', '--hard', remoteRef(args.branch)], args.path, args.runner);
    runGit(['clean', '-fd'], args.path, args.runner);
    return 'reset';
  }
}

export function syncGitHubSource(
  source: GitHubSourceConfig,
  root = DEFAULT_CODE_ROOT,
  runner: GitRunner = systemGitRunner,
): SourceSyncResult | null {
  if (!source.code.checkout) return null;
  const path = checkoutPathForGitHubSource(source, root);
  const sourceKey = source.key ?? `github:${source.repo}`;
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    const url = `https://${source.host}/${source.repo}.git`;
    runGit(
      ['clone', '--depth', '1', ...(source.code.branch ? ['--branch', source.code.branch] : []), url, path],
      undefined,
      runner,
    );
    return { sourceKey, repo: source.repo, path, status: 'cloned' };
  }
  const status = updateExistingCheckout({
    path,
    ...(source.code.branch ? { branch: source.code.branch } : {}),
    runner,
  });
  return { sourceKey, repo: source.repo, path, status };
}

export function syncProfileSources(profile: TriageProfile, root = DEFAULT_CODE_ROOT): SourceSyncResult[] {
  const results: SourceSyncResult[] = [];
  for (const source of profile.sources) {
    if (source.type !== 'github') continue;
    const result = syncGitHubSource(source, root);
    if (result) results.push(result);
  }
  return results;
}

export function sourceCodeRoots(profile: TriageProfile, root = DEFAULT_CODE_ROOT): Map<string, string> {
  const map = new Map<string, string>();
  for (const source of profile.sources) {
    const codeRoot = codeRootForSource(source, root);
    if (codeRoot) map.set(source.key ?? `${source.type}:${source.type === 'github' ? source.repo : ''}`, codeRoot);
  }
  return map;
}
