import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseGitHubAppConfig } from '../../src/gardener/app/config.js';
import {
  manualInvestigationCommandAllowed,
  parseManualInvestigationCommand,
  renderManualInvestigationComment,
  renderManualInvestigationHelp,
  renderUnknownRecipeComment,
  runManualInvestigation,
} from '../../src/gardener/app/manual-investigation.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('manual investigation commands', () => {
  it('parses supported commands', () => {
    expect(parseManualInvestigationCommand('@gardener help')).toEqual({ type: 'help' });
    expect(parseManualInvestigationCommand('@gardener investigate')).toEqual({
      type: 'run_recipe',
      recipeName: 'default',
    });
    expect(parseManualInvestigationCommand('@gardener run recipe docs-check')).toEqual({
      type: 'run_recipe',
      recipeName: 'docs-check',
    });
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

  it('renders help and unknown recipe comments', () => {
    const config = parseGitHubAppConfig(`
investigation:
  defaultRecipe: docs-check
  recipes:
    docs-check:
      description: Check docs.
      commands:
        - echo ok
`);

    expect(renderManualInvestigationHelp(config)).toContain('@gardener run recipe <name>');
    expect(renderManualInvestigationHelp(config)).toContain('`docs-check` — Check docs.');
    expect(renderUnknownRecipeComment(config, 'missing')).toContain('Unknown recipe: `missing`');
    expect(renderUnknownRecipeComment(config, 'missing')).toContain('`docs-check`');
  });

  it('runs a configured recipe and renders the result with an artifact id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gardener-manual-'));
    tempDirs.push(dir);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { check: 'node -e "console.log(42)"' } }));

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
      checkoutPath: dir,
      command: { type: 'run_recipe', recipeName: 'docs-check' },
    });

    const body = renderManualInvestigationComment({
      recipeName: result.recipeName,
      description: result.description,
      commands: result.commands,
      artifactId: 'app_inv_123',
    });
    expect(result.commands[0]).toEqual(expect.objectContaining({ exitCode: 0, stdout: expect.stringContaining('42') }));
    expect(body).toContain('Backlog Gardener manual investigation');
    expect(body).toContain('Artifact: `app_inv_123`');
    expect(body).toContain('node -e');
  });
});
