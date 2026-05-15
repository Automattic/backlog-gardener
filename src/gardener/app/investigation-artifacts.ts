import { StoreDb } from '../store/db.js';
import { SqliteAppStateStore } from './state.js';
import type { AppInvestigationArtifactRecord } from './types.js';

export interface InvestigationArtifactFilters {
  repo?: string;
  subjectType?: AppInvestigationArtifactRecord['subjectType'];
  subjectNumber?: number;
  status?: AppInvestigationArtifactRecord['status'];
  limit?: number;
}

export function readInvestigationArtifacts(
  statePath: string,
  filters: InvestigationArtifactFilters = {},
): AppInvestigationArtifactRecord[] {
  const db = new StoreDb(statePath);
  try {
    const state = new SqliteAppStateStore(db.db);
    return filterArtifacts(state.listInvestigationArtifacts(), filters);
  } finally {
    db.close();
  }
}

export function readInvestigationArtifact(statePath: string, id: string): AppInvestigationArtifactRecord | null {
  return readInvestigationArtifacts(statePath).find((artifact) => artifact.id === id) ?? null;
}

export function renderInvestigationArtifactList(artifacts: AppInvestigationArtifactRecord[]): string {
  if (artifacts.length === 0) return 'No investigation artifacts found.\n';
  return `${artifacts
    .map((artifact) => {
      const subject = artifact.subjectType === 'issue' ? `#${artifact.subjectNumber}` : `PR #${artifact.subjectNumber}`;
      const publication = artifact.publicationStatus ? ` publication=${artifact.publicationStatus}` : '';
      const suppression = artifact.suppressionReason ? ` suppression=${artifact.suppressionReason}` : '';
      return `${artifact.id} ${artifact.repo} ${subject} status=${artifact.status}${publication}${suppression} ${artifact.createdAt}`;
    })
    .join('\n')}\n`;
}

export function renderInvestigationArtifact(artifact: AppInvestigationArtifactRecord): string {
  const subject =
    artifact.subjectType === 'issue' ? `Issue #${artifact.subjectNumber}` : `Pull request #${artifact.subjectNumber}`;
  return (
    [
      `Investigation: ${artifact.id}`,
      `Repository: ${artifact.repo}`,
      `Subject: ${subject}`,
      `Status: ${artifact.status}`,
      `Publication: ${artifact.publicationStatus ?? 'none'}`,
      `Suppression reason: ${artifact.suppressionReason ?? 'none'}`,
      `Created: ${artifact.createdAt}`,
      `Updated: ${artifact.updatedAt}`,
      '',
      'Details:',
      JSON.stringify(artifact.details, null, 2),
      artifact.generatedBody ? ['', 'Generated body:', artifact.generatedBody].join('\n') : '',
    ]
      .filter((line) => line !== '')
      .join('\n') + '\n'
  );
}

export function renderInvestigationArtifactExplanation(artifact: AppInvestigationArtifactRecord | null): string {
  if (!artifact) {
    return [
      '🌱 **Backlog Gardener explanation**',
      '',
      'I do not have a persisted investigation artifact for this thread yet.',
    ].join('\n');
  }
  const subject =
    artifact.subjectType === 'issue' ? `issue #${artifact.subjectNumber}` : `PR #${artifact.subjectNumber}`;
  const details = artifact.details;
  const synthesis = details.synthesis as
    | { outcome?: string; confidence?: string; nextStep?: string; evidence?: string[] }
    | undefined;
  const evaluation = details.evaluation as
    | { action?: string; reason?: string; recommendedNextStep?: string }
    | undefined;
  const lines = [
    '🌱 **Backlog Gardener explanation**',
    '',
    `Latest artifact: \`${artifact.id}\` for ${subject}.`,
    `Status: \`${artifact.status}\`; publication: \`${artifact.publicationStatus ?? 'none'}\`.`,
  ];
  if (artifact.suppressionReason) lines.push(`Suppression reason: \`${artifact.suppressionReason}\`.`);
  if (synthesis) {
    lines.push(
      '',
      '## Synthesized result',
      `Outcome: **${synthesis.outcome ?? 'unknown'}** (${synthesis.confidence ?? 'unknown'} confidence)`,
    );
    if (synthesis.nextStep) lines.push(`Next step: ${synthesis.nextStep}`);
    if (Array.isArray(synthesis.evidence) && synthesis.evidence.length > 0) {
      lines.push('', 'Evidence:', ...synthesis.evidence.map((item) => `- ${item}`));
    }
  } else if (evaluation) {
    lines.push('', '## Evaluation', `Action: \`${evaluation.action ?? 'unknown'}\``);
    if (evaluation.reason) lines.push(`Reason: ${evaluation.reason}`);
    if (evaluation.recommendedNextStep) lines.push(`Next step: ${evaluation.recommendedNextStep}`);
  }
  lines.push('', 'Use `pnpm gardener github-app investigations show ' + artifact.id + '` locally for full details.');
  return lines.join('\n');
}

function filterArtifacts(
  artifacts: AppInvestigationArtifactRecord[],
  filters: InvestigationArtifactFilters,
): AppInvestigationArtifactRecord[] {
  const filtered = artifacts
    .filter((artifact) => !filters.repo || artifact.repo === filters.repo)
    .filter((artifact) => !filters.subjectType || artifact.subjectType === filters.subjectType)
    .filter((artifact) => filters.subjectNumber === undefined || artifact.subjectNumber === filters.subjectNumber)
    .filter((artifact) => !filters.status || artifact.status === filters.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return filters.limit ? filtered.slice(0, filters.limit) : filtered;
}
