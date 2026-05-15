import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildGitHubAppManifest,
  buildGitHubOrgAppManifestUrl,
  envUpdatesFromManifestConversion,
  runGitHubAppDoctor,
  writeEnvUpdates,
} from '../../src/gardener/app/setup.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('GitHub App setup helpers', () => {
  it('builds a GitHub App manifest creation URL', () => {
    const result = buildGitHubAppManifest({
      name: 'Gardener Test',
      url: 'https://github.com/Automattic/backlog-gardener',
      webhookUrl: 'https://example.test/webhooks/github',
    });

    expect(result.manifest.default_events).toEqual(['issues', 'issue_comment', 'pull_request']);
    expect(result.manifest.default_permissions.issues).toBe('write');
    expect(result.manifest.public).toBe(false);
    expect(decodeURIComponent(result.url)).toContain('Gardener Test');
    expect(buildGitHubOrgAppManifestUrl('Example Org', result.manifest)).toContain(
      'https://github.com/organizations/Example%20Org/settings/apps/new?manifest=',
    );
  });

  it('writes manifest conversion credentials to an env file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gardener-env-'));
    tempDirs.push(dir);
    const envPath = join(dir, '.env');
    await writeEnvUpdates(envPath, [
      { key: 'EXISTING', value: 'keep' },
      ...envUpdatesFromManifestConversion({
        id: 123,
        slug: 'gardener-test',
        pem: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
        webhook_secret: 'secret-value',
      }),
    ]);

    const env = await readFile(envPath, 'utf8');
    expect(env).toContain('EXISTING=keep');
    expect(env).toContain('GARDENER_APP_ID=123');
    expect(env).toContain(
      String.raw`GARDENER_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"`,
    );
    expect(env).toContain('GARDENER_APP_WEBHOOK_SECRET=secret-value');
  });

  it('reports missing credentials in doctor output', async () => {
    const result = await runGitHubAppDoctor({ appId: '', privateKey: '', webhookSecret: '' });

    expect(result.ok).toBe(false);
    expect(result.checks.map((check) => check.name)).toContain('GARDENER_APP_ID');
  });
});
