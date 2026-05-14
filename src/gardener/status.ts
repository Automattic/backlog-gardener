import { RepositoryBundle, StoreDb } from './store/index.js';

export interface StatusSummary {
  itemCount: number;
  findingCount: number;
  recentFindings: Array<{ id: string; finalDecision: string; summary: string; lifecycleStatus: string }>;
}

export function readStatus(statePath: string): StatusSummary {
  const db = new StoreDb(statePath);
  try {
    db.migrate();
    const repos = new RepositoryBundle(db.db);
    const items = repos.items.list(1_000_000);
    const findings = repos.findings.list(20);
    return {
      itemCount: items.length,
      findingCount: findings.length,
      recentFindings: findings.map((finding) => ({
        id: finding.id,
        finalDecision: finding.decision.finalDecision,
        summary: finding.recap.summary,
        lifecycleStatus: finding.lifecycleStatus,
      })),
    };
  } finally {
    db.close();
  }
}

export function renderStatus(summary: StatusSummary): string {
  const lines = ['Backlog Gardener status', `Items: ${summary.itemCount}`, `Findings: ${summary.findingCount}`];
  if (summary.recentFindings.length > 0) {
    lines.push('', 'Recent findings:');
    for (const finding of summary.recentFindings) {
      lines.push(`- ${finding.id} [${finding.finalDecision}/${finding.lifecycleStatus}] ${finding.summary}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
