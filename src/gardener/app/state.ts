import { createHash } from 'node:crypto';

import { newId, nowIso } from '../ids.js';
import type { DatabaseHandle } from '../store/db.js';
import type {
  AppInvestigationArtifactRecord,
  AppJobRecord,
  AppPublicationStatus,
  AppRunRecord,
  AppTrigger,
  BotCommentRecord,
  BotMarkerType,
  CooldownRecord,
  DecisionRecord,
} from './types.js';

export interface StartRunArgs {
  installationId: number;
  repo: string;
  productSlug: string;
  trigger: AppTrigger;
  eventName: string;
  deliveryId?: string | null;
}

export interface EnqueueJobArgs {
  deliveryId: string;
  eventName: string;
  repo?: string | null;
  payloadJson: string;
}

export interface RecordDecisionArgs {
  runId: string;
  repo: string;
  issueNumber?: number | null;
  decisionType: DecisionRecord['decisionType'];
  confidence?: DecisionRecord['confidence'];
  marker?: BotMarkerType | null;
  policyAllowed: boolean;
  policyReasons: string[];
}

export interface RecordInvestigationArtifactArgs {
  jobId?: string | null;
  runId?: string | null;
  deliveryId?: string | null;
  repo: string;
  subjectType: AppInvestigationArtifactRecord['subjectType'];
  subjectNumber: number;
  status: AppInvestigationArtifactRecord['status'];
  suppressionReason?: string | null;
  publicationStatus?: AppPublicationStatus | null;
  generatedBody?: string | null;
  details: Record<string, unknown>;
}

export interface InvestigationLockArgs {
  key: string;
  owner: string;
  ttlSeconds?: number;
  now?: Date;
}

export interface AppStateStore {
  hasProcessedDelivery(deliveryId: string): boolean;
  recordDelivery(deliveryId: string): void;
  enqueueJob(args: EnqueueJobArgs): AppJobRecord;
  startJob(jobId: string): void;
  completeJob(jobId: string, status: 'completed' | 'failed' | 'skipped', error?: string | null): void;
  startRun(args: StartRunArgs): AppRunRecord;
  completeRun(runId: string, status: 'completed' | 'failed' | 'skipped', error?: string | null): void;
  recordDecision(args: RecordDecisionArgs): DecisionRecord;
  listDecisions(runId?: string): DecisionRecord[];
  recordInvestigationArtifact(args: RecordInvestigationArtifactArgs): AppInvestigationArtifactRecord;
  updateInvestigationPublication(id: string, status: AppPublicationStatus): void;
  listInvestigationArtifacts(runId?: string): AppInvestigationArtifactRecord[];
  acquireInvestigationLock(args: InvestigationLockArgs): boolean;
  releaseInvestigationLock(key: string, owner: string): void;
  upsertBotComment(record: BotCommentRecord): void;
  findBotComment(args: {
    installationId: number;
    repo: string;
    issueNumber: number;
    marker: BotMarkerType;
  }): BotCommentRecord | null;
  setCooldown(record: CooldownRecord): void;
  isCooldownActive(args: {
    installationId: number;
    repo: string;
    issueNumber: number;
    marker: BotMarkerType;
    now?: Date;
  }): boolean;
  hasReviewedPullRequest(args: {
    installationId: number;
    repo: string;
    pullRequestNumber: number;
    headSha: string;
  }): boolean;
  recordPullRequestReview(args: {
    installationId: number;
    repo: string;
    pullRequestNumber: number;
    headSha: string;
    reviewId?: number | null;
  }): void;
}

export class InMemoryAppStateStore implements AppStateStore {
  private deliveries = new Set<string>();
  private jobs = new Map<string, AppJobRecord>();
  private runs = new Map<string, AppRunRecord>();
  private decisions: DecisionRecord[] = [];
  private investigations: AppInvestigationArtifactRecord[] = [];
  private botComments = new Map<string, BotCommentRecord>();
  private cooldowns = new Map<string, CooldownRecord>();
  private investigationLocks = new Map<string, { owner: string; expiresAt: string }>();
  private reviewedPullRequests = new Set<string>();

  hasProcessedDelivery(deliveryId: string): boolean {
    return this.deliveries.has(deliveryId);
  }

  recordDelivery(deliveryId: string): void {
    this.deliveries.add(deliveryId);
  }

  enqueueJob(args: EnqueueJobArgs): AppJobRecord {
    const existing = [...this.jobs.values()].find((job) => job.deliveryId === args.deliveryId);
    if (existing) return existing;
    const record: AppJobRecord = {
      id: newId('app_job'),
      deliveryId: args.deliveryId,
      eventName: args.eventName,
      repo: args.repo ?? null,
      status: 'queued',
      payloadJson: args.payloadJson,
      createdAt: nowIso(),
      startedAt: null,
      completedAt: null,
      error: null,
    };
    this.jobs.set(record.id, record);
    return record;
  }

  startJob(jobId: string): void {
    const record = this.jobs.get(jobId);
    if (record) this.jobs.set(jobId, { ...record, status: 'processing', startedAt: nowIso() });
  }

  completeJob(jobId: string, status: 'completed' | 'failed' | 'skipped', error: string | null = null): void {
    const record = this.jobs.get(jobId);
    if (record) this.jobs.set(jobId, { ...record, status, completedAt: nowIso(), error });
  }

  startRun(args: StartRunArgs): AppRunRecord {
    const record: AppRunRecord = {
      id: newId('app_run'),
      installationId: args.installationId,
      repo: args.repo,
      productSlug: args.productSlug,
      trigger: args.trigger,
      eventName: args.eventName,
      deliveryId: args.deliveryId ?? null,
      status: 'started',
      startedAt: nowIso(),
      completedAt: null,
      error: null,
    };
    this.runs.set(record.id, record);
    return record;
  }

  completeRun(runId: string, status: 'completed' | 'failed' | 'skipped', error: string | null = null): void {
    const record = this.runs.get(runId);
    if (!record) return;
    this.runs.set(runId, { ...record, status, completedAt: nowIso(), error });
  }

  recordDecision(args: RecordDecisionArgs): DecisionRecord {
    const record: DecisionRecord = {
      id: newId('decision'),
      runId: args.runId,
      repo: args.repo,
      issueNumber: args.issueNumber ?? null,
      decisionType: args.decisionType,
      confidence: args.confidence ?? null,
      marker: args.marker ?? null,
      policyAllowed: args.policyAllowed,
      policyReasons: [...args.policyReasons],
      createdAt: nowIso(),
    };
    this.decisions.push(record);
    return record;
  }

  listDecisions(runId?: string): DecisionRecord[] {
    return this.decisions.filter((decision) => !runId || decision.runId === runId);
  }

  recordInvestigationArtifact(args: RecordInvestigationArtifactArgs): AppInvestigationArtifactRecord {
    const now = nowIso();
    const record: AppInvestigationArtifactRecord = {
      id: newId('app_inv'),
      jobId: args.jobId ?? null,
      runId: args.runId ?? null,
      deliveryId: args.deliveryId ?? null,
      repo: args.repo,
      subjectType: args.subjectType,
      subjectNumber: args.subjectNumber,
      status: args.status,
      suppressionReason: args.suppressionReason ?? null,
      publicationStatus: args.publicationStatus ?? null,
      generatedBody: args.generatedBody ?? null,
      details: args.details,
      createdAt: now,
      updatedAt: now,
    };
    this.investigations.push(record);
    return record;
  }

  updateInvestigationPublication(id: string, status: AppPublicationStatus): void {
    this.investigations = this.investigations.map((record) =>
      record.id === id ? { ...record, publicationStatus: status, updatedAt: nowIso() } : record,
    );
  }

  listInvestigationArtifacts(runId?: string): AppInvestigationArtifactRecord[] {
    return this.investigations.filter((record) => !runId || record.runId === runId);
  }

  acquireInvestigationLock(args: InvestigationLockArgs): boolean {
    const now = args.now ?? new Date();
    for (const [key, lock] of this.investigationLocks) {
      if (new Date(lock.expiresAt).getTime() <= now.getTime()) this.investigationLocks.delete(key);
    }
    if (this.investigationLocks.has(args.key)) return false;
    this.investigationLocks.set(args.key, {
      owner: args.owner,
      expiresAt: new Date(now.getTime() + (args.ttlSeconds ?? 1800) * 1000).toISOString(),
    });
    return true;
  }

  releaseInvestigationLock(key: string, owner: string): void {
    if (this.investigationLocks.get(key)?.owner === owner) this.investigationLocks.delete(key);
  }

  upsertBotComment(record: BotCommentRecord): void {
    this.botComments.set(botCommentKey(record), record);
  }

  findBotComment(args: {
    installationId: number;
    repo: string;
    issueNumber: number;
    marker: BotMarkerType;
  }): BotCommentRecord | null {
    return this.botComments.get(botCommentKey(args)) ?? null;
  }

  setCooldown(record: CooldownRecord): void {
    this.cooldowns.set(cooldownKey(record), record);
  }

  isCooldownActive(args: {
    installationId: number;
    repo: string;
    issueNumber: number;
    marker: BotMarkerType;
    now?: Date;
  }): boolean {
    const record = this.cooldowns.get(cooldownKey(args));
    if (!record) return false;
    return new Date(record.until).getTime() > (args.now ?? new Date()).getTime();
  }

  hasReviewedPullRequest(args: {
    installationId: number;
    repo: string;
    pullRequestNumber: number;
    headSha: string;
  }): boolean {
    return this.reviewedPullRequests.has(prReviewKey(args));
  }

  recordPullRequestReview(args: {
    installationId: number;
    repo: string;
    pullRequestNumber: number;
    headSha: string;
  }): void {
    this.reviewedPullRequests.add(prReviewKey(args));
  }
}

export class SqliteAppStateStore implements AppStateStore {
  constructor(private readonly db: DatabaseHandle) {
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_deliveries (
        delivery_id TEXT PRIMARY KEY,
        processed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_jobs (
        id TEXT PRIMARY KEY,
        delivery_id TEXT NOT NULL UNIQUE,
        event_name TEXT NOT NULL,
        repo TEXT,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS app_runs (
        id TEXT PRIMARY KEY,
        installation_id INTEGER NOT NULL,
        repo TEXT NOT NULL,
        product_slug TEXT NOT NULL,
        trigger TEXT NOT NULL,
        event_name TEXT NOT NULL,
        delivery_id TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS app_decisions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        repo TEXT NOT NULL,
        issue_number INTEGER,
        decision_type TEXT NOT NULL,
        confidence TEXT,
        marker TEXT,
        policy_allowed INTEGER NOT NULL,
        policy_reasons_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_investigations (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        run_id TEXT,
        delivery_id TEXT,
        repo TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_number INTEGER NOT NULL,
        status TEXT NOT NULL,
        suppression_reason TEXT,
        publication_status TEXT,
        generated_body TEXT,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_app_investigations_run_id ON app_investigations(run_id);
      CREATE INDEX IF NOT EXISTS idx_app_investigations_subject ON app_investigations(repo, subject_type, subject_number);
      CREATE TABLE IF NOT EXISTS app_investigation_locks (
        lock_key TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_bot_comments (
        installation_id INTEGER NOT NULL,
        repo TEXT NOT NULL,
        issue_number INTEGER NOT NULL,
        marker TEXT NOT NULL,
        comment_id INTEGER NOT NULL,
        body_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (installation_id, repo, issue_number, marker)
      );
      CREATE TABLE IF NOT EXISTS app_cooldowns (
        installation_id INTEGER NOT NULL,
        repo TEXT NOT NULL,
        issue_number INTEGER NOT NULL,
        marker TEXT NOT NULL,
        until TEXT NOT NULL,
        PRIMARY KEY (installation_id, repo, issue_number, marker)
      );
      CREATE TABLE IF NOT EXISTS app_pr_reviews (
        installation_id INTEGER NOT NULL,
        repo TEXT NOT NULL,
        pull_request_number INTEGER NOT NULL,
        head_sha TEXT NOT NULL,
        review_id INTEGER,
        reviewed_at TEXT NOT NULL,
        PRIMARY KEY (installation_id, repo, pull_request_number, head_sha)
      );
    `);
  }

  hasProcessedDelivery(deliveryId: string): boolean {
    return (
      this.db.prepare('SELECT delivery_id FROM app_deliveries WHERE delivery_id = ?').get(deliveryId) !== undefined
    );
  }

  recordDelivery(deliveryId: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO app_deliveries (delivery_id, processed_at) VALUES (?, ?)')
      .run(deliveryId, nowIso());
  }

  enqueueJob(args: EnqueueJobArgs): AppJobRecord {
    const existing = this.db.prepare('SELECT * FROM app_jobs WHERE delivery_id = ?').get(args.deliveryId) as
      | Record<string, unknown>
      | undefined;
    if (existing) return jobFromRow(existing);
    const record: AppJobRecord = {
      id: newId('app_job'),
      deliveryId: args.deliveryId,
      eventName: args.eventName,
      repo: args.repo ?? null,
      status: 'queued',
      payloadJson: args.payloadJson,
      createdAt: nowIso(),
      startedAt: null,
      completedAt: null,
      error: null,
    };
    this.db
      .prepare(
        'INSERT INTO app_jobs (id, delivery_id, event_name, repo, status, payload_json, created_at, started_at, completed_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        record.id,
        record.deliveryId,
        record.eventName,
        record.repo,
        record.status,
        record.payloadJson,
        record.createdAt,
        record.startedAt,
        record.completedAt,
        record.error,
      );
    return record;
  }

  startJob(jobId: string): void {
    this.db.prepare('UPDATE app_jobs SET status = ?, started_at = ? WHERE id = ?').run('processing', nowIso(), jobId);
  }

  completeJob(jobId: string, status: 'completed' | 'failed' | 'skipped', error: string | null = null): void {
    this.db
      .prepare('UPDATE app_jobs SET status = ?, completed_at = ?, error = ? WHERE id = ?')
      .run(status, nowIso(), error, jobId);
  }

  startRun(args: StartRunArgs): AppRunRecord {
    const record: AppRunRecord = {
      id: newId('app_run'),
      installationId: args.installationId,
      repo: args.repo,
      productSlug: args.productSlug,
      trigger: args.trigger,
      eventName: args.eventName,
      deliveryId: args.deliveryId ?? null,
      status: 'started',
      startedAt: nowIso(),
      completedAt: null,
      error: null,
    };
    this.db
      .prepare(
        `
      INSERT INTO app_runs (id, installation_id, repo, product_slug, trigger, event_name, delivery_id, status, started_at, completed_at, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        record.id,
        record.installationId,
        record.repo,
        record.productSlug,
        record.trigger,
        record.eventName,
        record.deliveryId,
        record.status,
        record.startedAt,
        record.completedAt,
        record.error,
      );
    return record;
  }

  completeRun(runId: string, status: 'completed' | 'failed' | 'skipped', error: string | null = null): void {
    this.db
      .prepare('UPDATE app_runs SET status = ?, completed_at = ?, error = ? WHERE id = ?')
      .run(status, nowIso(), error, runId);
  }

  recordDecision(args: RecordDecisionArgs): DecisionRecord {
    const record: DecisionRecord = {
      id: newId('decision'),
      runId: args.runId,
      repo: args.repo,
      issueNumber: args.issueNumber ?? null,
      decisionType: args.decisionType,
      confidence: args.confidence ?? null,
      marker: args.marker ?? null,
      policyAllowed: args.policyAllowed,
      policyReasons: [...args.policyReasons],
      createdAt: nowIso(),
    };
    this.db
      .prepare(
        `
      INSERT INTO app_decisions (id, run_id, repo, issue_number, decision_type, confidence, marker, policy_allowed, policy_reasons_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        record.id,
        record.runId,
        record.repo,
        record.issueNumber,
        record.decisionType,
        record.confidence,
        record.marker,
        record.policyAllowed ? 1 : 0,
        JSON.stringify(record.policyReasons),
        record.createdAt,
      );
    return record;
  }

  listDecisions(runId?: string): DecisionRecord[] {
    const rows = (
      runId
        ? this.db.prepare('SELECT * FROM app_decisions WHERE run_id = ? ORDER BY created_at ASC').all(runId)
        : this.db.prepare('SELECT * FROM app_decisions ORDER BY created_at ASC').all()
    ) as Array<Record<string, unknown>>;
    return rows.map(decisionFromRow);
  }

  recordInvestigationArtifact(args: RecordInvestigationArtifactArgs): AppInvestigationArtifactRecord {
    const now = nowIso();
    const record: AppInvestigationArtifactRecord = {
      id: newId('app_inv'),
      jobId: args.jobId ?? null,
      runId: args.runId ?? null,
      deliveryId: args.deliveryId ?? null,
      repo: args.repo,
      subjectType: args.subjectType,
      subjectNumber: args.subjectNumber,
      status: args.status,
      suppressionReason: args.suppressionReason ?? null,
      publicationStatus: args.publicationStatus ?? null,
      generatedBody: args.generatedBody ?? null,
      details: args.details,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `
      INSERT INTO app_investigations (id, job_id, run_id, delivery_id, repo, subject_type, subject_number, status, suppression_reason, publication_status, generated_body, details_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        record.id,
        record.jobId,
        record.runId,
        record.deliveryId,
        record.repo,
        record.subjectType,
        record.subjectNumber,
        record.status,
        record.suppressionReason,
        record.publicationStatus,
        record.generatedBody,
        JSON.stringify(record.details),
        record.createdAt,
        record.updatedAt,
      );
    return record;
  }

  updateInvestigationPublication(id: string, status: AppPublicationStatus): void {
    this.db
      .prepare('UPDATE app_investigations SET publication_status = ?, updated_at = ? WHERE id = ?')
      .run(status, nowIso(), id);
  }

  listInvestigationArtifacts(runId?: string): AppInvestigationArtifactRecord[] {
    const rows = (
      runId
        ? this.db.prepare('SELECT * FROM app_investigations WHERE run_id = ? ORDER BY created_at ASC').all(runId)
        : this.db.prepare('SELECT * FROM app_investigations ORDER BY created_at ASC').all()
    ) as Array<Record<string, unknown>>;
    return rows.map(investigationArtifactFromRow);
  }

  acquireInvestigationLock(args: InvestigationLockArgs): boolean {
    const now = args.now ?? new Date();
    this.db.prepare('DELETE FROM app_investigation_locks WHERE expires_at <= ?').run(now.toISOString());
    const expiresAt = new Date(now.getTime() + (args.ttlSeconds ?? 1800) * 1000).toISOString();
    this.db
      .prepare(
        'INSERT OR IGNORE INTO app_investigation_locks (lock_key, owner, acquired_at, expires_at) VALUES (?, ?, ?, ?)',
      )
      .run(args.key, args.owner, now.toISOString(), expiresAt);
    const row = this.db.prepare('SELECT owner FROM app_investigation_locks WHERE lock_key = ?').get(args.key) as
      | { owner?: string }
      | undefined;
    return row?.owner === args.owner;
  }

  releaseInvestigationLock(key: string, owner: string): void {
    this.db.prepare('DELETE FROM app_investigation_locks WHERE lock_key = ? AND owner = ?').run(key, owner);
  }

  upsertBotComment(record: BotCommentRecord): void {
    this.db
      .prepare(
        `
      INSERT INTO app_bot_comments (installation_id, repo, issue_number, marker, comment_id, body_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(installation_id, repo, issue_number, marker) DO UPDATE SET
        comment_id = excluded.comment_id,
        body_hash = excluded.body_hash,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        record.installationId,
        record.repo,
        record.issueNumber,
        record.marker,
        record.commentId,
        record.bodyHash,
        record.createdAt,
        record.updatedAt,
      );
  }

  findBotComment(args: {
    installationId: number;
    repo: string;
    issueNumber: number;
    marker: BotMarkerType;
  }): BotCommentRecord | null {
    const row = this.db
      .prepare(
        'SELECT * FROM app_bot_comments WHERE installation_id = ? AND repo = ? AND issue_number = ? AND marker = ?',
      )
      .get(args.installationId, args.repo, args.issueNumber, args.marker) as Record<string, unknown> | undefined;
    return row ? botCommentFromRow(row) : null;
  }

  setCooldown(record: CooldownRecord): void {
    this.db
      .prepare(
        `
      INSERT INTO app_cooldowns (installation_id, repo, issue_number, marker, until)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(installation_id, repo, issue_number, marker) DO UPDATE SET until = excluded.until
    `,
      )
      .run(record.installationId, record.repo, record.issueNumber, record.marker, record.until);
  }

  isCooldownActive(args: {
    installationId: number;
    repo: string;
    issueNumber: number;
    marker: BotMarkerType;
    now?: Date;
  }): boolean {
    const row = this.db
      .prepare(
        'SELECT until FROM app_cooldowns WHERE installation_id = ? AND repo = ? AND issue_number = ? AND marker = ?',
      )
      .get(args.installationId, args.repo, args.issueNumber, args.marker) as { until?: string } | undefined;
    return Boolean(row?.until && new Date(row.until).getTime() > (args.now ?? new Date()).getTime());
  }

  hasReviewedPullRequest(args: {
    installationId: number;
    repo: string;
    pullRequestNumber: number;
    headSha: string;
  }): boolean {
    return (
      this.db
        .prepare(
          'SELECT head_sha FROM app_pr_reviews WHERE installation_id = ? AND repo = ? AND pull_request_number = ? AND head_sha = ?',
        )
        .get(args.installationId, args.repo, args.pullRequestNumber, args.headSha) !== undefined
    );
  }

  recordPullRequestReview(args: {
    installationId: number;
    repo: string;
    pullRequestNumber: number;
    headSha: string;
    reviewId?: number | null;
  }): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO app_pr_reviews (installation_id, repo, pull_request_number, head_sha, review_id, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(args.installationId, args.repo, args.pullRequestNumber, args.headSha, args.reviewId ?? null, nowIso());
  }
}

export function bodyHash(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

function botCommentKey(args: {
  installationId: number;
  repo: string;
  issueNumber: number;
  marker: BotMarkerType;
}): string {
  return `${args.installationId}:${args.repo}:${args.issueNumber}:${args.marker}`;
}

function cooldownKey(args: {
  installationId: number;
  repo: string;
  issueNumber: number;
  marker: BotMarkerType;
}): string {
  return `${args.installationId}:${args.repo}:${args.issueNumber}:${args.marker}`;
}

function prReviewKey(args: {
  installationId: number;
  repo: string;
  pullRequestNumber: number;
  headSha: string;
}): string {
  return `${args.installationId}:${args.repo}:${args.pullRequestNumber}:${args.headSha}`;
}

function jobFromRow(row: Record<string, unknown>): AppJobRecord {
  return {
    id: String(row.id),
    deliveryId: String(row.delivery_id),
    eventName: String(row.event_name),
    repo: row.repo === null ? null : String(row.repo),
    status: row.status as AppJobRecord['status'],
    payloadJson: String(row.payload_json),
    createdAt: String(row.created_at),
    startedAt: row.started_at === null ? null : String(row.started_at),
    completedAt: row.completed_at === null ? null : String(row.completed_at),
    error: row.error === null ? null : String(row.error),
  };
}

function decisionFromRow(row: Record<string, unknown>): DecisionRecord {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    repo: String(row.repo),
    issueNumber: row.issue_number === null ? null : Number(row.issue_number),
    decisionType: row.decision_type as DecisionRecord['decisionType'],
    confidence: row.confidence === null ? null : (row.confidence as DecisionRecord['confidence']),
    marker: row.marker === null ? null : (row.marker as BotMarkerType),
    policyAllowed: Number(row.policy_allowed) === 1,
    policyReasons: typeof row.policy_reasons_json === 'string' ? (JSON.parse(row.policy_reasons_json) as string[]) : [],
    createdAt: String(row.created_at),
  };
}

function investigationArtifactFromRow(row: Record<string, unknown>): AppInvestigationArtifactRecord {
  return {
    id: String(row.id),
    jobId: row.job_id === null ? null : String(row.job_id),
    runId: row.run_id === null ? null : String(row.run_id),
    deliveryId: row.delivery_id === null ? null : String(row.delivery_id),
    repo: String(row.repo),
    subjectType: row.subject_type as AppInvestigationArtifactRecord['subjectType'],
    subjectNumber: Number(row.subject_number),
    status: row.status as AppInvestigationArtifactRecord['status'],
    suppressionReason: row.suppression_reason === null ? null : String(row.suppression_reason),
    publicationStatus: row.publication_status === null ? null : (row.publication_status as AppPublicationStatus),
    generatedBody: row.generated_body === null ? null : String(row.generated_body),
    details: typeof row.details_json === 'string' ? (JSON.parse(row.details_json) as Record<string, unknown>) : {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function botCommentFromRow(row: Record<string, unknown>): BotCommentRecord {
  return {
    installationId: Number(row.installation_id),
    repo: String(row.repo),
    issueNumber: Number(row.issue_number),
    marker: row.marker as BotMarkerType,
    commentId: Number(row.comment_id),
    bodyHash: String(row.body_hash),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
