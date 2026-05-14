import type { ActionPlanningEntry } from '../actions/plan.js';
import type { DraftPrCandidacy } from '../actions/pr-candidacy.js';

export type DraftPrImplementationStatus = 'patch_created' | 'no_patch' | 'not_attempted';
export type DraftPrVerificationStatus = 'passed' | 'failed' | 'not_run';

export interface DraftPrImplementerInput {
  entry: ActionPlanningEntry;
  candidacy: DraftPrCandidacy;
  sourceRoot: string;
  workspacePath: string;
}

export interface DraftPrPatchResult {
  status: 'patch_created';
  title: string;
  body: string;
  patch: string;
  changedFiles: string[];
  verification: {
    status: DraftPrVerificationStatus;
    commands: string[];
    summary: string;
  };
}

export interface DraftPrNoPatchResult {
  status: 'no_patch' | 'not_attempted';
  reason: string;
}

export type DraftPrImplementerResult = DraftPrPatchResult | DraftPrNoPatchResult;

export interface DraftPrImplementer {
  readonly name: string;
  implement(input: DraftPrImplementerInput): Promise<DraftPrImplementerResult>;
}
