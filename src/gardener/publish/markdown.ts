import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Finding, Recap } from '../domain.js';

function escapeMd(text: string): string {
  return text.replace(/<!--/g, '&lt;!--');
}

export function shortTitleForRecap(recap: Recap): string {
  const fromRecap = recap.shortTitle?.trim();
  if (fromRecap) return fromRecap;
  const summary = (recap.summary ?? '').trim();
  if (summary.length === 0) return 'Untitled';
  const firstSentence = (summary.split(/[.!?](\s|$)/)[0] ?? '').trim().replace(/[.!?]+$/, '');
  if (firstSentence.length === 0) return 'Untitled';
  return firstSentence.length <= 80 ? firstSentence : `${firstSentence.slice(0, 79).trimEnd()}…`;
}

export function renderFindingMarkdown(finding: Finding): string {
  const shortTitle = shortTitleForRecap(finding.recap);
  const lines = [
    `# ${escapeMd(shortTitle)}`,
    '',
    `- Finding: \`${finding.id}\``,
    `- Decision: **${finding.decision.finalDecision}**`,
    `- Recap recommendation: ${finding.decision.recapDecision}`,
    `- Confidence: ${finding.recap.confidence}`,
    `- Novelty: ${finding.recap.novelty}`,
    finding.surfacingLabel ? `- Label: ${finding.surfacingLabel}` : null,
    '',
    '## Summary',
    '',
    escapeMd(finding.recap.summary),
    '',
    '## Why',
    '',
    escapeMd(finding.decision.surfacingReason),
    '',
    '## Evidence',
    '',
    ...finding.recap.evidence.map(
      (evidence) =>
        `- [${escapeMd(evidence.label)}](${evidence.sourceUrl}) — ${escapeMd(evidence.detail)}${
          evidence.quote ? `\n  > ${escapeMd(evidence.quote)}` : ''
        }`,
    ),
    '',
    '## Suggested next step',
    '',
    escapeMd(finding.recap.bestSolution || 'No next step supplied.'),
    '',
    `<!-- gardener-feedback:start finding_id=${finding.id} -->`,
    '## Human review',
    '',
    '> Fill in `Verdict` and `Status`, then:',
    '>',
    '>     pnpm gardener feedback import --state <state.db> --path <this-file>',
    '>',
    '> Or use `pnpm gardener review`.',
    '>',
    '> - **Verdict:** `useful` · `maybe-useful` · `not-useful`',
    '> - **Status:** `accepted` · `dismissed` · `snoozed` · `acted-on` · `superseded`',
    '',
    'Verdict: ',
    'Status: ',
    'Reasons:',
    '- ',
    'Reviewer: ',
    'Notes:',
    '',
    '<!-- gardener-feedback:end -->',
    '',
  ].filter((line): line is string => line !== null);
  return lines.join('\n');
}

export function renderDigest(args: { runId: string; productName: string; findings: Finding[] }): string {
  const surfaced = args.findings.filter((finding) => finding.decision.finalDecision === 'surface');
  const deferred = args.findings.filter((finding) => finding.decision.finalDecision === 'defer');
  const lines = [
    `# Backlog Gardener digest — ${args.productName}`,
    '',
    `Run: \`${args.runId}\``,
    '',
    `- Surfaced: **${surfaced.length}**`,
    `- Deferred: **${deferred.length}**`,
    `- Needs info: **${args.findings.filter((f) => f.decision.finalDecision === 'needs-info').length}**`,
    '',
    '## Surfaced findings',
    '',
    ...surfaced.map(
      (finding) => `- [${escapeMd(shortTitleForRecap(finding.recap))}](${finding.id}.md) — ${finding.recap.confidence}`,
    ),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export function writeMarkdownOutput(args: {
  outputDir: string;
  runId: string;
  productName: string;
  findings: Finding[];
}): { digestPath: string; findingPaths: string[] } {
  mkdirSync(args.outputDir, { recursive: true });
  const findingPaths: string[] = [];
  for (const finding of args.findings.filter((f) => f.decision.finalDecision === 'surface')) {
    const path = join(args.outputDir, `${finding.id}.md`);
    writeFileSync(path, renderFindingMarkdown(finding));
    findingPaths.push(path);
  }
  const digestPath = join(args.outputDir, 'digest.md');
  writeFileSync(digestPath, renderDigest(args));
  return { digestPath, findingPaths };
}
