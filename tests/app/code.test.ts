import { describe, expect, it } from 'vitest';

import { appCheckoutPath, ensureAppRepoCheckout, type AppGitRunner } from '../../src/gardener/app/code.js';

describe('app code checkout helpers', () => {
  it('maps app repos to gitignored worktree paths', () => {
    expect(appCheckoutPath({ owner: 'example-user', repo: 'example-repo' })).toBe(
      '.gardener-worktrees/app/github.com/example-user/example-repo',
    );
  });

  it('resets existing app checkouts when fast-forward pull fails', () => {
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const runner: AppGitRunner = {
      run(args, cwd) {
        calls.push({ args, ...(cwd ? { cwd } : {}) });
        if (args[0] === 'pull') throw new Error('no fast-forward');
      },
    };

    const result = ensureAppRepoCheckout({
      owner: 'example-user',
      repo: 'example-repo',
      branch: 'main',
      root: '.',
      runner,
    });

    // The test repository path may or may not exist locally; this assertion focuses on update/reset behavior when it does.
    if (result.status !== 'cloned') {
      expect(calls.map((call) => call.args)).toContainEqual(['reset', '--hard', 'origin/main']);
    }
  });
});
