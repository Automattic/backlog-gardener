import { readFileSync } from 'node:fs';

import type { FeedbackVerdict, FindingLifecycleStatus } from '../domain.js';
import { RepositoryBundle, StoreDb } from '../store/index.js';
import { parseFeedbackBlocks, toFeedbackRecord } from './parser.js';

export interface MarkFeedbackArgs {
  statePath: string;
  findingId: string;
  verdict: FeedbackVerdict;
  reasons: string[];
  status: FindingLifecycleStatus;
  note: string | null;
  reviewer: string | null;
}

export function markFeedback(args: MarkFeedbackArgs): string {
  const db = new StoreDb(args.statePath);
  try {
    db.migrate();
    const repos = new RepositoryBundle(db.db);
    if (!repos.findings.get(args.findingId)) {
      throw new Error(`Unknown finding id: ${args.findingId}`);
    }
    const record = repos.feedback.upsert({
      findingId: args.findingId,
      verdict: args.verdict,
      reasons: args.reasons,
      status: args.status,
      note: args.note,
      reviewer: args.reviewer,
    });
    return `Recorded feedback ${record.id} for ${record.findingId}.\n`;
  } finally {
    db.close();
  }
}

export function importFeedback(args: { statePath: string; path: string; reviewer: string | null }): string {
  const markdown = readFileSync(args.path, 'utf8');
  const blocks = parseFeedbackBlocks(markdown);
  const db = new StoreDb(args.statePath);
  try {
    db.migrate();
    const repos = new RepositoryBundle(db.db);
    let imported = 0;
    for (const block of blocks) {
      if (!repos.findings.get(block.findingId)) continue;
      repos.feedback.upsert(toFeedbackRecord(block, args.reviewer));
      imported += 1;
    }
    return `Imported ${imported} feedback block(s).\n`;
  } finally {
    db.close();
  }
}
