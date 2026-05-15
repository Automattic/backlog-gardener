import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

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
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}): Promise<DoctorResult> {
  const checks: DoctorResult['checks'] = [];
  const appId = args.appId ?? process.env.GARDENER_APP_ID;
  const privateKey = args.privateKey ?? process.env.GARDENER_APP_PRIVATE_KEY;
  const webhookSecret = args.webhookSecret ?? process.env.GARDENER_APP_WEBHOOK_SECRET;
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
  if (appId && privateKey) {
    try {
      const jwt = createGitHubAppJwt({ appId, privateKey: normalizePrivateKey(privateKey) });
      const fetchImpl = args.fetchImpl ?? fetch;
      const response = await fetchImpl(`${args.apiBaseUrl ?? 'https://api.github.com'}/app`, {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      checks.push({
        name: 'GitHub App API authentication',
        ok: response.ok,
        message: response.ok ? 'authenticated' : `failed with HTTP ${response.status}`,
      });
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

export function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n');
}

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return JSON.stringify(value.replace(/\r?\n/g, '\\n'));
}
