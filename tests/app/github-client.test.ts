import { describe, expect, it } from 'vitest';

import { fetchRepoGitHubAppConfig, GitHubRestAppClient } from '../../src/gardener/app/github-client.js';
import type { RepoRef } from '../../src/gardener/app/types.js';

const repo: RepoRef = {
  installationId: 1,
  owner: 'example-org',
  repo: 'example-product',
  fullName: 'example-org/example-product',
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

describe('GitHubRestAppClient', () => {
  it('loads repo app config from GitHub contents API', async () => {
    const yaml = Buffer.from('enabled: true\nproduct:\n  slug: example-product\n  name: Example Product\n').toString(
      'base64',
    );
    const calls: string[] = [];
    const client = new GitHubRestAppClient({
      token: 'token',
      fetchImpl: async (url) => {
        calls.push(String(url));
        return jsonResponse({ type: 'file', encoding: 'base64', content: yaml });
      },
    });

    const config = await fetchRepoGitHubAppConfig({ client, repo });

    expect(config.enabled).toBe(true);
    expect(config.product.slug).toBe('example-product');
    expect(calls[0]).toContain('/repos/example-org/example-product/contents/.github/gardener.yml');
  });

  it('falls back to legacy config path', async () => {
    const yaml = Buffer.from('enabled: true\nproduct:\n  slug: legacy\n  name: Legacy\n').toString('base64');
    const calls: string[] = [];
    const client = new GitHubRestAppClient({
      token: 'token',
      fetchImpl: async (url) => {
        calls.push(String(url));
        if (String(url).includes('.github/gardener.yml')) return jsonResponse({ message: 'Not Found' }, 404);
        return jsonResponse({ type: 'file', encoding: 'base64', content: yaml });
      },
    });

    const config = await fetchRepoGitHubAppConfig({ client, repo });

    expect(config.enabled).toBe(true);
    expect(config.product.slug).toBe('legacy');
    expect(calls[1]).toContain('/repos/example-org/example-product/contents/.github/backlog-gardener.yml');
  });

  it('defaults missing config to disabled mode', async () => {
    const client = new GitHubRestAppClient({
      token: 'token',
      fetchImpl: async () => jsonResponse({ message: 'Not Found' }, 404),
    });

    const config = await fetchRepoGitHubAppConfig({ client, repo });

    expect(config.enabled).toBe(false);
    expect(config.actions.issueComments).toBe(false);
  });

  it('creates repository dispatch events through the REST API', async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const client = new GitHubRestAppClient({
      token: 'token',
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? 'GET', body: String(init?.body ?? '') });
        return new Response(null, { status: 204 });
      },
    });

    await client.createRepositoryDispatch({
      owner: repo.owner,
      repo: repo.repo,
      eventType: 'backlog-gardener.pr-review',
      clientPayload: { pr_number: 123 },
    });

    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toContain('/dispatches');
    expect(requests[0]?.body).toContain('backlog-gardener.pr-review');
  });

  it('creates and updates issue comments through the REST API', async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const client = new GitHubRestAppClient({
      token: 'token',
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? 'GET', body: String(init?.body ?? '') });
        return jsonResponse({ id: 123, body: 'updated' });
      },
    });

    await client.createIssueComment({ owner: repo.owner, repo: repo.repo, issueNumber: 10, body: 'hello' });
    await client.updateIssueComment({ owner: repo.owner, repo: repo.repo, commentId: 123, body: 'updated' });

    expect(requests[0]).toMatchObject({ method: 'POST' });
    expect(requests[0]?.url).toContain('/issues/10/comments');
    expect(requests[1]).toMatchObject({ method: 'PATCH' });
    expect(requests[1]?.url).toContain('/issues/comments/123');
  });
});
