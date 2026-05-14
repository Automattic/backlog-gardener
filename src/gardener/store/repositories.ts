import type { FeedbackRecord, Finding, Item, Reply, Snapshot } from '../domain.js';
import type { DatabaseHandle } from './db.js';
import { newId, nowIso } from '../ids.js';

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  return JSON.parse(value) as T;
}

type Row = Record<string, unknown>;

function itemFromRow(row: Row): Item {
  return {
    id: String(row.id),
    sourceKey: String(row.source_key),
    sourceType: row.source_type as Item['sourceType'],
    sourceId: String(row.source_id),
    url: String(row.url),
    title: String(row.title),
    body: String(row.body),
    author: row.author === null ? null : String(row.author),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    bodyHash: String(row.body_hash),
    latestSnapshotHash: row.latest_snapshot_hash === null ? null : String(row.latest_snapshot_hash),
    referenceOnly: Number(row.reference_only) === 1,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    raw: parseJson<unknown>(row.raw_json, null),
  };
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

export class ItemRepository {
  constructor(private readonly db: DatabaseHandle) {}

  upsert(item: Omit<Item, 'id'> & { id?: string }): Item {
    const existing = this.findBySource(item.sourceKey, item.sourceId);
    const id = existing?.id ?? item.id ?? newId('itm');
    this.db
      .prepare(
        `
        INSERT INTO items (
          id, source_key, source_type, source_id, url, title, body, author, created_at, updated_at,
          body_hash, latest_snapshot_hash, reference_only, metadata_json, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_key, source_id) DO UPDATE SET
          source_type = excluded.source_type,
          url = excluded.url,
          title = excluded.title,
          body = excluded.body,
          author = excluded.author,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          body_hash = excluded.body_hash,
          latest_snapshot_hash = excluded.latest_snapshot_hash,
          reference_only = excluded.reference_only,
          metadata_json = excluded.metadata_json,
          raw_json = excluded.raw_json
      `,
      )
      .run(
        id,
        item.sourceKey,
        item.sourceType,
        item.sourceId,
        item.url,
        item.title,
        item.body,
        item.author,
        item.createdAt,
        item.updatedAt,
        item.bodyHash,
        item.latestSnapshotHash,
        item.referenceOnly ? 1 : 0,
        json(item.metadata),
        json(item.raw),
      );
    const saved = this.findBySource(item.sourceKey, item.sourceId);
    if (!saved) throw new Error('item upsert failed');
    return saved;
  }

  findBySource(sourceKey: string, sourceId: string): Item | null {
    const row = this.db
      .prepare('SELECT * FROM items WHERE source_key = ? AND source_id = ?')
      .get(sourceKey, sourceId) as Row | undefined;
    return row ? itemFromRow(row) : null;
  }

  get(id: string): Item | null {
    const row = this.db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Row | undefined;
    return row ? itemFromRow(row) : null;
  }

  list(limit = 100): Item[] {
    return (this.db.prepare('SELECT * FROM items ORDER BY updated_at DESC LIMIT ?').all(limit) as Row[]).map(
      itemFromRow,
    );
  }
}

export class ReplyRepository {
  constructor(private readonly db: DatabaseHandle) {}

  upsert(reply: Omit<Reply, 'id'> & { id?: string }): Reply {
    const existing = this.findBySourceReply(reply.itemId, reply.sourceReplyId);
    const id = existing?.id ?? reply.id ?? newId('rpl');
    this.db
      .prepare(
        `
        INSERT INTO replies (
          id, item_id, source_reply_id, author, body, created_at, updated_at, body_hash, metadata_json, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id, source_reply_id) DO UPDATE SET
          author = excluded.author,
          body = excluded.body,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          body_hash = excluded.body_hash,
          metadata_json = excluded.metadata_json,
          raw_json = excluded.raw_json
      `,
      )
      .run(
        id,
        reply.itemId,
        reply.sourceReplyId,
        reply.author,
        reply.body,
        reply.createdAt,
        reply.updatedAt,
        reply.bodyHash,
        json(reply.metadata),
        json(reply.raw),
      );
    const saved = this.findBySourceReply(reply.itemId, reply.sourceReplyId);
    if (!saved) throw new Error('reply upsert failed');
    return saved;
  }

  findBySourceReply(itemId: string, sourceReplyId: string): Reply | null {
    const row = this.db
      .prepare('SELECT * FROM replies WHERE item_id = ? AND source_reply_id = ?')
      .get(itemId, sourceReplyId) as Row | undefined;
    return row ? this.fromRow(row) : null;
  }

  listForItem(itemId: string): Reply[] {
    return (
      this.db.prepare('SELECT * FROM replies WHERE item_id = ? ORDER BY created_at ASC').all(itemId) as Row[]
    ).map((row) => this.fromRow(row));
  }

  private fromRow(row: Row): Reply {
    return {
      id: String(row.id),
      itemId: String(row.item_id),
      sourceReplyId: String(row.source_reply_id),
      author: row.author === null ? null : String(row.author),
      body: String(row.body),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      bodyHash: String(row.body_hash),
      metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
      raw: parseJson<unknown>(row.raw_json, null),
    };
  }
}

export class SnapshotRepository {
  constructor(private readonly db: DatabaseHandle) {}

  insert(snapshot: Omit<Snapshot, 'id'> & { id?: string }): Snapshot {
    const id = snapshot.id ?? newId('snp');
    this.db
      .prepare(
        'INSERT OR IGNORE INTO snapshots (id, item_id, snapshot_hash, body_hash, taken_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, snapshot.itemId, snapshot.snapshotHash, snapshot.bodyHash, snapshot.takenAt);
    const row = this.db.prepare('SELECT * FROM snapshots WHERE snapshot_hash = ?').get(snapshot.snapshotHash) as
      | Row
      | undefined;
    if (!row) throw new Error('snapshot insert failed');
    return {
      id: String(row.id),
      itemId: String(row.item_id),
      snapshotHash: String(row.snapshot_hash),
      bodyHash: String(row.body_hash),
      takenAt: String(row.taken_at),
    };
  }
}

export class FindingRepository {
  constructor(private readonly db: DatabaseHandle) {}

  upsert(
    finding: Omit<Finding, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<Finding, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Finding {
    const id = finding.id ?? newId('fnd');
    const createdAt = finding.createdAt ?? nowIso();
    const updatedAt = nowIso();
    this.db
      .prepare(
        `
        INSERT INTO findings (
          id, target_kind, target_id, review_policy_hash, snapshot_hash, recap_json, attention_facts_json,
          decision_json, surfacing_label, lifecycle_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          snapshot_hash = excluded.snapshot_hash,
          recap_json = excluded.recap_json,
          attention_facts_json = excluded.attention_facts_json,
          decision_json = excluded.decision_json,
          surfacing_label = excluded.surfacing_label,
          lifecycle_status = excluded.lifecycle_status,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        id,
        finding.targetKind,
        finding.targetId,
        finding.reviewPolicyHash,
        finding.snapshotHash,
        json(finding.recap),
        json(finding.attentionFacts),
        json(finding.decision),
        finding.surfacingLabel,
        finding.lifecycleStatus,
        createdAt,
        updatedAt,
      );
    const saved = this.get(id);
    if (!saved) throw new Error('finding upsert failed');
    return saved;
  }

  get(id: string): Finding | null {
    const row = this.db.prepare('SELECT * FROM findings WHERE id = ?').get(id) as Row | undefined;
    return row ? findingFromRow(row) : null;
  }

  findLatestForTarget(targetKind: Finding['targetKind'], targetId: string): Finding | null {
    const row = this.db
      .prepare('SELECT * FROM findings WHERE target_kind = ? AND target_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(targetKind, targetId) as Row | undefined;
    return row ? findingFromRow(row) : null;
  }

  list(limit = 50): Finding[] {
    return (this.db.prepare('SELECT * FROM findings ORDER BY created_at DESC LIMIT ?').all(limit) as Row[]).map(
      findingFromRow,
    );
  }
}

export class FeedbackRepository {
  constructor(private readonly db: DatabaseHandle) {}

  upsert(
    record: Omit<FeedbackRecord, 'id' | 'createdAt' | 'updatedAt'> &
      Partial<Pick<FeedbackRecord, 'id' | 'createdAt' | 'updatedAt'>>,
  ): FeedbackRecord {
    const id = record.id ?? newId('fbk');
    const createdAt = record.createdAt ?? nowIso();
    const updatedAt = nowIso();
    this.db
      .prepare(
        `
        INSERT INTO feedback (id, finding_id, verdict, reasons_json, status, note, reviewer, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(finding_id, reviewer) DO UPDATE SET
          verdict = excluded.verdict,
          reasons_json = excluded.reasons_json,
          status = excluded.status,
          note = excluded.note,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        id,
        record.findingId,
        record.verdict,
        json(record.reasons),
        record.status,
        record.note,
        record.reviewer,
        createdAt,
        updatedAt,
      );
    const saved = this.find(record.findingId, record.reviewer);
    if (!saved) throw new Error('feedback upsert failed');
    return saved;
  }

  find(findingId: string, reviewer: string | null): FeedbackRecord | null {
    const row = this.db
      .prepare('SELECT * FROM feedback WHERE finding_id = ? AND reviewer IS ?')
      .get(findingId, reviewer) as Row | undefined;
    return row ? this.fromRow(row) : null;
  }

  listForFinding(findingId: string): FeedbackRecord[] {
    return (this.db.prepare('SELECT * FROM feedback WHERE finding_id = ?').all(findingId) as Row[]).map((row) =>
      this.fromRow(row),
    );
  }

  private fromRow(row: Row): FeedbackRecord {
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
}

export class RepositoryBundle {
  readonly items: ItemRepository;
  readonly replies: ReplyRepository;
  readonly snapshots: SnapshotRepository;
  readonly findings: FindingRepository;
  readonly feedback: FeedbackRepository;

  constructor(readonly db: DatabaseHandle) {
    this.items = new ItemRepository(db);
    this.replies = new ReplyRepository(db);
    this.snapshots = new SnapshotRepository(db);
    this.findings = new FindingRepository(db);
    this.feedback = new FeedbackRepository(db);
  }
}
