import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseTriageProfile } from '../../src/gardener/config/index.js';
import {
  checkoutPathForGitHubSource,
  sourceCodeRoots,
  syncGitHubSource,
  type GitRunner,
} from '../../src/gardener/sources/code.js';

describe('source code checkout helpers', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('maps GitHub sources to gitignored checkout paths', () => {
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
    });
    const source = profile.sources[0];
    if (source?.type !== 'github') throw new Error('expected github source');

    expect(checkoutPathForGitHubSource(source)).toBe('.gardener-worktrees/github.com/example-org/example-product');
    expect(sourceCodeRoots(profile).get('github:example-org/example-product')).toBe(
      '.gardener-worktrees/github.com/example-org/example-product',
    );
  });

  it('resets diverged tool-owned checkouts when fast-forward pull fails', () => {
    dir = mkdtempSync(join(tmpdir(), 'gardener-source-'));
    const path = join(dir, 'github.com', 'example-org', 'example-product');
    mkdirSync(path, { recursive: true });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const runner: GitRunner = {
      run(args, cwd) {
        calls.push({ args, ...(cwd ? { cwd } : {}) });
        if (args[0] === 'pull') throw new Error('Not possible to fast-forward');
      },
    };
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
    });
    const source = profile.sources[0];
    if (source?.type !== 'github') throw new Error('expected github source');

    const result = syncGitHubSource(source, dir, runner);

    expect(result?.status).toBe('reset');
    expect(calls.map((call) => call.args)).toEqual([
      ['fetch', '--depth', '1', 'origin', 'develop'],
      ['checkout', 'develop'],
      ['pull', '--ff-only'],
      ['reset', '--hard', 'origin/develop'],
      ['clean', '-fd'],
    ]);
    expect(calls.every((call) => call.cwd === path)).toBe(true);
  });
});
