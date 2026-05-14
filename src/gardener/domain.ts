export type SourceType = 'github' | 'wporg-reviews' | 'wporg-forum';
export type RecapDecision = 'surface' | 'defer' | 'dedupe' | 'needs-info';
export type RecapConfidence = 'high' | 'medium' | 'low';
export type RecapNovelty = 'new' | 'recurring' | 'escalating' | 'longstanding';
export type FinalDecision = RecapDecision;
export type SurfacingLabel = 'developer-ready' | 'worth-investigating';
export type FindingLifecycleStatus =
  | 'new'
  | 'surfaced'
  | 'accepted'
  | 'dismissed'
  | 'snoozed'
  | 'acted-on'
  | 'superseded';

export interface Item {
  id: string;
  sourceKey: string;
  sourceType: SourceType;
  sourceId: string;
  url: string;
  title: string;
  body: string;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  bodyHash: string;
  latestSnapshotHash: string | null;
  referenceOnly: boolean;
  metadata: Record<string, unknown>;
  raw: unknown;
}

export interface Reply {
  id: string;
  itemId: string;
  sourceReplyId: string;
  author: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  bodyHash: string;
  metadata: Record<string, unknown>;
  raw: unknown;
}

export interface Snapshot {
  id: string;
  itemId: string;
  snapshotHash: string;
  bodyHash: string;
  takenAt: string;
}

export interface RecapEvidence {
  label: string;
  detail: string;
  sourceUrl: string;
  quote: string | null;
}

export interface RelatedLink {
  url: string;
  title: string;
}

export interface Recap {
  decision: RecapDecision;
  sourceType: 'github_issue' | 'wporg_review' | 'wporg_forum';
  shortTitle: string;
  summary: string;
  novelty: RecapNovelty;
  bestSolution: string;
  risks: string[];
  confidence: RecapConfidence;
  evidence: RecapEvidence[];
  relatedLinks: RelatedLink[];
  reason: string;
}

export interface AttentionFacts {
  protectedLabel: { present: boolean; labels: string[] };
  linkedOpenPr: { present: boolean; urls: string[] };
  maintainerActivity: {
    status: 'none' | 'active' | 'stale';
    lastAt: string | null;
    actors: string[];
  };
  dismissedOrSnoozed: { present: boolean; reason: string | null };
}

export interface FindingDecision {
  finalDecision: FinalDecision;
  recapDecision: RecapDecision;
  gateReasons: string[];
  surfacingReason: string;
}

export interface Finding {
  id: string;
  targetKind: 'item' | 'cluster';
  targetId: string;
  reviewPolicyHash: string;
  snapshotHash: string;
  recap: Recap;
  attentionFacts: AttentionFacts;
  decision: FindingDecision;
  surfacingLabel: SurfacingLabel | null;
  lifecycleStatus: FindingLifecycleStatus;
  createdAt: string;
  updatedAt: string;
}

export type FeedbackVerdict = 'useful' | 'maybe-useful' | 'not-useful';
export interface FeedbackRecord {
  id: string;
  findingId: string;
  verdict: FeedbackVerdict;
  reasons: string[];
  status: FindingLifecycleStatus;
  note: string | null;
  reviewer: string | null;
  createdAt: string;
  updatedAt: string;
}
