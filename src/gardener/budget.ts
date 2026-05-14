import type { TriageProfile } from './config/index.js';

export interface UsageAccumulator {
  completionCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export function createUsageAccumulator(): UsageAccumulator {
  return { completionCalls: 0, inputTokens: 0, outputTokens: 0 };
}

export function canMakeCompletionCall(profile: TriageProfile, usage: UsageAccumulator): boolean {
  return usage.completionCalls < profile.budget.maxCompletionCallsPerRun;
}

export function recordCompletionUsage(
  usage: UsageAccumulator,
  tokens: { inputTokens: number; outputTokens: number },
): void {
  usage.completionCalls += 1;
  usage.inputTokens += tokens.inputTokens;
  usage.outputTokens += tokens.outputTokens;
}
