import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { loadPromptSchema } from '../llm/prompts.js';
import type { CompletionProvider } from '../llm/provider.js';
import type { GitHubAppConfig } from './config.js';
import type { AppInvestigationArtifactRecord, RepoRef } from './types.js';

const execAsync = promisify(exec);
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export type ManualInvestigationCommand =
  | { type: 'help' }
  | { type: 'explain' }
  | { type: 'list_recipes' }
  | { type: 'rerun' }
  | { type: 'run_recipe'; recipeName: string };

export interface ManualInvestigationCommandPayload {
  action?: string;
  installation?: { id?: number };
  repository?: { name?: string; full_name?: string; owner?: { login?: string } };
  issue?: { number?: number; pull_request?: unknown };
  comment?: {
    body?: string;
    user?: { login?: string; type?: string } | null;
    author_association?: string;
  };
}

export interface ManualInvestigationResult {
  repo: string;
  subjectType: AppInvestigationArtifactRecord['subjectType'];
  subjectNumber: number;
  recipeName: string;
  description: string;
  commands: ManualCommandResult[];
}

export interface ManualCommandResult {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export interface ManualInvestigationSynthesis {
  outcome: 'reproduced' | 'not_reproduced' | 'inconclusive' | 'passed' | 'failed';
  evidence: string[];
  nextStep: string;
  confidence: 'low' | 'medium' | 'high';
}

export function parseManualInvestigationCommand(body: string): ManualInvestigationCommand | null {
  const helpMatch = body.match(/^\s*@gardener\s+help\b/im);
  if (helpMatch) return { type: 'help' };
  const explainMatch = body.match(/^\s*@gardener\s+explain\b/im);
  if (explainMatch) return { type: 'explain' };
  const listMatch = body.match(/^\s*@gardener\s+list\s+recipes\b/im);
  if (listMatch) return { type: 'list_recipes' };
  const rerunMatch = body.match(/^\s*@gardener\s+rerun\b/im);
  if (rerunMatch) return { type: 'rerun' };
  const runMatch = body.match(/^\s*@gardener\s+(?:(investigate)|reproduce|run\s+recipe\s+([A-Za-z0-9_.-]+))\b/im);
  if (!runMatch) return null;
  return { type: 'run_recipe', recipeName: runMatch[2] ?? 'default' };
}

export function manualInvestigationCommandAllowed(payload: ManualInvestigationCommandPayload): boolean {
  if (payload.action !== 'created') return false;
  if (payload.comment?.user?.type === 'Bot') return false;
  const association = payload.comment?.author_association;
  return typeof association === 'string' && TRUSTED_ASSOCIATIONS.has(association);
}

export async function runManualInvestigation(args: {
  payload: ManualInvestigationCommandPayload;
  config: GitHubAppConfig;
  repo: RepoRef;
  checkoutPath: string;
  command: Extract<ManualInvestigationCommand, { type: 'run_recipe' }>;
}): Promise<ManualInvestigationResult> {
  const issueNumber = args.payload.issue?.number;
  if (!issueNumber) throw new Error('manual investigation command is missing issue context');
  const requestedRecipe =
    args.command.recipeName === 'default' ? args.config.investigation.defaultRecipe : args.command.recipeName;
  const recipe = args.config.investigation.recipes[requestedRecipe];
  if (!recipe) throw new Error(`investigation recipe is not configured: ${requestedRecipe}`);
  const commands: ManualCommandResult[] = [];
  const allowedPrefixes = args.config.investigation.allowedCommandPrefixes;
  for (const command of recipe.commands) {
    if (!commandAllowedByPrefix(command, allowedPrefixes)) {
      throw new Error(
        `investigation recipe command is not allowed by investigation.allowedCommandPrefixes: ${command}`,
      );
    }
    commands.push(
      await runCommand({
        command,
        cwd: args.checkoutPath,
        timeoutSeconds: recipe.timeoutSeconds,
        maxOutputChars: recipe.maxOutputChars,
      }),
    );
  }
  const result: ManualInvestigationResult = {
    repo: args.repo.fullName,
    subjectType: args.payload.issue?.pull_request ? 'pull_request' : 'issue',
    subjectNumber: issueNumber,
    recipeName: requestedRecipe,
    description: recipe.description,
    commands,
  };
  return result;
}

async function runCommand(args: {
  command: string;
  cwd: string;
  timeoutSeconds: number;
  maxOutputChars: number;
}): Promise<ManualCommandResult> {
  try {
    const { stdout, stderr } = await execAsync(args.command, {
      cwd: args.cwd,
      timeout: args.timeoutSeconds * 1000,
      maxBuffer: Math.max(args.maxOutputChars * 2, 1024 * 1024),
      env: safeCommandEnv(process.env),
    });
    return {
      command: args.command,
      exitCode: 0,
      timedOut: false,
      stdout: truncate(redactSensitiveOutput(stdout), args.maxOutputChars),
      stderr: truncate(redactSensitiveOutput(stderr), args.maxOutputChars),
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
    };
    return {
      command: args.command,
      exitCode: typeof err.code === 'number' ? err.code : null,
      timedOut: Boolean(err.killed),
      stdout: truncate(redactSensitiveOutput(err.stdout ?? ''), args.maxOutputChars),
      stderr: truncate(redactSensitiveOutput(err.stderr ?? err.message), args.maxOutputChars),
    };
  }
}

export async function synthesizeManualInvestigation(args: {
  provider: CompletionProvider;
  repo: string;
  subject: string;
  result: ManualInvestigationResult;
}): Promise<ManualInvestigationSynthesis> {
  const schema = await loadPromptSchema('app-manual-investigation');
  const response = await args.provider.complete<ManualInvestigationSynthesis>({
    promptId: 'app-manual-investigation',
    promptVersion: 'v1',
    inputs: {
      repo: args.repo,
      subject: args.subject,
      recipeName: args.result.recipeName,
      description: args.result.description,
      commands: renderCommandResultsForPrompt(args.result.commands),
    },
    schema,
    maxTokens: 800,
    timeoutMs: 60_000,
  });
  return response.output;
}

export function fallbackManualInvestigationSynthesis(result: ManualInvestigationResult): ManualInvestigationSynthesis {
  const outcome = summarizeManualInvestigationOutcome(result.commands);
  return {
    outcome: outcome.failed > 0 || outcome.timedOut > 0 ? 'failed' : 'passed',
    evidence: [
      `${outcome.passed} command(s) passed, ${outcome.failed} failed, ${outcome.timedOut} timed out.`,
      ...result.commands.slice(0, 3).map((command) => `${command.command}: exit ${command.exitCode ?? 'unknown'}`),
    ],
    nextStep:
      outcome.failed > 0 || outcome.timedOut > 0
        ? 'Inspect the failing command output and update the issue or recipe with the next debugging step.'
        : 'Use the passing command output as supporting evidence for the next triage step.',
    confidence: 'medium',
  };
}

export function renderManualInvestigationHelp(config: GitHubAppConfig): string {
  const lines = [
    '🌱 **Backlog Gardener help**',
    '',
    'Trusted maintainers can trigger manual investigations with:',
    '',
    '- `@gardener investigate` — run the default recipe',
    '- `@gardener reproduce` — alias for the default recipe',
    '- `@gardener run recipe <name>` — run a named recipe',
    '- `@gardener list recipes` — list configured recipes',
    '- `@gardener explain` — summarize the latest persisted investigation for this thread',
    '- `@gardener rerun` — rerun the latest recipe used on this thread',
    '- `@gardener help` — show this help',
    '',
    renderRecipeList(config),
  ];
  return lines.join('\n');
}

export function renderRecipeList(config: GitHubAppConfig): string {
  const recipes = Object.entries(config.investigation.recipes);
  const lines = [`Default recipe: \`${config.investigation.defaultRecipe}\``, '', '## Available recipes'];
  if (recipes.length === 0) {
    lines.push('', 'No investigation recipes are configured in `.github/gardener.yml`.');
  } else {
    for (const [name, recipe] of recipes) {
      lines.push('', `- \`${name}\`${recipe.description ? ` — ${recipe.description}` : ''}`);
    }
  }
  return lines.join('\n');
}

export function renderUnknownRecipeComment(config: GitHubAppConfig, recipeName: string): string {
  const recipes = Object.keys(config.investigation.recipes).sort();
  return [
    '🌱 **Backlog Gardener manual investigation**',
    '',
    `Unknown recipe: \`${recipeName}\`.`,
    '',
    recipes.length > 0
      ? `Available recipes: ${recipes.map((recipe) => `\`${recipe}\``).join(', ')}`
      : 'No recipes are configured.',
    '',
    'Run `@gardener help` for usage.',
  ].join('\n');
}

export function renderManualInvestigationComment(args: {
  recipeName: string;
  description: string;
  commands: ManualCommandResult[];
  synthesis?: ManualInvestigationSynthesis;
  artifactId?: string;
}): string {
  const outcome = summarizeManualInvestigationOutcome(args.commands);
  const lines = [
    '🌱 **Backlog Gardener manual investigation**',
    '',
    '_Automated run triggered by a trusted maintainer command._',
    '',
    `Recipe: \`${args.recipeName}\`${args.description ? ` — ${args.description}` : ''}`,
    args.artifactId ? `Artifact: \`${args.artifactId}\`` : null,
    `Outcome: **${outcome.label}**`,
    `Commands: ${outcome.passed} passed, ${outcome.failed} failed, ${outcome.timedOut} timed out`,
    args.synthesis ? '' : null,
    args.synthesis ? '## Synthesized conclusion' : null,
    args.synthesis ? `Conclusion: **${args.synthesis.outcome}** (${args.synthesis.confidence} confidence)` : null,
    args.synthesis ? `Next step: ${args.synthesis.nextStep}` : null,
    args.synthesis ? '' : null,
    ...(args.synthesis ? ['Evidence:', ...args.synthesis.evidence.map((item) => `- ${item}`)] : []),
    '',
    '## Command results',
  ];
  for (const result of args.commands) {
    const status =
      result.exitCode === 0 ? 'passed' : result.timedOut ? 'timed out' : `failed (${result.exitCode ?? 'unknown'})`;
    lines.push('', `### \`${result.command}\` — ${status}`);
    if (result.stdout.trim()) lines.push('', '**stdout**', '```text', result.stdout.trim(), '```');
    if (result.stderr.trim()) lines.push('', '**stderr**', '```text', result.stderr.trim(), '```');
  }
  lines.push('', '<!-- backlog-gardener:summary:v1 -->');
  return lines.filter((line): line is string => line !== null).join('\n');
}

function commandAllowedByPrefix(command: string, allowedPrefixes: string[]): boolean {
  if (allowedPrefixes.length === 0) return true;
  const normalized = command.trim();
  return allowedPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix} `));
}

export function redactSensitiveOutput(output: string): string {
  return output
    .replace(
      /(OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|GARDENER_APP_PRIVATE_KEY|GARDENER_APP_WEBHOOK_SECRET)=\S+/gi,
      '$1=[REDACTED]',
    )
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, '[REDACTED_OPENAI_KEY]')
    .replace(/(gh[pousr]_[A-Za-z0-9_]{12,})/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');
}

function renderCommandResultsForPrompt(commands: ManualCommandResult[]): string {
  return commands
    .map((command) =>
      [
        `Command: ${command.command}`,
        `Exit code: ${command.exitCode ?? 'unknown'}`,
        `Timed out: ${command.timedOut ? 'yes' : 'no'}`,
        command.stdout.trim() ? `stdout:\n${command.stdout.trim()}` : 'stdout: <empty>',
        command.stderr.trim() ? `stderr:\n${command.stderr.trim()}` : 'stderr: <empty>',
      ].join('\n'),
    )
    .join('\n\n---\n\n');
}

function summarizeManualInvestigationOutcome(commands: ManualCommandResult[]): {
  label: 'passed' | 'failed' | 'timed out' | 'mixed';
  passed: number;
  failed: number;
  timedOut: number;
} {
  const timedOut = commands.filter((command) => command.timedOut).length;
  const passed = commands.filter((command) => command.exitCode === 0 && !command.timedOut).length;
  const failed = commands.length - passed - timedOut;
  const label =
    timedOut > 0 && passed + failed === 0
      ? 'timed out'
      : failed > 0 || timedOut > 0
        ? passed > 0
          ? 'mixed'
          : 'failed'
        : 'passed';
  return { label, passed, failed, timedOut };
}

function safeCommandEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allow = ['HOME', 'PATH', 'SHELL', 'TMPDIR', 'USER', 'CI', 'NODE_ENV'];
  return Object.fromEntries(allow.flatMap((key) => (env[key] ? [[key, env[key]]] : [])));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n… truncated …`;
}
