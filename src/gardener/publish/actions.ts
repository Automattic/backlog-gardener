import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { ActionDropReason, SurfacedDrop } from '../actions/plan.js';
import type { ProposedAction, ProposedActionType } from '../actions/types.js';
import type { UsageTotals } from '../usage.js';

const DROP_REASON_LABEL: Record<ActionDropReason, string> = {
  'finding-not-surfaced': 'Finding was not surfaced',
  'feedback-dismissed-or-snoozed': 'Suppressed by reviewer feedback (dismissed or snoozed)',
  'protected-label': 'Source carries a protected label',
  'linked-open-pr': 'Source has a linked open PR',
  'active-maintainer': 'Maintainer is actively working on it',
  'evaluator-rejected': 'Evaluator declined to forward to a developer',
  'text-indicates-active-work': 'Text indicates someone is already working on a fix',
  'no-net-new-context-for-existing-issue':
    'No net-new implementation context to add to the existing issue (no external evidence and no concrete likely files)',
};

function escapeMd(text: string): string {
  return text.replace(/<!--/g, '&lt;!--');
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function targetLabel(action: ProposedAction): string {
  const target = action.target;
  if (target.system === 'github' && target.kind === 'issue') return `${target.repo}#${target.issueNumber}`;
  if (target.system === 'github' && target.kind === 'new_issue') return `${target.repo} new issue`;
  if (target.system === 'github' && target.kind === 'pull_request') return `${target.repo} ${target.branchName}`;
  if (target.system === 'linear') return target.issueIdentifier ?? target.teamKey ?? 'Linear';
  return 'Unknown target';
}

function actionTypeHeading(type: ProposedActionType): string {
  if (type === 'add_context_to_existing_issue') return 'Would add context to existing issues';
  if (type === 'create_issue') return 'Would create issues';
  return 'Would open PRs / PR candidates';
}

function renderAction(action: ProposedAction): string[] {
  const artifactLines = action.prArtifacts
    ? [
        `- Patch: ${escapeMd(action.prArtifacts.patchPath)}`,
        `- PR body: ${escapeMd(action.prArtifacts.prBodyPath)}`,
        `- Verification: ${escapeMd(action.prArtifacts.verificationPath)} (${action.prArtifacts.verificationStatus})`,
      ]
    : [];
  const url = targetUrl(action);
  const target = url ? `[${escapeMd(targetLabel(action))}](${url})` : escapeMd(targetLabel(action));
  return [
    `### ${escapeMd(action.title)}`,
    '',
    `- Action: \`${action.type}\``,
    `- Status: \`${action.status}\``,
    `- Target: ${target}`,
    `- Confidence: ${action.confidence}`,
    `- Findings: ${action.sourceFindingIds.map((id) => `\`${id}\``).join(', ')}`,
    ...artifactLines,
    action.safety.blockedReasons.length > 0
      ? `- Blocked reasons: ${action.safety.blockedReasons.map((reason) => `\`${reason}\``).join(', ')}`
      : null,
    '',
    `**Rationale:** ${escapeMd(action.rationale)}`,
    '',
    '#### Draft body',
    '',
    '```markdown',
    action.body,
    '```',
    '',
  ].filter((line): line is string => line !== null);
}

export function renderActionsMarkdown(args: {
  runId: string;
  productName: string;
  dryRun: boolean;
  externalWritesEnabled: boolean;
  actions: ProposedAction[];
  surfacedDrops?: SurfacedDrop[];
}): string {
  const grouped: ProposedActionType[] = ['add_context_to_existing_issue', 'create_issue', 'open_pr'];
  const drops = args.surfacedDrops ?? [];
  const lines = [
    `# Backlog Gardener action plan — ${escapeMd(args.productName)}`,
    '',
    `Run: \`${args.runId}\``,
    `External writes: **${args.externalWritesEnabled ? 'enabled' : 'disabled'}**${args.dryRun ? ' (dry run)' : ''}`,
    '',
    `- Actions planned: **${args.actions.length}**`,
    `- Would add context: **${args.actions.filter((action) => action.type === 'add_context_to_existing_issue').length}**`,
    `- Would create issues: **${args.actions.filter((action) => action.type === 'create_issue').length}**`,
    `- Would open PRs: **${args.actions.filter((action) => action.type === 'open_pr').length}**`,
    drops.length > 0 ? `- Surfaced without an action: **${drops.length}**` : null,
    '',
  ].filter((line): line is string => line !== null);

  for (const type of grouped) {
    const actions = args.actions.filter((action) => action.type === type);
    if (actions.length === 0) continue;
    lines.push(`## ${actionTypeHeading(type)}`, '');
    for (const action of actions) lines.push(...renderAction(action));
  }

  if (drops.length > 0) {
    lines.push('## Surfaced findings without an action', '');
    for (const drop of drops) {
      const target = drop.itemUrl ? `[${escapeMd(drop.itemUrl)}](${drop.itemUrl})` : '_no source URL_';
      lines.push(`- \`${drop.findingId}\` — ${escapeMd(DROP_REASON_LABEL[drop.reason])}`, `  Source: ${target}`, '');
    }
  }

  if (args.actions.length === 0 && drops.length === 0) {
    lines.push('No eligible external actions were planned for this run.', '');
  }

  return `${lines.join('\n')}\n`;
}

function targetUrl(action: ProposedAction): string | null {
  const target = action.target;
  if (target.system === 'github' && target.kind === 'issue') return target.url;
  return action.sourceUrls[0] ?? null;
}

function renderHtmlAction(action: ProposedAction): string {
  const url = targetUrl(action);
  const artifacts = action.prArtifacts
    ? `<ul class="artifacts">
      <li><strong>Patch:</strong> <code>${escapeHtml(action.prArtifacts.patchPath)}</code></li>
      <li><strong>PR body:</strong> <code>${escapeHtml(action.prArtifacts.prBodyPath)}</code></li>
      <li><strong>Verification:</strong> <code>${escapeHtml(action.prArtifacts.verificationPath)}</code> (${escapeHtml(action.prArtifacts.verificationStatus)})</li>
    </ul>`
    : '';
  return `<article class="action ${escapeHtml(action.type)}">
    <header>
      <div class="badges">
        <span class="badge">${escapeHtml(action.type)}</span>
        <span class="badge status">${escapeHtml(action.status)}</span>
        <span class="badge confidence-${escapeHtml(action.confidence)}">${escapeHtml(action.confidence)}</span>
      </div>
      <h2>${escapeHtml(action.title)}</h2>
      <p class="target">${url ? `<a href="${escapeHtml(url)}">${escapeHtml(targetLabel(action))}</a>` : escapeHtml(targetLabel(action))}</p>
    </header>
    <p><strong>Rationale:</strong> ${escapeHtml(action.rationale)}</p>
    ${artifacts}
    <details open>
      <summary>Draft body</summary>
      <pre>${escapeHtml(action.body)}</pre>
    </details>
  </article>`;
}

export function renderActionsHtml(args: {
  runId: string;
  productName: string;
  dryRun: boolean;
  externalWritesEnabled: boolean;
  actions: ProposedAction[];
  surfacedDrops?: SurfacedDrop[];
}): string {
  const drops = args.surfacedDrops ?? [];
  const actionList = args.actions.length
    ? args.actions.map(renderHtmlAction).join('\n')
    : drops.length > 0
      ? ''
      : '<section class="empty">No eligible external actions were planned for this run.</section>';
  const dropsSection =
    drops.length > 0
      ? `<section class="drops">
  <h2>Surfaced findings without an action</h2>
  <ul>
${drops
  .map(
    (drop) =>
      `    <li><code>${escapeHtml(drop.findingId)}</code> — ${escapeHtml(DROP_REASON_LABEL[drop.reason])}${
        drop.itemUrl ? ` · <a href="${escapeHtml(drop.itemUrl)}">${escapeHtml(drop.itemUrl)}</a>` : ''
      }</li>`,
  )
  .join('\n')}
  </ul>
</section>`
      : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Backlog Gardener actions — ${escapeHtml(args.productName)}</title>
<style>
:root { color-scheme: light dark; --bg:#0f172a; --panel:#111827; --text:#e5e7eb; --muted:#9ca3af; --line:#374151; --accent:#22c55e; }
body { margin:0; font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif; background:var(--bg); color:var(--text); }
main { max-width:1100px; margin:0 auto; padding:24px; }
h1 { margin:0 0 8px; font-size:32px; } h2 { margin:8px 0; font-size:20px; }
a { color:#93c5fd; }
.summary,.action,.empty,.drops { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px; margin:16px 0; box-shadow:0 8px 24px #0003; }
.drops ul { margin:8px 0 0; padding-left:18px; } .drops li { margin:4px 0; }
.summary dl { display:grid; grid-template-columns:max-content 1fr; gap:8px 14px; margin:0; }
.summary dt { color:var(--muted); } .summary dd { margin:0; }
.badge { display:inline-block; padding:2px 8px; border-radius:999px; background:#334155; margin-right:4px; font-size:12px; }
.confidence-high { background:#166534; } .confidence-medium { background:#92400e; } .confidence-low { background:#7f1d1d; }
.target { color:var(--muted); margin-top:0; }
pre { overflow:auto; white-space:pre-wrap; background:#020617; border:1px solid var(--line); border-radius:10px; padding:12px; }
.artifacts { padding-left:20px; }
</style>
</head>
<body><main>
<h1>🌱 Backlog Gardener actions — ${escapeHtml(args.productName)}</h1>
<section class="summary"><dl>
  <dt>Run</dt><dd><code>${escapeHtml(args.runId)}</code></dd>
  <dt>External writes</dt><dd>${args.externalWritesEnabled ? 'enabled' : 'disabled'}${args.dryRun ? ' (dry run)' : ''}</dd>
  <dt>Actions planned</dt><dd>${args.actions.length}</dd>
  <dt>Add context</dt><dd>${args.actions.filter((action) => action.type === 'add_context_to_existing_issue').length}</dd>
  <dt>Create issues</dt><dd>${args.actions.filter((action) => action.type === 'create_issue').length}</dd>
  <dt>Open PRs</dt><dd>${args.actions.filter((action) => action.type === 'open_pr').length}</dd>${
    drops.length > 0 ? `\n  <dt>Surfaced without an action</dt><dd>${drops.length}</dd>` : ''
  }
</dl></section>
${actionList}
${dropsSection}
</main></body></html>
`;
}

export interface RunManifest {
  schemaVersion: 'gardener.run.v1';
  runId: string;
  product: { slug: string; name: string };
  command: 'run' | 'sweep';
  dryRun: boolean;
  externalWritesEnabled: boolean;
  lane: 'hot' | 'warm' | 'cold';
  status: 'completed' | 'failed';
  startedAt: string;
  completedAt: string;
  counts: {
    itemsFetched: number;
    repliesFetched: number;
    findings: number;
    surfaced: number;
    actions: number;
    addContextActions: number;
    createIssueActions: number;
    openPrActions: number;
    surfacedWithoutAction: number;
    prCandidates: number;
    dedupEdges: number;
    clusters: number;
    evaluations: number;
    verifications: number;
  };
  surfacedDrops: SurfacedDrop[];
  outputs: {
    actionsJsonl: string;
    actionsMarkdown: string;
    actionsHtml: string;
    manifest: string;
    digest: string | null;
  };
  usage: UsageTotals;
  skippedExternalWriters: string[];
}

export function writeActionPlanOutput(args: {
  outputDir: string;
  runId: string;
  productName: string;
  dryRun: boolean;
  externalWritesEnabled: boolean;
  actions: ProposedAction[];
  surfacedDrops: SurfacedDrop[];
  manifest: Omit<RunManifest, 'outputs'>;
  digestPath: string | null;
}): { actionsJsonlPath: string; actionsMarkdownPath: string; actionsHtmlPath: string; manifestPath: string } {
  mkdirSync(args.outputDir, { recursive: true });
  const actionsJsonlPath = join(args.outputDir, 'actions.jsonl');
  const actionsMarkdownPath = join(args.outputDir, 'actions.md');
  const actionsHtmlPath = join(args.outputDir, 'actions.html');
  const manifestPath = join(args.outputDir, 'manifest.json');
  writeFileSync(
    actionsJsonlPath,
    args.actions.map((action) => JSON.stringify(action)).join('\n') + (args.actions.length > 0 ? '\n' : ''),
  );
  writeFileSync(
    actionsMarkdownPath,
    renderActionsMarkdown({
      runId: args.runId,
      productName: args.productName,
      dryRun: args.dryRun,
      externalWritesEnabled: args.externalWritesEnabled,
      actions: args.actions,
      surfacedDrops: args.surfacedDrops,
    }),
  );
  writeFileSync(
    actionsHtmlPath,
    renderActionsHtml({
      runId: args.runId,
      productName: args.productName,
      dryRun: args.dryRun,
      externalWritesEnabled: args.externalWritesEnabled,
      actions: args.actions,
      surfacedDrops: args.surfacedDrops,
    }),
  );
  const manifest: RunManifest = {
    ...args.manifest,
    outputs: {
      actionsJsonl: basename(actionsJsonlPath),
      actionsMarkdown: basename(actionsMarkdownPath),
      actionsHtml: basename(actionsHtmlPath),
      manifest: basename(manifestPath),
      digest: args.digestPath ? basename(args.digestPath) : null,
    },
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { actionsJsonlPath, actionsMarkdownPath, actionsHtmlPath, manifestPath };
}
