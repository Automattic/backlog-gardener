import { existsSync } from 'node:fs';

import type { Finding, Item } from '../domain.js';
import { loadPromptSchema } from '../llm/prompts.js';
import type { CompletionProvider } from '../llm/provider.js';
import { collectCodeContext, renderCodeContext } from './code-context.js';
import type { EvaluationRecord, VerificationDecision } from './types.js';

function formatFinding(finding: Finding): string {
  return JSON.stringify(
    { summary: finding.recap.summary, bestSolution: finding.recap.bestSolution, evidence: finding.recap.evidence },
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

function localVerify(args: { finding: Finding; item: Item | null; codeContext: string }): VerificationDecision {
  const hasCode = !args.codeContext.startsWith('No relevant');
  return {
    action: hasCode ? 'debugging_plan_ready' : 'needs_code_context',
    confidence: hasCode ? 'medium' : 'low',
    subsystem: String(args.item?.metadata.subsystem ?? 'Unknown / needs code mapping'),
    likelyFiles: hasCode
      ? (args.codeContext.match(/^File: (.+)$/gm)?.map((line) => line.replace('File: ', '')) ?? [])
      : [],
    hypotheses: [
      args.finding.recap.bestSolution || 'Investigate the source report and map it to the relevant product subsystem.',
    ],
    suggestedReproSteps: [
      'Open the source report.',
      'Reproduce the described behavior on a current local/test store.',
      'Compare observed behavior with expected behavior from the report evidence.',
    ],
    suggestedTests: [
      'Add or update a regression test around the reproduced behavior once the affected subsystem is identified.',
    ],
    developerNotes: hasCode
      ? 'Limited local code snippets matched the finding. Treat them as starting points, not proof of root cause.'
      : 'No relevant local code context was found. Run verification from the product repository or provide a code root for better debugging plans.',
    requiresHumanApproval: false,
  };
}

export async function verifyFinding(args: {
  productName: string;
  finding: Finding;
  item: Item | null;
  evaluation: EvaluationRecord;
  provider: CompletionProvider;
  codeRoot?: string;
}): Promise<{ decision: VerificationDecision; usage: { inputTokens: number; outputTokens: number } }> {
  const context =
    args.codeRoot && existsSync(args.codeRoot)
      ? collectCodeContext({
          rootDir: args.codeRoot,
          query: `${args.finding.recap.summary} ${args.finding.recap.bestSolution} ${args.item?.title ?? ''}`,
        })
      : { snippets: [] };
  const codeContext = renderCodeContext(context);
  if (args.provider.name === 'fake' || args.provider.name === 'local') {
    return {
      decision: localVerify({ finding: args.finding, item: args.item, codeContext }),
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
  const schema = await loadPromptSchema('verify');
  const result = await args.provider.complete<VerificationDecision>({
    promptId: 'verify',
    promptVersion: 'v1',
    inputs: {
      product: args.productName,
      evaluation: JSON.stringify(args.evaluation, null, 2),
      finding: formatFinding(args.finding),
      item: formatItem(args.item),
      codeContext,
    },
    schema,
    maxTokens: 5000,
    timeoutMs: 60_000,
  });
  return { decision: result.output, usage: result.usage };
}
