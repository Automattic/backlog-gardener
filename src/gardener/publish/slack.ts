import type { Finding } from '../domain.js';
import type { FetchLike } from '../sources/http.js';

export interface SlackSummaryInput {
  webhookUrl: string;
  productName: string;
  runId: string;
  surfaced: number;
  deferred: number;
  digestPath: string | null;
  topFindings: Finding[];
  fetchImpl?: FetchLike | undefined;
}

export async function publishSlackSummary(input: SlackSummaryInput): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const text = [
    `Backlog Gardener finished: ${input.productName}`,
    `Run: ${input.runId}`,
    `Surfaced: ${input.surfaced} | Deferred: ${input.deferred}`,
    input.digestPath ? `Digest: ${input.digestPath}` : null,
    ...input.topFindings.slice(0, 5).map((finding, index) => `${index + 1}. ${finding.recap.summary}`),
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
  const response = await fetchImpl(input.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error(`Slack webhook failed: HTTP ${response.status}`);
}
