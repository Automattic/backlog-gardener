export type EvaluationAction =
  | 'accept_for_developer_attention'
  | 'defer_because_already_active'
  | 'dismiss_as_noise'
  | 'request_more_info'
  | 'merge_with_existing';

export type VerificationAction =
  | 'debugging_plan_ready'
  | 'needs_reproduction_info'
  | 'needs_code_context'
  | 'likely_external_or_upstream'
  | 'not_reproducible_from_available_info';

export type AgentConfidence = 'low' | 'medium' | 'high';

export interface EvaluationDecision {
  action: EvaluationAction;
  confidence: AgentConfidence;
  reason: string;
  developerSummary: string;
  recommendedNextStep: string;
  proposedExternalComment: string | null;
  requiresHumanApproval: boolean;
  riskFlags: string[];
}

export interface EvaluationRecord extends EvaluationDecision {
  id: string;
  findingId: string;
  provider: string;
  model: string;
  createdAt: string;
}

export interface VerificationDecision {
  action: VerificationAction;
  confidence: AgentConfidence;
  subsystem: string;
  likelyFiles: string[];
  hypotheses: string[];
  suggestedReproSteps: string[];
  suggestedTests: string[];
  developerNotes: string;
  requiresHumanApproval: boolean;
}

export interface VerificationRecord extends VerificationDecision {
  id: string;
  findingId: string;
  evaluationId: string | null;
  provider: string;
  model: string;
  createdAt: string;
}
