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

const TEST_PRIVATE_KEY =
  '-----BEGIN PRIVATE KEY-----\nMIICdwIBADANBgkqhkiG9w0BAQEFAASCAmEwggJdAgEAAoGBANWJSqx2Z4V3KnkG\nXO1g/5a7HZoRojm3vLspXyMuuOzpEl3MoFhqeE5Zb1LXJy63Q5XkNA+wSUdm/6Vh\nETM8OzMeHVIPj8CNAVz6CPIyrTX6JkHQafeTso+hihthNMB9HRHhuR6UYWlXuPgu\nBLJradQ38MplUII/5eBYWT/Nki1tAgMBAAECgYBEviAGCVAmTUilEYFVAgcGFVLg\nSJD7F8VwU09HWkE6M4YwIDH2hMAaKPyHpK/+gA0H8iE4c74DeIsQSIFrBxbfNQcS\n6rwWzXx3aFvqMUdSGSiehTxvuTbbxCJLM+bHzIMxaXwSPSPG+XDkrvS5V46aW7eY\nIAL9yQAtV3R+yDhhwQJBAPrhLHApw5++wfUufG0h3kKOnd8BgngGMXBJOr0XcGd3\nYQvp/TK9zf/wT+ZaTuAbOQ0rORUiVQPK3XlXt9XU+XkCQQDZ5QCXq0ckgJlC/KWE\nGafwu+ys0N6nD1gQnNX8NNsr3Un6/lWddXLApWtMCnw+yqnkyMXbiUe2AK016R1s\ngEqVAkEAi5v+1LQJDr5ixQQHbdupCbS/mbgHWK9pl6jIrS17+bfvI2gk5LXHCyQ5\n8mBTAFdl2jQxYddnI+MieEIeJTqNUQJAdS8xyF/3HOyEgIA7y/W4WkHXIYIbnKEl\n7ZlLhB4xGUAjv3b1OH+nvW+5auXguCxqfn5z2oPUK0/l166NgoLkmQJBALl05Zyh\ngGGrra+A6iT6X90gCTHQYq4CE3qMpI9LIXRSfyL+TVvWbiQvLn6gSPdzmL7S+fyJ\nirfDb3PGSxBBzJU=\n-----END PRIVATE KEY-----';

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

  it('checks repo installation and config access when requested', async () => {
    const responses: Record<string, unknown> = {
      '/app': { ok: true },
      '/app/installations': [{ id: 10, account: { login: 'example-org' } }],
      '/app/installations/10/access_tokens': { token: 'installation-token' },
      '/repos/example-org/example-repo/installation': { id: 10 },
      '/repos/example-org/example-repo/contents/.github/gardener.yml': { type: 'file' },
      '/repos/example-org/example-repo/contents/.gardener.md': { type: 'file' },
    };
    const result = await runGitHubAppDoctor({
      appId: '123',
      privateKey: TEST_PRIVATE_KEY,
      webhookSecret: 'secret',
      repo: 'example-org/example-repo',
      fetchImpl: async (url) => {
        const path = new URL(String(url)).pathname;
        const body = responses[path];
        return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('{}', { status: 404 });
      },
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Installation access for example-org/example-repo', ok: true }),
        expect.objectContaining({ name: '.github/gardener.yml access', ok: true }),
      ]),
    );
  });
});
