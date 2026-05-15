import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { createGitHubAppJwt } from './github-app.js';

export interface GitHubAppManifestOptions {
  name: string;
  url: string;
  webhookUrl: string;
  description?: string;
  setupUrl?: string;
  redirectUrl?: string;
  public?: boolean;
}

export interface GitHubAppManifestResult {
  manifest: GitHubAppManifest;
  url: string;
}

export interface GitHubAppManifest {
  name: string;
  url: string;
  description: string;
  hook_attributes: {
    url: string;
    active: boolean;
  };
  default_events: string[];
  default_permissions: Record<string, string>;
  public: boolean;
  setup_url?: string;
  redirect_url?: string;
}

export interface ManifestConversionResponse {
  id: number;
  slug?: string;
  name?: string;
  html_url?: string;
  pem: string;
  webhook_secret?: string;
}

export interface EnvUpdate {
  key: string;
  value: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; message: string }>;
}

const DEFAULT_DESCRIPTION = 'Local-first agent for surfacing actionable backlog and review signals.';
const DEFAULT_EVENTS = ['issues', 'issue_comment', 'pull_request'];
const DEFAULT_PERMISSIONS = {
  contents: 'read',
  issues: 'write',
  metadata: 'read',
  pull_requests: 'write',
} as const;

export function buildGitHubAppManifest(args: GitHubAppManifestOptions): GitHubAppManifestResult {
  const manifest: GitHubAppManifest = {
    name: args.name,
    url: args.url,
    description: args.description ?? DEFAULT_DESCRIPTION,
    hook_attributes: {
      url: args.webhookUrl,
      active: true,
    },
    default_events: [...DEFAULT_EVENTS],
    default_permissions: { ...DEFAULT_PERMISSIONS },
    public: args.public ?? false,
    ...(args.setupUrl ? { setup_url: args.setupUrl } : {}),
    ...(args.redirectUrl ? { redirect_url: args.redirectUrl } : {}),
  };
  return {
    manifest,
    url: `https://github.com/settings/apps/new?manifest=${encodeURIComponent(JSON.stringify(manifest))}`,
  };
}

export function buildGitHubOrgAppManifestUrl(org: string, manifest: GitHubAppManifest): string {
  return `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new?manifest=${encodeURIComponent(
    JSON.stringify(manifest),
  )}`;
}

export async function convertGitHubAppManifestCode(args: {
  code: string;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}): Promise<ManifestConversionResponse> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const baseUrl = args.apiBaseUrl ?? 'https://api.github.com';
  const response = await fetchImpl(`${baseUrl}/app-manifests/${encodeURIComponent(args.code)}/conversions`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub App manifest conversion failed: ${response.status}`);
  return (await response.json()) as ManifestConversionResponse;
}

export function envUpdatesFromManifestConversion(conversion: ManifestConversionResponse): EnvUpdate[] {
  return [
    { key: 'GARDENER_APP_ID', value: String(conversion.id) },
    { key: 'GARDENER_APP_PRIVATE_KEY', value: conversion.pem },
    { key: 'GARDENER_APP_WEBHOOK_SECRET', value: conversion.webhook_secret ?? randomBytes(32).toString('hex') },
  ];
}

export async function writeEnvUpdates(path: string, updates: EnvUpdate[]): Promise<void> {
  let current = '';
  try {
    current = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const lines = current ? current.replace(/\n?$/, '\n').split('\n') : [];
  const updateMap = new Map(updates.map((update) => [update.key, update.value]));
  const seen = new Set<string>();
  const next = lines.map((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (!match) return line;
    const key = match[1]!;
    if (!updateMap.has(key)) return line;
    seen.add(key);
    return `${key}=${formatEnvValue(updateMap.get(key)!)}`;
  });
  for (const update of updates) {
    if (!seen.has(update.key)) next.push(`${update.key}=${formatEnvValue(update.value)}`);
  }
  await writeFile(path, `${next.filter((line, index) => index < next.length - 1 || line !== '').join('\n')}\n`);
}

export async function runGitHubAppDoctor(args: {
  appId?: string;
  privateKey?: string;
  webhookSecret?: string;
  repo?: string;
  statePath?: string;
  codeRoot?: string;
  openAiApiKey?: string;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}): Promise<DoctorResult> {
  const checks: DoctorResult['checks'] = [];
  const appId = args.appId ?? process.env.GARDENER_APP_ID;
  const privateKey = args.privateKey ?? process.env.GARDENER_APP_PRIVATE_KEY;
  const webhookSecret = args.webhookSecret ?? process.env.GARDENER_APP_WEBHOOK_SECRET;
  const statePath = args.statePath ?? process.env.GARDENER_APP_STATE_PATH ?? '.gardener-state/app.db';
  const codeRoot = args.codeRoot ?? process.env.GARDENER_APP_CODE_ROOT ?? '.gardener-worktrees';
  const openAiApiKey = args.openAiApiKey ?? process.env.OPENAI_API_KEY;
  checks.push({ name: 'GARDENER_APP_ID', ok: Boolean(appId), message: appId ? 'present' : 'missing' });
  checks.push({
    name: 'GARDENER_APP_PRIVATE_KEY',
    ok: Boolean(privateKey),
    message: privateKey ? 'present' : 'missing',
  });
  checks.push({
    name: 'GARDENER_APP_WEBHOOK_SECRET',
    ok: Boolean(webhookSecret),
    message: webhookSecret ? 'present' : 'missing',
  });
  checks.push({ name: 'OPENAI_API_KEY', ok: Boolean(openAiApiKey), message: openAiApiKey ? 'present' : 'missing' });
  checks.push(await writablePathCheck('State DB directory writable', dirname(statePath)));
  checks.push(await writablePathCheck('Code checkout root writable', codeRoot));
  if (appId && privateKey) {
    try {
      const jwt = createGitHubAppJwt({ appId, privateKey: normalizePrivateKey(privateKey) });
      const fetchImpl = args.fetchImpl ?? fetch;
      const apiBaseUrl = args.apiBaseUrl ?? 'https://api.github.com';
      const headers = {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      };
      const response = await fetchImpl(`${apiBaseUrl}/app`, {
        headers,
      });
      checks.push({
        name: 'GitHub App API authentication',
        ok: response.ok,
        message: response.ok ? 'authenticated' : `failed with HTTP ${response.status}`,
      });
      if (response.ok && args.repo) {
        checks.push(...(await repoInstallationChecks({ repo: args.repo, fetchImpl, apiBaseUrl, headers })));
      }
    } catch (error) {
      checks.push({
        name: 'GitHub App API authentication',
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { ok: checks.every((check) => check.ok), checks };
}

async function writablePathCheck(name: string, path: string): Promise<DoctorResult['checks'][number]> {
  const probe = join(path, `.gardener-doctor-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    await mkdir(path, { recursive: true });
    await writeFile(probe, 'ok');
    await rm(probe, { force: true });
    return { name, ok: true, message: path };
  } catch (error) {
    return { name, ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function repoInstallationChecks(args: {
  repo: string;
  fetchImpl: typeof fetch;
  apiBaseUrl: string;
  headers: Record<string, string>;
}): Promise<DoctorResult['checks']> {
  const checks: DoctorResult['checks'] = [];
  const [owner, repo] = args.repo.split('/');
  if (!owner || !repo) return [{ name: 'Repository format', ok: false, message: 'expected owner/repo' }];
  const installationsResponse = await args.fetchImpl(`${args.apiBaseUrl}/app/installations`, { headers: args.headers });
  if (!installationsResponse.ok) {
    return [
      {
        name: `Installation access for ${args.repo}`,
        ok: false,
        message: `could not list installations: HTTP ${installationsResponse.status}`,
      },
    ];
  }
  const installations = (await installationsResponse.json()) as Array<{ id?: number; account?: { login?: string } }>;
  for (const installation of installations) {
    if (!installation.id) continue;
    const tokenResponse = await args.fetchImpl(
      `${args.apiBaseUrl}/app/installations/${installation.id}/access_tokens`,
      { method: 'POST', headers: args.headers },
    );
    if (!tokenResponse.ok) continue;
    const token = (await tokenResponse.json()) as { token?: string };
    if (!token.token) continue;
    const repoResponse = await args.fetchImpl(`${args.apiBaseUrl}/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${token.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (repoResponse.ok) {
      checks.push({
        name: `Installation access for ${args.repo}`,
        ok: true,
        message: `installed via installation ${installation.id}`,
      });
      checks.push(...(await repoPermissionChecks({ ...args, owner, repo, token: token.token })));
      return checks;
    }
  }
  checks.push({ name: `Installation access for ${args.repo}`, ok: false, message: 'app is not installed on repo' });
  return checks;
}

async function repoPermissionChecks(args: {
  fetchImpl: typeof fetch;
  apiBaseUrl: string;
  owner: string;
  repo: string;
  token: string;
}): Promise<DoctorResult['checks']> {
  const headers = {
    Authorization: `Bearer ${args.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const configResponse = await args.fetchImpl(
    `${args.apiBaseUrl}/repos/${args.owner}/${args.repo}/contents/.github/gardener.yml`,
    { headers },
  );
  const guidanceResponse = await args.fetchImpl(
    `${args.apiBaseUrl}/repos/${args.owner}/${args.repo}/contents/.gardener.md`,
    {
      headers,
    },
  );
  return [
    {
      name: '.github/gardener.yml access',
      ok: configResponse.ok || configResponse.status === 404,
      message: configResponse.ok
        ? 'readable'
        : configResponse.status === 404
          ? 'not found; defaults disabled'
          : `failed with HTTP ${configResponse.status}`,
    },
    {
      name: '.gardener.md access',
      ok: guidanceResponse.ok || guidanceResponse.status === 404,
      message: guidanceResponse.ok
        ? 'readable'
        : guidanceResponse.status === 404
          ? 'not found; optional'
          : `failed with HTTP ${guidanceResponse.status}`,
    },
  ];
}

export function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n');
}

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return JSON.stringify(value.replace(/\r?\n/g, '\\n'));
}
