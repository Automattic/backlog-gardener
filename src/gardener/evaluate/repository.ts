import { newId, nowIso } from '../ids.js';
import type { DatabaseHandle } from '../store/db.js';
import type { EvaluationDecision, EvaluationRecord, VerificationDecision, VerificationRecord } from './types.js';

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  return JSON.parse(value) as T;
}

type Row = Record<string, unknown>;

function evaluationFromRow(row: Row): EvaluationRecord {
  return {
    id: String(row.id),
    findingId: String(row.finding_id),
    provider: String(row.provider),
    model: String(row.model),
    action: row.action as EvaluationRecord['action'],
    confidence: row.confidence as EvaluationRecord['confidence'],
    reason: String(row.reason),
    developerSummary: String(row.developer_summary),
    recommendedNextStep: String(row.recommended_next_step),
    proposedExternalComment: row.proposed_external_comment === null ? null : String(row.proposed_external_comment),
    requiresHumanApproval: Number(row.requires_human_approval) === 1,
    riskFlags: parseJson<string[]>(row.risk_flags_json, []),
    createdAt: String(row.created_at),
  };
}

function verificationFromRow(row: Row): VerificationRecord {
  return {
    id: String(row.id),
    findingId: String(row.finding_id),
    evaluationId: row.evaluation_id === null ? null : String(row.evaluation_id),
    provider: String(row.provider),
    model: String(row.model),
    action: row.action as VerificationRecord['action'],
    confidence: row.confidence as VerificationRecord['confidence'],
    subsystem: String(row.subsystem),
    likelyFiles: parseJson<string[]>(row.likely_files_json, []),
    hypotheses: parseJson<string[]>(row.hypotheses_json, []),
    suggestedReproSteps: parseJson<string[]>(row.suggested_repro_steps_json, []),
    suggestedTests: parseJson<string[]>(row.suggested_tests_json, []),
    developerNotes: String(row.developer_notes),
    requiresHumanApproval: Number(row.requires_human_approval) === 1,
    createdAt: String(row.created_at),
  };
}

export class EvaluationRepository {
  constructor(private readonly db: DatabaseHandle) {}

  insert(args: { findingId: string; provider: string; model: string; decision: EvaluationDecision }): EvaluationRecord {
    const id = newId('evl');
    const createdAt = nowIso();
    this.db
      .prepare(
        `
      INSERT INTO evaluations (
        id, finding_id, provider, model, action, confidence, reason, developer_summary,
        recommended_next_step, proposed_external_comment, requires_human_approval, risk_flags_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        args.findingId,
        args.provider,
        args.model,
        args.decision.action,
        args.decision.confidence,
        args.decision.reason,
        args.decision.developerSummary,
        args.decision.recommendedNextStep,
        args.decision.proposedExternalComment,
        args.decision.requiresHumanApproval ? 1 : 0,
        json(args.decision.riskFlags),
        createdAt,
      );
    return (
      this.latestForFinding(args.findingId) ?? {
        id,
        findingId: args.findingId,
        provider: args.provider,
        model: args.model,
        createdAt,
        ...args.decision,
      }
    );
  }

  latestForFinding(findingId: string): EvaluationRecord | null {
    const row = this.db
      .prepare('SELECT * FROM evaluations WHERE finding_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(findingId) as Row | undefined;
    return row ? evaluationFromRow(row) : null;
  }

  listLatest(): Map<string, EvaluationRecord> {
    const rows = this.db.prepare('SELECT * FROM evaluations ORDER BY created_at DESC').all() as Row[];
    const map = new Map<string, EvaluationRecord>();
    for (const row of rows) {
      const record = evaluationFromRow(row);
      if (!map.has(record.findingId)) map.set(record.findingId, record);
    }
    return map;
  }
}

export class VerificationRepository {
  constructor(private readonly db: DatabaseHandle) {}

  insert(args: {
    findingId: string;
    evaluationId: string | null;
    provider: string;
    model: string;
    decision: VerificationDecision;
  }): VerificationRecord {
    const id = newId('vrf');
    const createdAt = nowIso();
    this.db
      .prepare(
        `
      INSERT INTO verifications (
        id, finding_id, evaluation_id, provider, model, action, confidence, subsystem, likely_files_json,
        hypotheses_json, suggested_repro_steps_json, suggested_tests_json, developer_notes, requires_human_approval, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        args.findingId,
        args.evaluationId,
        args.provider,
        args.model,
        args.decision.action,
        args.decision.confidence,
        args.decision.subsystem,
        json(args.decision.likelyFiles),
        json(args.decision.hypotheses),
        json(args.decision.suggestedReproSteps),
        json(args.decision.suggestedTests),
        args.decision.developerNotes,
        args.decision.requiresHumanApproval ? 1 : 0,
        createdAt,
      );
    return (
      this.latestForFinding(args.findingId) ?? {
        id,
        findingId: args.findingId,
        evaluationId: args.evaluationId,
        provider: args.provider,
        model: args.model,
        createdAt,
        ...args.decision,
      }
    );
  }

  latestForFinding(findingId: string): VerificationRecord | null {
    const row = this.db
      .prepare('SELECT * FROM verifications WHERE finding_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(findingId) as Row | undefined;
    return row ? verificationFromRow(row) : null;
  }

  listLatest(): Map<string, VerificationRecord> {
    const rows = this.db.prepare('SELECT * FROM verifications ORDER BY created_at DESC').all() as Row[];
    const map = new Map<string, VerificationRecord>();
    for (const row of rows) {
      const record = verificationFromRow(row);
      if (!map.has(record.findingId)) map.set(record.findingId, record);
    }
    return map;
  }
}
