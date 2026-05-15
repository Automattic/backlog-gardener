import { appendBotMarker, hasBotMarker, REPORT_MARKER } from './markers.js';
import { bodyHash, type AppStateStore } from './state.js';
import type { AppDecision, BotMarker, IssueRef, PullRequestReviewComment, RepoRef, ReportUpdate } from './types.js';

export interface GitHubIssueSummary {
  number: number;
  title: string;
  state: 'open' | 'closed';
  body?: string;
  url?: string;
  authorLogin?: string | null;
  labels?: string[];
  createdAt?: string;
  updatedAt?: string;
  authorAssociation?: string;
}

export interface GitHubPullRequestSummary {
  number: number;
  title: string;
  body: string;
  url: string;
  draft: boolean;
  authorLogin: string | null;
  baseRef: string;
  headRef: string;
  headSha: string;
}

export interface GitHubPullRequestFileSummary {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string;
}

export interface GitHubCommentSummary {
  id: number;
  body: string;
  user?: { type?: string; login?: string };
  createdAt?: string;
  updatedAt?: string;
  authorAssociation?: string;
}

export interface GitHubPullRequestReviewSummary {
  id: number;
  body: string;
}

export interface GitHubAppClient {
  listIssues(args: {
    owner: string;
    repo: string;
    state: 'open' | 'closed' | 'all';
    labels?: string;
  }): Promise<GitHubIssueSummary[]>;
  createIssue(args: { owner: string; repo: string; title: string; body: string }): Promise<GitHubIssueSummary>;
  getIssue?(args: { owner: string; repo: string; issueNumber: number }): Promise<GitHubIssueSummary>;
  getPullRequest?(args: { owner: string; repo: string; pullNumber: number }): Promise<GitHubPullRequestSummary>;
  listPullRequestFiles?(args: {
    owner: string;
    repo: string;
    pullNumber: number;
  }): Promise<GitHubPullRequestFileSummary[]>;
  searchIssues?(args: { owner: string; repo: string; query: string; perPage?: number }): Promise<GitHubIssueSummary[]>;
  fetchTextFile?(args: { owner: string; repo: string; path: string; ref?: string }): Promise<string | null>;
  listIssueComments(args: { owner: string; repo: string; issueNumber: number }): Promise<GitHubCommentSummary[]>;
  createIssueComment(args: {
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
  }): Promise<GitHubCommentSummary>;
  updateIssueComment(args: {
    owner: string;
    repo: string;
    commentId: number;
    body: string;
  }): Promise<GitHubCommentSummary>;
  createRepositoryDispatch?(args: {
    owner: string;
    repo: string;
    eventType: string;
    clientPayload: Record<string, unknown>;
  }): Promise<void>;
  createPullRequestReview?(args: {
    owner: string;
    repo: string;
    pullNumber: number;
    body: string;
    event: 'COMMENT';
    comments?: PullRequestReviewComment[];
  }): Promise<GitHubPullRequestReviewSummary>;
}

export async function publishDecision(args: {
  client: GitHubAppClient;
  state: AppStateStore;
  decision: AppDecision;
}): Promise<'skipped' | 'published'> {
  if (args.decision.type === 'update_report') {
    await publishReport({ client: args.client, state: args.state, report: args.decision.report });
    return 'published';
  }
  if (args.decision.type === 'comment_on_issue') {
    await publishIssueComment({
      client: args.client,
      state: args.state,
      issue: args.decision.issue,
      marker: args.decision.marker,
      body: args.decision.body,
    });
    return 'published';
  }
  if (args.decision.type === 'review_pull_request') {
    if (args.decision.mode === 'noop') return 'skipped';
    await publishPrReviewComment({ client: args.client, decision: args.decision });
    return 'published';
  }
  return 'skipped';
}

async function publishPrReviewComment(args: {
  client: GitHubAppClient;
  decision: Extract<AppDecision, { type: 'review_pull_request' }>;
}): Promise<{ reviewId: number }> {
  if (!args.client.createPullRequestReview) throw new Error('GitHub client does not support pull request reviews');
  const pr = args.decision.pullRequest;
  const body =
    args.decision.reviewBody ??
    [
      '🌱 **Backlog Gardener PR review test**',
      '',
      `Received \`${args.decision.reason}\` for this PR.`,
      '',
      `Mode: \`${args.decision.mode}\``,
      `Event type: \`${args.decision.eventType}\``,
      '',
      '_This is a test review from the Backlog Gardener GitHub App._',
    ].join('\n');
  const review = await args.client.createPullRequestReview({
    owner: pr.owner,
    repo: pr.repo,
    pullNumber: pr.pullRequestNumber,
    body,
    event: 'COMMENT',
    ...(args.decision.reviewComments?.length ? { comments: args.decision.reviewComments } : {}),
  });
  return { reviewId: review.id };
}

export async function publishReport(args: {
  client: GitHubAppClient;
  state: AppStateStore;
  report: ReportUpdate;
}): Promise<{ issueNumber: number; commentId: number }> {
  const issue = await findOrCreateReportIssue(args.client, args.report.repo, args.report.title);
  const existing = args.state.findBotComment({
    installationId: args.report.repo.installationId,
    repo: args.report.repo.fullName,
    issueNumber: issue.number,
    marker: 'report',
  });
  const body = hasBotMarker(args.report.body, 'report')
    ? args.report.body
    : appendBotMarker(args.report.body, REPORT_MARKER);
  if (existing) {
    const comment = await args.client.updateIssueComment({
      owner: args.report.repo.owner,
      repo: args.report.repo.repo,
      commentId: existing.commentId,
      body,
    });
    recordBotComment(args.state, args.report.repo, issue.number, comment.id, 'report', body);
    return { issueNumber: issue.number, commentId: comment.id };
  }

  const markerComment = await findMarkerComment(args.client, args.report.repo, issue.number, 'report');
  if (markerComment) {
    const comment = await args.client.updateIssueComment({
      owner: args.report.repo.owner,
      repo: args.report.repo.repo,
      commentId: markerComment.id,
      body,
    });
    recordBotComment(args.state, args.report.repo, issue.number, comment.id, 'report', body);
    return { issueNumber: issue.number, commentId: comment.id };
  }

  const comment = await args.client.createIssueComment({
    owner: args.report.repo.owner,
    repo: args.report.repo.repo,
    issueNumber: issue.number,
    body,
  });
  recordBotComment(args.state, args.report.repo, issue.number, comment.id, 'report', body);
  return { issueNumber: issue.number, commentId: comment.id };
}

export async function publishIssueComment(args: {
  client: GitHubAppClient;
  state: AppStateStore;
  issue: IssueRef;
  marker: BotMarker;
  body: string;
}): Promise<{ commentId: number }> {
  const body = appendBotMarker(args.body, args.marker);
  const stored = args.state.findBotComment({
    installationId: args.issue.installationId,
    repo: args.issue.fullName,
    issueNumber: args.issue.issueNumber,
    marker: args.marker.type,
  });
  const markerComment = stored
    ? null
    : await findMarkerComment(args.client, args.issue, args.issue.issueNumber, args.marker.type);
  const existingCommentId = stored?.commentId ?? markerComment?.id ?? null;
  if (existingCommentId !== null) {
    const comment = await args.client.updateIssueComment({
      owner: args.issue.owner,
      repo: args.issue.repo,
      commentId: existingCommentId,
      body,
    });
    recordBotComment(args.state, args.issue, args.issue.issueNumber, comment.id, args.marker.type, body);
    return { commentId: comment.id };
  }
  const comment = await args.client.createIssueComment({
    owner: args.issue.owner,
    repo: args.issue.repo,
    issueNumber: args.issue.issueNumber,
    body,
  });
  recordBotComment(args.state, args.issue, args.issue.issueNumber, comment.id, args.marker.type, body);
  return { commentId: comment.id };
}

async function findOrCreateReportIssue(
  client: GitHubAppClient,
  repo: RepoRef,
  title: string,
): Promise<GitHubIssueSummary> {
  const issues = await client.listIssues({ owner: repo.owner, repo: repo.repo, state: 'open' });
  const existing = issues.find((issue) => issue.title === title);
  if (existing) return existing;
  return client.createIssue({ owner: repo.owner, repo: repo.repo, title, body: 'Backlog Gardener report issue.' });
}

async function findMarkerComment(
  client: GitHubAppClient,
  repo: RepoRef,
  issueNumber: number,
  marker: BotMarker['type'],
): Promise<GitHubCommentSummary | null> {
  const comments = await client.listIssueComments({ owner: repo.owner, repo: repo.repo, issueNumber });
  return comments.find((comment) => hasBotMarker(comment.body, marker)) ?? null;
}

function recordBotComment(
  state: AppStateStore,
  repo: RepoRef,
  issueNumber: number,
  commentId: number,
  marker: BotMarker['type'],
  body: string,
): void {
  const now = new Date().toISOString();
  state.upsertBotComment({
    installationId: repo.installationId,
    repo: repo.fullName,
    issueNumber,
    commentId,
    marker,
    bodyHash: bodyHash(body),
    createdAt: now,
    updatedAt: now,
  });
}
