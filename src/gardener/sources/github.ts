import type { GitHubSourceConfig } from '../config/index.js';
import type { Item, Reply } from '../domain.js';
import { bodyHash } from '../normalize/hashes.js';
import type { SourceAdapter } from './base.js';
import { fetchJson, type FetchLike } from './http.js';

export interface GitHubIssueFixture {
  number: number;
  html_url: string;
  title: string;
  body?: string | null;
  user?: { login?: string | null } | null;
  created_at: string;
  updated_at: string;
  state: 'open' | 'closed';
  state_reason?: 'completed' | 'not_planned' | 'reopened' | null;
  closed_at?: string | null;
  author_association?: string;
  labels?: Array<string | { name?: string | null }>;
  pull_request?: unknown;
}

export interface GitHubCommentFixture {
  id: number;
  body?: string | null;
  user?: { login?: string | null } | null;
  created_at: string;
  updated_at: string;
  author_association?: string;
}

function labels(input: GitHubIssueFixture['labels']): string[] {
  return (input ?? []).map((label) => (typeof label === 'string' ? label : (label.name ?? ''))).filter(Boolean);
}

function linkedOpenPrUrls(text: string): string[] {
  return [...text.matchAll(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/g)].map((match) => match[0]);
}

function authHeaders(authEnv: string | undefined): Record<string, string> {
  const token = authEnv ? process.env[authEnv] : undefined;
  return token
    ? { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    : { Accept: 'application/vnd.github+json' };
}

export function normalizeGitHubIssue(args: {
  sourceKey: string;
  repo: string;
  raw: GitHubIssueFixture;
  referenceOnly?: boolean;
}): Omit<Item, 'id'> | null {
  if (args.raw.pull_request) return null;
  const body = args.raw.body ?? '';
  return {
    sourceKey: args.sourceKey,
    sourceType: 'github',
    sourceId: `${args.repo}#${args.raw.number}`,
    url: args.raw.html_url,
    title: args.raw.title,
    body,
    author: args.raw.user?.login ?? null,
    createdAt: args.raw.created_at,
    updatedAt: args.raw.updated_at,
    bodyHash: bodyHash(body),
    latestSnapshotHash: null,
    referenceOnly: args.referenceOnly ?? args.raw.state === 'closed',
    metadata: {
      labels: labels(args.raw.labels),
      state: args.raw.state,
      stateReason: args.raw.state_reason ?? null,
      closedAt: args.raw.closed_at ?? null,
      authorAssociation: args.raw.author_association ?? 'NONE',
      linkedOpenPrUrls: linkedOpenPrUrls(body),
      issueNumber: args.raw.number,
    },
    raw: args.raw,
  };
}

export function normalizeGitHubComment(raw: GitHubCommentFixture): Omit<Reply, 'id' | 'itemId'> {
  const body = raw.body ?? '';
  return {
    sourceReplyId: String(raw.id),
    author: raw.user?.login ?? null,
    body,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    bodyHash: bodyHash(body),
    metadata: {
      authorAssociation: raw.author_association ?? 'NONE',
      linkedOpenPrUrls: linkedOpenPrUrls(body),
    },
    raw,
  };
}

export class GitHubSourceAdapter implements SourceAdapter {
  readonly sourceKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly config: GitHubSourceConfig;

  constructor(args: { config: GitHubSourceConfig; fetchImpl?: FetchLike | undefined }) {
    this.config = args.config;
    this.fetchImpl = args.fetchImpl ?? fetch;
    this.sourceKey = args.config.key ?? `github:${args.config.repo}`;
  }

  private async *fetchItemsForScope(
    scope: GitHubSourceConfig['fetch']['normal'],
    since?: Date,
  ): AsyncIterable<Omit<Item, 'id'>> {
    for (const state of scope.states) {
      let page = 1;
      while (true) {
        const url = new URL(`https://api.github.com/repos/${this.config.repo}/issues`);
        url.searchParams.set('state', state);
        url.searchParams.set('per_page', '100');
        url.searchParams.set('page', String(page));
        url.searchParams.set('sort', 'updated');
        url.searchParams.set('direction', 'desc');
        if (since) url.searchParams.set('since', since.toISOString());
        const issues = await fetchJson<GitHubIssueFixture[]>(this.fetchImpl, url.toString(), {
          headers: authHeaders(this.config.authEnv),
        });
        if (issues.length === 0) break;
        for (const raw of issues) {
          const item = normalizeGitHubIssue({
            sourceKey: this.sourceKey,
            repo: this.config.repo,
            raw,
            referenceOnly: raw.state === 'closed',
          });
          if (item) yield item;
        }
        if (issues.length < 100) break;
        page += 1;
      }
    }
  }

  async *fetchItems(): AsyncIterable<Omit<Item, 'id'>> {
    yield* this.fetchItemsForScope(this.config.fetch.normal);
  }

  async *fetchItemsSince(since: Date): AsyncIterable<Omit<Item, 'id'>> {
    yield* this.fetchItemsForScope(this.config.fetch.normal, since);
  }

  async *fetchBackfillItems(since?: Date): AsyncIterable<Omit<Item, 'id'>> {
    yield* this.fetchItemsForScope(this.config.fetch.backfill, since);
  }

  async *fetchReplies(item: Item): AsyncIterable<Omit<Reply, 'id' | 'itemId'>> {
    const issueNumber = item.metadata.issueNumber;
    if (typeof issueNumber !== 'number') return;
    let page = 1;
    while (true) {
      const url = new URL(`https://api.github.com/repos/${this.config.repo}/issues/${issueNumber}/comments`);
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      const comments = await fetchJson<GitHubCommentFixture[]>(this.fetchImpl, url.toString(), {
        headers: authHeaders(this.config.authEnv),
      });
      if (comments.length === 0) break;
      for (const comment of comments) yield normalizeGitHubComment(comment);
      if (comments.length < 100) break;
      page += 1;
    }
  }
}
