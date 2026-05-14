import { describe, expect, it } from 'vitest';

import { parseFeedbackBlocks, toFeedbackRecord } from '../../src/gardener/feedback/parser.js';

describe('feedback markdown parser', () => {
  it('parses importable feedback blocks', () => {
    const blocks = parseFeedbackBlocks(`
<!-- gardener-feedback:start finding_id=fnd_123 -->
## Human review

Verdict: useful
Reasons:
- good-candidate
- good-evidence
Status: accepted
Reviewer: dev@example.com
Notes:
Worth investigating.
<!-- gardener-feedback:end -->
`);

    expect(blocks).toEqual([
      {
        findingId: 'fnd_123',
        verdict: 'useful',
        reasons: ['good-candidate', 'good-evidence'],
        status: 'accepted',
        reviewer: 'dev@example.com',
        note: 'Worth investigating.',
      },
    ]);
  });

  it('converts parsed blocks to feedback records with default reviewer fallback', () => {
    const block = parseFeedbackBlocks(`
<!-- gardener-feedback:start finding_id=fnd_123 -->
Verdict: not-useful
Reasons:
- already-known
Status: dismissed
Notes:
No longer needed.
<!-- gardener-feedback:end -->
`)[0];

    expect(block).toBeDefined();
    const record = toFeedbackRecord(block!, 'fallback@example.com');

    expect(record.id).toMatch(/^fbk_/);
    expect(record.reviewer).toBe('fallback@example.com');
    expect(record.status).toBe('dismissed');
  });

  it('skips blocks where Verdict or Status still hold a "#" placeholder hint', () => {
    const blocks = parseFeedbackBlocks(`
<!-- gardener-feedback:start finding_id=fnd_placeholder -->
Verdict: # one of: useful | maybe-useful | not-useful
Status: # one of: accepted | dismissed | snoozed | acted-on | superseded
Reasons:
-
<!-- gardener-feedback:end -->
`);

    expect(blocks).toEqual([]);
  });
});
