import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseGitHubAppConfig } from '../../src/gardener/app/config.js';
import {
  manualInvestigationCommandAllowed,
  parseManualInvestigationCommand,
  runManualInvestigation,
} from '../../src/gardener/app/manual-investigation.js';
import type { GitHubAppClient, GitHubCommentSummary } from '../../src/gardener/app/publisher.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('manual investigation commands', () => {
  it('parses supported commands', () => {
    expect(parseManualInvestigationCommand('@gardener investigate')?.recipeName).toBe('default');
    expect(parseManualInvestigationCommand('@gardener run recipe docs-check')?.recipeName).toBe('docs-check');
    expect(parseManualInvestigationCommand('hello')).toBeNull();
  });

  it('allows only trusted non-bot comment authors', () => {
    expect(
      manualInvestigationCommandAllowed({
        action: 'created',
        comment: { user: { type: 'User' }, author_association: 'OWNER' },
      }),
    ).toBe(true);
    expect(
      manualInvestigationCommandAllowed({
        action: 'created',
        comment: { user: { type: 'User' }, author_association: 'NONE' },
      }),
    ).toBe(false);
    expect(
      manualInvestigationCommandAllowed({
        action: 'created',
        comment: { user: { type: 'Bot' }, author_association: 'OWNER' },
      }),
    ).toBe(false);
  });

  it('runs a configured recipe and posts the result', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gardener-manual-'));
    tempDirs.push(dir);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { check: 'node -e "console.log(42)"' } }));
    const comments: GitHubCommentSummary[] = [];
    const client: GitHubAppClient = {
      async listIssues() {
        return [];
      },
      async createIssue() {
        throw new Error('not used');
      },
      async listIssueComments() {
        return [];
      },
      async createIssueComment(args) {
        const comment = { id: 1, body: args.body };
        comments.push(comment);
        return comment;
      },
      async updateIssueComment() {
        throw new Error('not used');
      },
    };

    const result = await runManualInvestigation({
      payload: {
        action: 'created',
        issue: { number: 12 },
        comment: { body: '@gardener run recipe docs-check', author_association: 'OWNER' },
      },
      config: parseGitHubAppConfig(`
investigation:
  recipes:
    docs-check:
      commands:
        - node -e "console.log(42)"
`),
      repo: { installationId: 1, owner: 'o', repo: 'r', fullName: 'o/r' },
      client,
      checkoutPath: dir,
      command: { recipeName: 'docs-check' },
    });

    expect(result.commands[0]).toEqual(expect.objectContaining({ exitCode: 0, stdout: expect.stringContaining('42') }));
    expect(comments[0]?.body).toContain('Backlog Gardener manual investigation');
    expect(comments[0]?.body).toContain('node -e');
  });
});
