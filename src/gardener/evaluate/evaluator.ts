import type { Finding, Item } from '../domain.js';
import { loadPromptSchema } from '../llm/prompts.js';
import type { CompletionProvider } from '../llm/provider.js';
import type { EvaluationDecision } from './types.js';

function formatFinding(finding: Finding): string {
  return JSON.stringify(
    {
      id: finding.id,
      finalDecision: finding.decision.finalDecision,
      gateReasons: finding.decision.gateReasons,
      summary: finding.recap.summary,
      confidence: finding.recap.confidence,
      novelty: finding.recap.novelty,
      reason: finding.recap.reason,
      bestSolution: finding.recap.bestSolution,
      evidence: finding.recap.evidence,
      attentionFacts: finding.attentionFacts,
    },
    null,
    2,
  );
}

function formatItem(item: Item | null): string {
  if (!item) return 'No source item attached.';
  return JSON.stringify(
    { title: item.title, url: item.url, body: item.body.slice(0, 4000), metadata: item.metadata },
    null,
    2,
  );
}

export function localEvaluateFinding(args: { finding: Finding; item: Item | null }): EvaluationDecision {
  const gates = args.finding.decision.gateReasons;
  if (
    gates.some(
      (gate) =>
        gate.includes('active-maintainer') || gate.includes('linked-open-pr') || gate.includes('protected-label'),
    )
  ) {
    return {
      action: 'defer_because_already_active',
      confidence: 'high',
      reason: `Deterministic gates indicate this is already owned or protected: ${gates.join(', ')}.`,
      developerSummary: args.finding.recap.summary,
      recommendedNextStep: 'Revisit on a later sweep if the item becomes stale or changes materially.',
      proposedExternalComment: null,
      requiresHumanApproval: false,
      riskFlags: [],
    };
  }
  if (args.finding.decision.finalDecision === 'needs-info' || args.finding.recap.confidence === 'low') {
    return {
      action: 'request_more_info',
      confidence: 'medium',
      reason: 'The finding may be valid but lacks enough confidence or detail for immediate developer work.',
      developerSummary: args.finding.recap.summary,
      recommendedNextStep:
        'Collect reproduction details, versions, logs, and affected configuration before assigning developer time.',
      proposedExternalComment:
        'Could you share reproduction steps, product/platform versions, browser/device details, and any relevant logs?',
      requiresHumanApproval: true,
      riskFlags: ['external-comment-draft'],
    };
  }
  if (args.finding.decision.finalDecision === 'surface') {
    return {
      action: 'accept_for_developer_attention',
      confidence: args.finding.recap.confidence === 'high' ? 'high' : 'medium',
      reason: 'The finding passed deterministic gates and includes enough evidence to warrant developer investigation.',
      developerSummary: args.finding.recap.summary,
      recommendedNextStep: args.finding.recap.bestSolution,
      proposedExternalComment: null,
      requiresHumanApproval: false,
      riskFlags: [],
    };
  }
  return {
    action: 'dismiss_as_noise',
    confidence: 'medium',
    reason: 'The finding did not pass surfacing criteria and has no obvious next action.',
    developerSummary: args.finding.recap.summary,
    recommendedNextStep: 'Do not promote unless the source changes or more corroborating reports appear.',
    proposedExternalComment: null,
    requiresHumanApproval: false,
    riskFlags: [],
  };
}

export async function evaluateFinding(args: {
  productName: string;
  finding: Finding;
  item: Item | null;
  provider: CompletionProvider;
}): Promise<{ decision: EvaluationDecision; usage: { inputTokens: number; outputTokens: number } }> {
  if (args.provider.name === 'fake' || args.provider.name === 'local') {
    return { decision: localEvaluateFinding(args), usage: { inputTokens: 0, outputTokens: 0 } };
  }
  const schema = await loadPromptSchema('evaluate');
  const result = await args.provider.complete<EvaluationDecision>({
    promptId: 'evaluate',
    promptVersion: 'v1',
    inputs: {
      product: args.productName,
      finding: formatFinding(args.finding),
      item: formatItem(args.item),
    },
    schema,
    maxTokens: 4000,
    timeoutMs: 60_000,
  });
  return { decision: result.output, usage: result.usage };
}
