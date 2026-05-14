import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const DEFAULT_APP_WORKTREE_ROOT = '.gardener-worktrees/app';

export interface AppGitRunner {
  run(args: string[], cwd?: string): void;
}

const systemRunner: AppGitRunner = {
  run(args, cwd) {
    const result = spawnSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  },
};

export interface EnsureAppCheckoutResult {
  path: string;
  status: 'cloned' | 'updated' | 'reset';
}

export function appCheckoutPath(args: { owner: string; repo: string; root?: string }): string {
  return join(args.root ?? DEFAULT_APP_WORKTREE_ROOT, 'github.com', args.owner, args.repo);
}

export function ensureAppRepoCheckout(args: {
  owner: string;
  repo: string;
  branch?: string;
  root?: string;
  runner?: AppGitRunner;
}): EnsureAppCheckoutResult {
  const runner = args.runner ?? systemRunner;
  const path = appCheckoutPath(args);
  const branch = args.branch ?? 'main';
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    runner.run([
      'clone',
      '--depth',
      '1',
      '--branch',
      branch,
      `https://github.com/${args.owner}/${args.repo}.git`,
      path,
    ]);
    return { path, status: 'cloned' };
  }
  runner.run(['fetch', '--depth', '1', 'origin', branch], path);
  runner.run(['checkout', branch], path);
  try {
    runner.run(['pull', '--ff-only'], path);
    return { path, status: 'updated' };
  } catch {
    runner.run(['reset', '--hard', `origin/${branch}`], path);
    runner.run(['clean', '-fd'], path);
    return { path, status: 'reset' };
  }
}
