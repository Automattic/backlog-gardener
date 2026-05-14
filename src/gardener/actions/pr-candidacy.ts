import type { ActionPlanningEntry } from './plan.js';

export interface DraftPrCandidacy {
  eligible: boolean;
  score: number;
  positiveSignals: string[];
  negativeSignals: string[];
  categories: string[];
  reason: string;
}

const LOW_RISK_PATTERNS: Array<[RegExp, string]> = [
  [
    /\b(ui|ux|frontend|visual|polish|style|css|scss|layout|responsive|mobile|placeholder|clipped|skeleton|loading|alignment|centered|icon)\b/i,
    'ui-polish',
  ],
  [/\b(copy|text|label|wording|typo|message)\b/i, 'copy-text'],
  [/\b(phpcs|lint|eslint|test-only|tests? only|reserved keyword)\b/i, 'lint-or-test'],
];

const HIGH_RISK_PATTERNS: Array<[RegExp, string]> = [
  [/\b(capital loan|loan repayment|repayment|paid off loan)\b/i, 'capital-loans'],
  [/\b(manual deposit|instant deposit|payout|fee values?|deposit object)\b/i, 'deposits-money-movement'],
  [
    /\b(multi-currency|currency switcher|rounding|order total|amount precision|zero-decimal|0-decimal)\b/i,
    'money-display-correctness',
  ],
  [/\b(subscription|renewal|billing|invoice)\b/i, 'subscriptions-billing'],
  [/\b(refund|capture|authorization|dispute|fraud|risk|security)\b/i, 'payments-risk'],
  [/\b(api contract|schema|migration|server api|endpoint contract)\b/i, 'api-or-migration'],
];

const AMBIGUOUS_PATTERNS =
  /\b(unclear|ambiguous|depends on|questioned whether|not robust|needs product|product decision)\b/i;
const REPRO_PATTERNS =
  /\b(repro|steps? to reproduce|expected|actual|screenshot|go to|navigate|mobile|browser tools|viewing|observed)\b/i;

function combinedText(entry: ActionPlanningEntry): string {
  return [
    entry.item?.title,
    entry.item?.body,
    entry.finding.recap.summary,
    entry.finding.recap.bestSolution,
    entry.finding.recap.reason,
    entry.evaluation?.developerSummary,
    entry.evaluation?.recommendedNextStep,
    entry.evaluation?.reason,
    entry.verification?.subsystem,
    entry.verification?.developerNotes,
    ...(entry.finding.recap.evidence ?? []).flatMap((evidence) => [
      evidence.label,
      evidence.detail,
      evidence.quote ?? '',
    ]),
  ]
    .filter(Boolean)
    .join('\n');
}

function isConcreteLikelyFile(file: string, allowTestOnly: boolean): boolean {
  const normalized = file.toLowerCase();
  if (
    normalized.includes('no relevant') ||
    normalized.includes('unknown') ||
    normalized.includes('not included') ||
    normalized.includes('provided snippets') ||
    normalized.includes('search ') ||
    normalized.includes('starting point')
  )
    return false;
  const candidate = file.split(/[\s,—]+/)[0] ?? '';
  const lowerCandidate = candidate.toLowerCase();
  if (lowerCandidate.startsWith('docs/') || lowerCandidate.endsWith('readme.md')) return false;
  if (!allowTestOnly && lowerCandidate.startsWith('tests/')) return false;
  return /^[A-Za-z0-9_./*{}-]+$/.test(candidate) && (candidate.includes('/') || candidate.includes('.'));
}

function hasLikelyFiles(entry: ActionPlanningEntry, text: string): boolean {
  const allowTestOnly = /\b(phpcs|lint|eslint|test-only|tests? only|reserved keyword)\b/i.test(text);
  const files = entry.verification?.likelyFiles ?? [];
  return files.some((file) => isConcreteLikelyFile(file, allowTestOnly));
}

function hasClearTestPath(entry: ActionPlanningEntry): boolean {
  return (entry.verification?.suggestedTests ?? []).some((test) => {
    const normalized = test.toLowerCase();
    return !normalized.includes('once the affected subsystem is identified') && !normalized.includes('once identified');
  });
}

function matchingCategories(text: string, patterns: Array<[RegExp, string]>): string[] {
  return patterns.filter(([pattern]) => pattern.test(text)).map(([, category]) => category);
}

function ineligible(reason: string, negativeSignals: string[] = []): DraftPrCandidacy {
  return {
    eligible: false,
    score: 0,
    positiveSignals: [],
    negativeSignals: [reason, ...negativeSignals],
    categories: [],
    reason,
  };
}

export function scoreDraftPrCandidacy(entry: ActionPlanningEntry): DraftPrCandidacy {
  const { finding, item, evaluation, verification } = entry;
  if (finding.decision.finalDecision !== 'surface') return ineligible('finding-not-surfaced');
  if (finding.lifecycleStatus === 'dismissed' || finding.lifecycleStatus === 'snoozed')
    return ineligible(`finding-${finding.lifecycleStatus}`);
  if (finding.attentionFacts.protectedLabel.present) return ineligible('protected-label');
  if (finding.attentionFacts.linkedOpenPr.present) return ineligible('linked-open-pr');
  if (finding.attentionFacts.maintainerActivity.status === 'active') return ineligible('active-maintainer');
  if (evaluation && evaluation.action !== 'accept_for_developer_attention')
    return ineligible(`evaluator-${evaluation.action}`);
  if (!item || item.sourceType !== 'github') return ineligible('not-existing-github-issue');

  const text = combinedText(entry);
  if (text.toLowerCase().includes('working on a fix')) return ineligible('active-work-claimed');
  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];
  const categories = new Set<string>();
  let score = 0;

  score += 1;
  positiveSignals.push('existing-github-issue');

  if (REPRO_PATTERNS.test(text)) {
    score += 2;
    positiveSignals.push('clear-reproduction');
  }

  if (hasLikelyFiles(entry, text)) {
    score += 2;
    positiveSignals.push('likely-files-identified');
  } else {
    score -= 2;
    negativeSignals.push('no-likely-files');
  }

  if (hasClearTestPath(entry)) {
    score += 2;
    positiveSignals.push('clear-test-path');
  }

  for (const category of matchingCategories(text, LOW_RISK_PATTERNS)) {
    categories.add(category);
  }
  if (categories.size > 0) {
    score += 2;
    positiveSignals.push('low-risk-category');
  }

  if (verification?.confidence === 'medium' || verification?.confidence === 'high') {
    score += 1;
    positiveSignals.push('verifier-confidence');
  }

  const highRiskCategories = matchingCategories(text, HIGH_RISK_PATTERNS);
  for (const category of highRiskCategories) categories.add(category);
  if (highRiskCategories.length > 0) {
    score -= 3;
    negativeSignals.push(`high-risk:${highRiskCategories.join(',')}`);
  }

  if (verification?.action === 'needs_code_context') {
    score -= 2;
    negativeSignals.push('needs-code-context');
  }

  if (AMBIGUOUS_PATTERNS.test(text)) {
    score -= 3;
    negativeSignals.push('ambiguous-expected-behavior');
  }

  const eligible = score >= 7 && highRiskCategories.length === 0 && hasLikelyFiles(entry, text);
  return {
    eligible,
    score,
    positiveSignals,
    negativeSignals,
    categories: [...categories],
    reason: eligible
      ? `Draft PR candidate score ${score}: ${positiveSignals.join(', ')}.`
      : `Not a draft PR candidate; score ${score}${negativeSignals.length ? ` (${negativeSignals.join(', ')})` : ''}.`,
  };
}
