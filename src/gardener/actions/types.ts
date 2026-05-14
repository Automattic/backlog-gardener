import type { RecapConfidence, RecapEvidence } from '../domain.js';

export type ProposedActionType = 'add_context_to_existing_issue' | 'create_issue' | 'open_pr';
export type ProposedActionStatus = 'would_apply' | 'blocked' | 'not_supported_yet';

export type ActionTarget =
  | {
      system: 'github';
      kind: 'issue';
      repo: string;
      issueNumber: number;
      url: string;
    }
  | {
      system: 'github';
      kind: 'new_issue';
      repo: string;
      labels: string[];
    }
  | {
      system: 'github';
      kind: 'pull_request';
      repo: string;
      baseBranch: string;
      branchName: string;
    }
  | {
      system: 'linear';
      kind: 'new_issue' | 'existing_issue';
      teamKey?: string;
      issueIdentifier?: string;
      url?: string;
    };

export type ActionEvidence = RecapEvidence;

export interface ProposedPrArtifacts {
  patchPath: string;
  prBodyPath: string;
  verificationPath: string;
  verificationStatus: 'passed' | 'failed' | 'not_run';
}

export interface ProposedAction {
  schemaVersion: 'gardener.action.v1';
  actionId: string;
  runId: string;
  productSlug: string;
  type: ProposedActionType;
  status: ProposedActionStatus;
  dryRun: boolean;
  confidence: RecapConfidence;
  title: string;
  body: string;
  target: ActionTarget;
  sourceFindingIds: string[];
  sourceUrls: string[];
  evidence: ActionEvidence[];
  rationale: string;
  prArtifacts?: ProposedPrArtifacts;
  safety: {
    externalWritesEnabled: boolean;
    requiresApproval: boolean;
    blockedReasons: string[];
  };
  createdAt: string;
}
