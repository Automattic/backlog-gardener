import type { FeedbackRecord, Finding, Item } from '../domain.js';
import { EvaluationRepository, VerificationRepository } from '../evaluate/repository.js';
import type { EvaluationRecord, VerificationRecord } from '../evaluate/types.js';
import { StoreDb } from '../store/index.js';

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  return JSON.parse(value) as T;
}

type Row = Record<string, unknown>;

export interface ReviewRun {
  id: string;
  lane: string;
  mode: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  summary: Record<string, unknown>;
}

export interface ReviewFinding {
  finding: Finding;
  item: Item | null;
  feedback: FeedbackRecord[];
  evaluation: EvaluationRecord | null;
  verification: VerificationRecord | null;
}

function findingFromRow(row: Row): Finding {
  return {
    id: String(row.id),
    targetKind: row.target_kind as Finding['targetKind'],
    targetId: String(row.target_id),
    reviewPolicyHash: String(row.review_policy_hash),
    snapshotHash: String(row.snapshot_hash),
    recap: parseJson<Finding['recap']>(row.recap_json, {} as Finding['recap']),
    attentionFacts: parseJson<Finding['attentionFacts']>(row.attention_facts_json, {} as Finding['attentionFacts']),
    decision: parseJson<Finding['decision']>(row.decision_json, {} as Finding['decision']),
    surfacingLabel: row.surfacing_label === null ? null : (String(row.surfacing_label) as Finding['surfacingLabel']),
    lifecycleStatus: row.lifecycle_status as Finding['lifecycleStatus'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function itemFromRow(row: Row): Item {
  return {
    id: String(row.item_id),
    sourceKey: String(row.source_key),
    sourceType: row.source_type as Item['sourceType'],
    sourceId: String(row.source_id),
    url: String(row.url),
    title: String(row.title),
    body: String(row.body),
    author: row.author === null ? null : String(row.author),
    createdAt: String(row.item_created_at),
    updatedAt: String(row.item_updated_at),
    bodyHash: String(row.body_hash),
    latestSnapshotHash: row.latest_snapshot_hash === null ? null : String(row.latest_snapshot_hash),
    referenceOnly: Number(row.reference_only) === 1,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    raw: parseJson<unknown>(row.raw_json, null),
  };
}

function feedbackFromRow(row: Row): FeedbackRecord {
  return {
    id: String(row.id),
    findingId: String(row.finding_id),
    verdict: row.verdict as FeedbackRecord['verdict'],
    reasons: parseJson<string[]>(row.reasons_json, []),
    status: row.status as FeedbackRecord['status'],
    note: row.note === null ? null : String(row.note),
    reviewer: row.reviewer === null ? null : String(row.reviewer),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function readReviewRuns(statePath: string, limit = 20): ReviewRun[] {
  const db = new StoreDb(statePath);
  db.migrate();
  try {
    return (db.db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?').all(limit) as Row[]).map((row) => ({
      id: String(row.id),
      lane: String(row.lane),
      mode: String(row.mode),
      status: String(row.status),
      startedAt: String(row.started_at),
      finishedAt: row.finished_at === null ? null : String(row.finished_at),
      summary: parseJson<Record<string, unknown>>(row.summary_json, {}),
    }));
  } finally {
    db.close();
  }
}

export function readReviewFindings(statePath: string, limit = 100): ReviewFinding[] {
  const db = new StoreDb(statePath);
  db.migrate();
  try {
    const rows = db.db
      .prepare(
        `
      SELECT
        f.*,
        i.id AS item_id,
        i.source_key,
        i.source_type,
        i.source_id,
        i.url,
        i.title,
        i.body,
        i.author,
        i.created_at AS item_created_at,
        i.updated_at AS item_updated_at,
        i.body_hash,
        i.latest_snapshot_hash,
        i.reference_only,
        i.metadata_json,
        i.raw_json
      FROM findings f
      LEFT JOIN items i ON f.target_kind = 'item' AND f.target_id = i.id
      ORDER BY
        CASE json_extract(f.decision_json, '$.finalDecision') WHEN 'surface' THEN 0 WHEN 'defer' THEN 1 ELSE 2 END,
        f.created_at DESC
      LIMIT ?
    `,
      )
      .all(limit) as Row[];
    const evaluations = new EvaluationRepository(db.db).listLatest();
    const verifications = new VerificationRepository(db.db).listLatest();
    const feedbackRows = db.db.prepare('SELECT * FROM feedback').all() as Row[];
    const feedbackByFinding = new Map<string, FeedbackRecord[]>();
    for (const feedback of feedbackRows.map(feedbackFromRow)) {
      feedbackByFinding.set(feedback.findingId, [...(feedbackByFinding.get(feedback.findingId) ?? []), feedback]);
    }
    return rows.map((row) => ({
      finding: findingFromRow(row),
      item: row.item_id === null ? null : itemFromRow(row),
      feedback: feedbackByFinding.get(String(row.id)) ?? [],
      evaluation: evaluations.get(String(row.id)) ?? null,
      verification: verifications.get(String(row.id)) ?? null,
    }));
  } finally {
    db.close();
  }
}
