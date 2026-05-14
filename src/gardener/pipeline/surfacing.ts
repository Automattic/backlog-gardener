import type { AttentionFacts, FindingDecision, Recap, SurfacingLabel } from '../domain.js';

export interface DecideFindingInput {
  recap: Recap;
  attentionFacts: AttentionFacts;
  minConfidence: 'medium' | 'high';
  minRecurrence: number;
  recurrenceCount: number;
}

const CONFIDENCE_RANK = { low: 1, medium: 2, high: 3 } as const;

export function computeSurfacingLabel(recap: Recap): SurfacingLabel {
  if (recap.confidence === 'high' && /fix|patch|code|implement/i.test(recap.bestSolution)) {
    return 'developer-ready';
  }
  return 'worth-investigating';
}

export function decideFinding(input: DecideFindingInput): FindingDecision {
  const gates: string[] = [];
  const facts = input.attentionFacts;
  if (facts.protectedLabel.present) gates.push(`protected-label:${facts.protectedLabel.labels.join(',')}`);
  if (facts.linkedOpenPr.present) gates.push('linked-open-pr');
  if (facts.maintainerActivity.status === 'active') gates.push('active-maintainer-engagement');
  if (facts.dismissedOrSnoozed.present && facts.dismissedOrSnoozed.reason) {
    gates.push(facts.dismissedOrSnoozed.reason);
  }

  if (gates.length > 0) {
    return {
      finalDecision: 'defer',
      recapDecision: input.recap.decision,
      gateReasons: gates,
      surfacingReason: `Deferred by deterministic gate: ${gates.join(', ')}.`,
    };
  }

  if (input.recap.decision !== 'surface') {
    return {
      finalDecision: input.recap.decision,
      recapDecision: input.recap.decision,
      gateReasons: [],
      surfacingReason: input.recap.reason,
    };
  }

  const minRank = CONFIDENCE_RANK[input.minConfidence];
  if (CONFIDENCE_RANK[input.recap.confidence] < minRank) {
    return {
      finalDecision: 'defer',
      recapDecision: input.recap.decision,
      gateReasons: ['confidence-below-threshold'],
      surfacingReason: `Deferred because confidence ${input.recap.confidence} is below ${input.minConfidence}.`,
    };
  }

  if (input.recurrenceCount < input.minRecurrence) {
    return {
      finalDecision: 'defer',
      recapDecision: input.recap.decision,
      gateReasons: ['recurrence-below-threshold'],
      surfacingReason: `Deferred because recurrence ${input.recurrenceCount} is below ${input.minRecurrence}.`,
    };
  }

  return {
    finalDecision: 'surface',
    recapDecision: input.recap.decision,
    gateReasons: [],
    surfacingReason: input.recap.reason || 'Meets surfacing criteria and no hard gates fired.',
  };
}
