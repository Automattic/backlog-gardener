import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseGitHubAppConfig } from '../../src/gardener/app/config.js';
import {
  redactSensitiveOutput,
  manualInvestigationCommandAllowed,
  parseManualInvestigationCommand,
  renderManualInvestigationComment,
  renderManualInvestigationHelp,
  renderRecipeList,
  renderUnknownRecipeComment,
  runManualInvestigation,
  synthesizeManualInvestigation,
} from '../../src/gardener/app/manual-investigation.js';
import type { CompletionProvider } from '../../src/gardener/llm/provider.js';

const tempDirs: string[] = [];

class FakeProvider implements CompletionProvider {
  readonly name = 'fake';
  readonly model = 'fake';
  readonly thinkingEffort = undefined;

  async complete<T>(): Promise<{ output: T; model: string; usage: { inputTokens: number; outputTokens: number } }> {
    return {
      output: {
        outcome: 'passed',
        evidence: ['The validation command exited successfully.'],
        nextStep: 'Use this as supporting evidence for triage.',
        confidence: 'high',
      } as T,
      model: this.model,
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('manual investigation commands', () => {
  it('redacts sensitive command output patterns', () => {
    expect(redactSensitiveOutput('OPENAI_API_KEY=sk-abc1234567890 GITHUB_TOKEN=ghp_abc1234567890abc')).toContain(
      'OPENAI_API_KEY=[REDACTED]',
    );
    expect(redactSensitiveOutput('-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----')).toBe(
      '[REDACTED_PRIVATE_KEY]',
    );
  });

  it('parses supported commands', () => {
    expect(parseManualInvestigationCommand('@gardener help')).toEqual({ type: 'help' });
    expect(parseManualInvestigationCommand('@gardener explain')).toEqual({ type: 'explain' });
    expect(parseManualInvestigationCommand('@gardener list recipes')).toEqual({ type: 'list_recipes' });
    expect(parseManualInvestigationCommand('@gardener rerun')).toEqual({ type: 'rerun' });
    expect(parseManualInvestigationCommand('@gardener investigate')).toEqual({
      type: 'run_recipe',
      recipeName: 'default',
    });
    expect(parseManualInvestigationCommand('@gardener reproduce')).toEqual({
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
    expect(renderManualInvestigationHelp(config)).toContain('@gardener list recipes');
    expect(renderManualInvestigationHelp(config)).toContain('@gardener rerun');
    expect(renderRecipeList(config)).toContain('`docs-check` — Check docs.');
    expect(renderUnknownRecipeComment(config, 'missing')).toContain('Unknown recipe: `missing`');
    expect(renderUnknownRecipeComment(config, 'missing')).toContain('`docs-check`');
  });

  it('summarizes failed and timed out command outcomes', () => {
    const body = renderManualInvestigationComment({
      recipeName: 'mixed',
      description: '',
      commands: [
        { command: 'echo ok', exitCode: 0, timedOut: false, stdout: 'ok', stderr: '' },
        { command: 'false', exitCode: 1, timedOut: false, stdout: '', stderr: 'nope' },
        { command: 'sleep 10', exitCode: null, timedOut: true, stdout: '', stderr: 'timeout' },
      ],
    });

    expect(body).toContain('Outcome: **mixed**');
    expect(body).toContain('Commands: 1 passed, 1 failed, 1 timed out');
  });

  it('synthesizes command output into a concise conclusion', async () => {
    const synthesis = await synthesizeManualInvestigation({
      provider: new FakeProvider(),
      repo: 'o/r',
      subject: 'issue #12',
      result: {
        repo: 'o/r',
        subjectType: 'issue',
        subjectNumber: 12,
        recipeName: 'docs-check',
        description: 'Check docs',
        commands: [{ command: 'echo ok', exitCode: 0, timedOut: false, stdout: 'ok', stderr: '' }],
      },
    });

    expect(synthesis).toEqual(
      expect.objectContaining({
        outcome: 'passed',
        confidence: 'high',
        evidence: ['The validation command exited successfully.'],
      }),
    );
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
  allowedCommandPrefixes:
    - node
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
      synthesis: {
        outcome: 'passed',
        evidence: ['The validation command exited successfully.'],
        nextStep: 'Use this as supporting evidence for triage.',
        confidence: 'high',
      },
      artifactId: 'app_inv_123',
    });
    expect(result.commands[0]).toEqual(expect.objectContaining({ exitCode: 0, stdout: expect.stringContaining('42') }));
    expect(body).toContain('Backlog Gardener manual investigation');
    expect(body).toContain('Artifact: `app_inv_123`');
    expect(body).toContain('Outcome: **passed**');
    expect(body).toContain('Commands: 1 passed, 0 failed, 0 timed out');
    expect(body).toContain('Conclusion: **passed** (high confidence)');
    expect(body).toContain('The validation command exited successfully.');
    expect(body).toContain('node -e');
  });

  it('rejects commands outside configured allowed prefixes', async () => {
    await expect(
      runManualInvestigation({
        payload: {
          action: 'created',
          issue: { number: 12 },
          comment: { body: '@gardener run recipe docs-check', author_association: 'OWNER' },
        },
        config: parseGitHubAppConfig(`
investigation:
  allowedCommandPrefixes:
    - pnpm
  recipes:
    docs-check:
      commands:
        - node -e "console.log(42)"
`),
        repo: { installationId: 1, owner: 'o', repo: 'r', fullName: 'o/r' },
        checkoutPath: process.cwd(),
        command: { type: 'run_recipe', recipeName: 'docs-check' },
      }),
    ).rejects.toThrow(/allowedCommandPrefixes/);
  });
});
