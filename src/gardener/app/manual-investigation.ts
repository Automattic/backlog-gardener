import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import type { GitHubAppConfig } from './config.js';
import type { GitHubAppClient } from './publisher.js';
import type { AppInvestigationArtifactRecord, RepoRef } from './types.js';

const execAsync = promisify(exec);
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export interface ManualInvestigationCommand {
  recipeName: string;
}

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
  body: string;
}

export interface ManualCommandResult {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export function parseManualInvestigationCommand(body: string): ManualInvestigationCommand | null {
  const match = body.match(/^\s*@gardener\s+(?:(investigate)|run\s+recipe\s+([A-Za-z0-9_.-]+))\b/im);
  if (!match) return null;
  return { recipeName: match[2] ?? 'default' };
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
  client: GitHubAppClient;
  checkoutPath: string;
  command: ManualInvestigationCommand;
}): Promise<ManualInvestigationResult> {
  const issueNumber = args.payload.issue?.number;
  if (!issueNumber) throw new Error('manual investigation command is missing issue context');
  const requestedRecipe =
    args.command.recipeName === 'default' ? args.config.investigation.defaultRecipe : args.command.recipeName;
  const recipe = args.config.investigation.recipes[requestedRecipe];
  if (!recipe) throw new Error(`investigation recipe is not configured: ${requestedRecipe}`);
  const commands: ManualCommandResult[] = [];
  for (const command of recipe.commands) {
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
    body: renderManualInvestigationComment({ recipeName: requestedRecipe, description: recipe.description, commands }),
  };
  await args.client.createIssueComment({
    owner: args.repo.owner,
    repo: args.repo.repo,
    issueNumber,
    body: result.body,
  });
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
      stdout: truncate(stdout, args.maxOutputChars),
      stderr: truncate(stderr, args.maxOutputChars),
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
      stdout: truncate(err.stdout ?? '', args.maxOutputChars),
      stderr: truncate(err.stderr ?? err.message, args.maxOutputChars),
    };
  }
}

function renderManualInvestigationComment(args: {
  recipeName: string;
  description: string;
  commands: ManualCommandResult[];
}): string {
  const lines = [
    '🌱 **Backlog Gardener manual investigation**',
    '',
    '_Automated run triggered by a trusted maintainer command._',
    '',
    `Recipe: \`${args.recipeName}\`${args.description ? ` — ${args.description}` : ''}`,
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
  return lines.join('\n');
}

function safeCommandEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allow = ['HOME', 'PATH', 'SHELL', 'TMPDIR', 'USER', 'CI', 'NODE_ENV'];
  return Object.fromEntries(allow.flatMap((key) => (env[key] ? [[key, env[key]]] : [])));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n… truncated …`;
}
