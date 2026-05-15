export type AppTrigger = 'webhook' | 'schedule';

export type AppConfidence = 'low' | 'medium' | 'high';

export interface RepoRef {
  installationId: number;
  owner: string;
  repo: string;
  fullName: string;
}

export interface IssueRef extends RepoRef {
  issueNumber: number;
  url?: string;
}

export interface PullRequestRef extends RepoRef {
  pullRequestNumber: number;
  url?: string;
  draft: boolean;
  authorLogin: string | null;
  headSha?: string;
}

export type BotMarkerType = 'report' | 'duplicate' | 'needs-info' | 'summary';

export interface BotMarker {
  type: BotMarkerType;
  version: 1;
}

export interface ReportUpdate {
  repo: RepoRef;
  title: string;
  body: string;
  decisionCounts: Record<string, number>;
  trigger: AppTrigger;
  runId: string;
}

export type AppDecision =
  | { type: 'do_nothing'; reason: string }
  | { type: 'update_report'; report: ReportUpdate }
  | {
      type: 'comment_on_issue';
      issue: IssueRef;
      marker: BotMarker;
      body: string;
      confidence: Extract<AppConfidence, 'medium' | 'high'>;
    }
  | {
      type: 'review_pull_request';
      pullRequest: PullRequestRef;
      eventType: string;
      mode: 'noop' | 'live';
      reason: string;
      reviewBody?: string;
    };

export interface PolicyResult {
  allowed: boolean;
  reasons: string[];
}

export interface AppRunRecord {
  id: string;
  installationId: number;
  repo: string;
  productSlug: string;
  trigger: AppTrigger;
  eventName: string;
  deliveryId: string | null;
  status: 'started' | 'completed' | 'failed' | 'skipped';
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface AppJobRecord {
  id: string;
  deliveryId: string;
  eventName: string;
  repo: string | null;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'skipped';
  payloadJson: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface DecisionRecord {
  id: string;
  runId: string;
  repo: string;
  issueNumber: number | null;
  decisionType: AppDecision['type'];
  confidence: AppConfidence | null;
  marker: BotMarkerType | null;
  policyAllowed: boolean;
  policyReasons: string[];
  createdAt: string;
}

export type AppInvestigationSubjectType = 'issue' | 'pull_request';
export type AppInvestigationStatus = 'comment_ready' | 'review_ready' | 'suppressed' | 'no_output';
export type AppPublicationStatus = 'pending' | 'published' | 'skipped' | 'failed';

export interface AppInvestigationArtifactRecord {
  id: string;
  jobId: string | null;
  runId: string | null;
  deliveryId: string | null;
  repo: string;
  subjectType: AppInvestigationSubjectType;
  subjectNumber: number;
  status: AppInvestigationStatus;
  suppressionReason: string | null;
  publicationStatus: AppPublicationStatus | null;
  generatedBody: string | null;
  details: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BotCommentRecord {
  installationId: number;
  repo: string;
  issueNumber: number;
  commentId: number;
  marker: BotMarkerType;
  bodyHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface CooldownRecord {
  installationId: number;
  repo: string;
  issueNumber: number;
  marker: BotMarkerType;
  until: string;
}
