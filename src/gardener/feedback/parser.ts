import type { FeedbackRecord, FeedbackVerdict, FindingLifecycleStatus } from '../domain.js';
import { newId, nowIso } from '../ids.js';

const START_RE = /<!--\s*gardener-feedback:start\s+finding_id=([^\s]+)\s*-->/g;
const END_RE = /<!--\s*gardener-feedback:end\s*-->/;

export interface ParsedFeedbackBlock {
  findingId: string;
  verdict: FeedbackVerdict;
  reasons: string[];
  status: FindingLifecycleStatus;
  reviewer: string | null;
  note: string | null;
}

function readField(body: string, name: string): string | null {
  const match = new RegExp(`^${name}:\\s*(.+)$`, 'im').exec(body);
  const raw = match?.[1]?.trim() ?? null;
  if (!raw || raw.startsWith('#')) return null;
  return raw;
}

function readReasons(body: string): string[] {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => /^Reasons:\s*$/i.test(line.trim()));
  if (start < 0) return [];
  const reasons: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (!trimmed.startsWith('- ')) break;
    reasons.push(trimmed.slice(2).trim());
  }
  return reasons.filter(Boolean);
}

function readNotes(body: string): string | null {
  const match = /^Notes:\s*\n([\s\S]*)$/im.exec(body);
  const note = match?.[1]?.trim() ?? '';
  return note.length > 0 ? note : null;
}

export function parseFeedbackBlocks(markdown: string): ParsedFeedbackBlock[] {
  const blocks: ParsedFeedbackBlock[] = [];
  START_RE.lastIndex = 0;
  let start = START_RE.exec(markdown);
  while (start !== null) {
    const findingId = start[1];
    const rest = markdown.slice(start.index + start[0].length);
    const end = END_RE.exec(rest);
    if (!end || !findingId) break;
    const body = rest.slice(0, end.index);
    const verdict = readField(body, 'Verdict') as FeedbackVerdict | null;
    const status = readField(body, 'Status') as FindingLifecycleStatus | null;
    if (verdict && status) {
      blocks.push({
        findingId,
        verdict,
        reasons: readReasons(body),
        status,
        reviewer: readField(body, 'Reviewer'),
        note: readNotes(body),
      });
    }
    START_RE.lastIndex = start.index + start[0].length + end.index + end[0].length;
    start = START_RE.exec(markdown);
  }
  return blocks;
}

export function toFeedbackRecord(block: ParsedFeedbackBlock, defaultReviewer: string | null): FeedbackRecord {
  const now = nowIso();
  return {
    id: newId('fbk'),
    findingId: block.findingId,
    verdict: block.verdict,
    reasons: block.reasons,
    status: block.status,
    note: block.note,
    reviewer: block.reviewer ?? defaultReviewer,
    createdAt: now,
    updatedAt: now,
  };
}
