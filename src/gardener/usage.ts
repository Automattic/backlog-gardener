import { newId, nowIso } from './ids.js';
import type { DatabaseHandle } from './store/db.js';

export interface UsageEventInput {
  runId: string;
  provider: string;
  model: string;
  kind: 'completion' | 'embedding';
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
}

export interface UsageTotals {
  completionCalls: number;
  embeddingCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export function estimateCompletionCostUsd(args: {
  provider: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  // Conservative configurable pricing comes later; this MVP default keeps
  // spend visible without pretending to be provider-authoritative.
  const pricing =
    args.provider === 'anthropic'
      ? { inputPerMillion: 15, outputPerMillion: 75 }
      : { inputPerMillion: 5, outputPerMillion: 15 };
  return (
    (args.inputTokens / 1_000_000) * pricing.inputPerMillion +
    (args.outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

export function recordUsageEvent(db: DatabaseHandle, event: UsageEventInput): void {
  db.prepare(
    `
    INSERT INTO usage_events (
      id, run_id, provider, model, kind, input_tokens, output_tokens, estimated_cost_usd, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    newId('use'),
    event.runId,
    event.provider,
    event.model,
    event.kind,
    event.inputTokens ?? 0,
    event.outputTokens ?? 0,
    event.estimatedCostUsd ?? 0,
    nowIso(),
  );
}

export function usageTotalsForRun(db: DatabaseHandle, runId: string): UsageTotals {
  const row = db
    .prepare(
      `
    SELECT
      SUM(CASE WHEN kind = 'completion' THEN 1 ELSE 0 END) AS completion_calls,
      SUM(CASE WHEN kind = 'embedding' THEN 1 ELSE 0 END) AS embedding_calls,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
    FROM usage_events
    WHERE run_id = ?
  `,
    )
    .get(runId) as Record<string, unknown> | undefined;
  return {
    completionCalls: Number(row?.completion_calls ?? 0),
    embeddingCalls: Number(row?.embedding_calls ?? 0),
    inputTokens: Number(row?.input_tokens ?? 0),
    outputTokens: Number(row?.output_tokens ?? 0),
    estimatedCostUsd: Number(row?.estimated_cost_usd ?? 0),
  };
}
