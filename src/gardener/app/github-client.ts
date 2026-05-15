import { Buffer } from 'node:buffer';

import { parseGitHubAppConfig, type GitHubAppConfig } from './config.js';
import type {
  GitHubCommentSummary,
  GitHubAppClient,
  GitHubIssueSummary,
  GitHubPullRequestFileSummary,
  GitHubPullRequestSummary,
} from './publisher.js';
import type { RepoRef } from './types.js';

export interface GitHubRestClientOptions {
  token: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface GitHubApiIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  body?: string | null;
  html_url?: string;
  user?: { login?: string } | null;
  labels?: Array<string | { name?: string | null }>;
  created_at?: string;
  updated_at?: string;
  author_association?: string;
}

interface GitHubApiComment {
  id: number;
  body?: string | null;
  user?: { type?: string; login?: string } | null;
  created_at?: string;
  updated_at?: string;
  author_association?: string;
}

interface GitHubApiPullRequestReview {
  id: number;
  body?: string | null;
}

interface GitHubApiPullRequest {
  number: number;
  title: string;
  body?: string | null;
  html_url?: string;
  draft?: boolean;
  user?: { login?: string } | null;
  base?: { ref?: string };
  head?: { ref?: string; sha?: string };
}

interface GitHubApiPullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

interface GitHubApiSearchIssuesResponse {
  items: GitHubApiIssue[];
}

interface GitHubContentFile {
  type: string;
  encoding?: string;
  content?: string;
}

export class GitHubRestAppClient implements GitHubAppClient {
  private readonly token: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GitHubRestClientOptions) {
    this.token = options.token;
    this.apiBaseUrl = options.apiBaseUrl ?? 'https://api.github.com';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listIssues(args: {
    owner: string;
    repo: string;
    state: 'open' | 'closed' | 'all';
    labels?: string;
  }): Promise<GitHubIssueSummary[]> {
    const search = new URLSearchParams({ state: args.state, per_page: '100' });
    if (args.labels) search.set('labels', args.labels);
    const issues = await this.request<GitHubApiIssue[]>(
      `/repos/${args.owner}/${args.repo}/issues?${search.toString()}`,
    );
    return issues.map((issue) => ({ number: issue.number, title: issue.title, state: issue.state }));
  }

  async createIssue(args: { owner: string; repo: string; title: string; body: string }): Promise<GitHubIssueSummary> {
    const issue = await this.request<GitHubApiIssue>(`/repos/${args.owner}/${args.repo}/issues`, {
      method: 'POST',
      body: { title: args.title, body: args.body },
    });
    return { number: issue.number, title: issue.title, state: issue.state };
  }

  async listIssueComments(args: { owner: string; repo: string; issueNumber: number }): Promise<GitHubCommentSummary[]> {
    const comments = await this.request<GitHubApiComment[]>(
      `/repos/${args.owner}/${args.repo}/issues/${args.issueNumber}/comments?per_page=100`,
    );
    return comments.map((comment) => {
      const user = comment.user
        ? {
            ...(comment.user.type ? { type: comment.user.type } : {}),
            ...(comment.user.login ? { login: comment.user.login } : {}),
          }
        : null;
      return {
        id: comment.id,
        body: comment.body ?? '',
        ...(user ? { user } : {}),
        ...(comment.created_at ? { createdAt: comment.created_at } : {}),
        ...(comment.updated_at ? { updatedAt: comment.updated_at } : {}),
        ...(comment.author_association ? { authorAssociation: comment.author_association } : {}),
      };
    });
  }

  async createIssueComment(args: {
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
  }): Promise<GitHubCommentSummary> {
    const comment = await this.request<GitHubApiComment>(
      `/repos/${args.owner}/${args.repo}/issues/${args.issueNumber}/comments`,
      { method: 'POST', body: { body: args.body } },
    );
    return { id: comment.id, body: comment.body ?? '' };
  }

  async updateIssueComment(args: {
    owner: string;
    repo: string;
    commentId: number;
    body: string;
  }): Promise<GitHubCommentSummary> {
    const comment = await this.request<GitHubApiComment>(
      `/repos/${args.owner}/${args.repo}/issues/comments/${args.commentId}`,
      {
        method: 'PATCH',
        body: { body: args.body },
      },
    );
    return { id: comment.id, body: comment.body ?? '' };
  }

  async getIssue(args: { owner: string; repo: string; issueNumber: number }): Promise<GitHubIssueSummary> {
    const issue = await this.request<GitHubApiIssue>(`/repos/${args.owner}/${args.repo}/issues/${args.issueNumber}`);
    return {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      body: issue.body ?? '',
      url: issue.html_url ?? '',
      authorLogin: issue.user?.login ?? null,
      labels: labelsFromApi(issue.labels),
      ...(issue.created_at ? { createdAt: issue.created_at } : {}),
      ...(issue.updated_at ? { updatedAt: issue.updated_at } : {}),
      ...(issue.author_association ? { authorAssociation: issue.author_association } : {}),
    };
  }

  async getPullRequest(args: { owner: string; repo: string; pullNumber: number }): Promise<GitHubPullRequestSummary> {
    const pr = await this.request<GitHubApiPullRequest>(`/repos/${args.owner}/${args.repo}/pulls/${args.pullNumber}`);
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body ?? '',
      url: pr.html_url ?? '',
      draft: pr.draft ?? false,
      authorLogin: pr.user?.login ?? null,
      baseRef: pr.base?.ref ?? '',
      headRef: pr.head?.ref ?? '',
      headSha: pr.head?.sha ?? '',
    };
  }

  async listPullRequestFiles(args: {
    owner: string;
    repo: string;
    pullNumber: number;
  }): Promise<GitHubPullRequestFileSummary[]> {
    const files = await this.request<GitHubApiPullRequestFile[]>(
      `/repos/${args.owner}/${args.repo}/pulls/${args.pullNumber}/files?per_page=100`,
    );
    return files.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch ?? '',
    }));
  }

  async searchIssues(args: {
    owner: string;
    repo: string;
    query: string;
    perPage?: number;
  }): Promise<GitHubIssueSummary[]> {
    const search = new URLSearchParams({
      q: `repo:${args.owner}/${args.repo} is:issue ${args.query}`,
      per_page: String(args.perPage ?? 5),
    });
    const result = await this.request<GitHubApiSearchIssuesResponse>(`/search/issues?${search.toString()}`);
    return result.items.map((issue) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      body: issue.body ?? '',
      url: issue.html_url ?? '',
      authorLogin: issue.user?.login ?? null,
      labels: labelsFromApi(issue.labels),
      ...(issue.created_at ? { createdAt: issue.created_at } : {}),
      ...(issue.updated_at ? { updatedAt: issue.updated_at } : {}),
      ...(issue.author_association ? { authorAssociation: issue.author_association } : {}),
    }));
  }

  async createRepositoryDispatch(args: {
    owner: string;
    repo: string;
    eventType: string;
    clientPayload: Record<string, unknown>;
  }): Promise<void> {
    await this.request<void>(`/repos/${args.owner}/${args.repo}/dispatches`, {
      method: 'POST',
      body: { event_type: args.eventType, client_payload: args.clientPayload },
      expectNoContent: true,
    });
  }

  async createPullRequestReview(args: {
    owner: string;
    repo: string;
    pullNumber: number;
    body: string;
    event: 'COMMENT';
  }): Promise<{ id: number; body: string }> {
    const review = await this.request<GitHubApiPullRequestReview>(
      `/repos/${args.owner}/${args.repo}/pulls/${args.pullNumber}/reviews`,
      { method: 'POST', body: { body: args.body, event: args.event } },
    );
    return { id: review.id, body: review.body ?? '' };
  }

  async fetchTextFile(args: { owner: string; repo: string; path: string; ref?: string }): Promise<string | null> {
    const search = new URLSearchParams();
    if (args.ref) search.set('ref', args.ref);
    const suffix = search.size > 0 ? `?${search.toString()}` : '';
    try {
      const file = await this.request<GitHubContentFile>(
        `/repos/${args.owner}/${args.repo}/contents/${encodeURIComponentPath(args.path)}${suffix}`,
      );
      if (file.type !== 'file' || file.encoding !== 'base64' || !file.content) return null;
      return Buffer.from(file.content.replaceAll('\n', ''), 'base64').toString('utf8');
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) return null;
      throw error;
    }
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown; expectNoContent?: boolean } = {},
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (!response.ok) throw new GitHubApiError(response.status, `GitHub API request failed: ${response.status}`);
    if (options.expectNoContent || response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

export async function fetchRepoGitHubAppConfig(args: {
  client: GitHubRestAppClient;
  repo: RepoRef;
  path?: string;
  ref?: string;
}): Promise<GitHubAppConfig> {
  if (args.path) {
    const source = await args.client.fetchTextFile({
      owner: args.repo.owner,
      repo: args.repo.repo,
      path: args.path,
      ...(args.ref ? { ref: args.ref } : {}),
    });
    return parseGitHubAppConfig(source);
  }
  const source = await args.client.fetchTextFile({
    owner: args.repo.owner,
    repo: args.repo.repo,
    path: '.github/gardener.yml',
    ...(args.ref ? { ref: args.ref } : {}),
  });
  return parseGitHubAppConfig(source);
}

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function labelsFromApi(labels: GitHubApiIssue['labels']): string[] {
  return (labels ?? []).map((label) => (typeof label === 'string' ? label : (label.name ?? ''))).filter(Boolean);
}

function encodeURIComponentPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
