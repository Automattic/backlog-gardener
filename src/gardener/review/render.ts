import type { FeedbackRecord } from '../domain.js';
import type { ReviewFinding, ReviewRun } from './data.js';

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function badge(value: string): string {
  return `<span class="badge ${esc(value)}">${esc(value)}</span>`;
}

function latestFeedback(feedback: FeedbackRecord[]): string {
  const latest = feedback[0];
  if (!latest) return '<span class="muted">No feedback yet</span>';
  return `${badge(latest.verdict)} ${badge(latest.status)} ${latest.note ? `<span class="muted">${esc(latest.note)}</span>` : ''}`;
}

function feedbackForm(findingId: string): string {
  return `<form class="feedback" method="post" action="/feedback">
    <input type="hidden" name="findingId" value="${esc(findingId)}" />
    <select name="verdict">
      <option value="useful">Useful</option>
      <option value="maybe-useful">Maybe useful</option>
      <option value="not-useful">Not useful</option>
    </select>
    <select name="status">
      <option value="accepted">Accept</option>
      <option value="dismissed">Dismiss</option>
      <option value="snoozed">Snooze</option>
      <option value="acted-on">Acted on</option>
    </select>
    <input name="reason" placeholder="reason, e.g. actionable" />
    <input name="note" placeholder="note" />
    <button type="submit">Save feedback</button>
  </form>`;
}

function findingCard(entry: ReviewFinding): string {
  const f = entry.finding;
  const source = entry.item?.url ?? f.recap.evidence[0]?.sourceUrl ?? '#';
  const gates =
    f.decision.gateReasons.length > 0
      ? `<ul>${f.decision.gateReasons.map((reason) => `<li>${esc(reason)}</li>`).join('')}</ul>`
      : '<span class="muted">None</span>';
  const evaluation = entry.evaluation
    ? `<section class="agent"><h3>🧭 Evaluator</h3>${badge(entry.evaluation.action)} ${badge(entry.evaluation.confidence)}<p>${esc(entry.evaluation.reason)}</p><p><strong>Next:</strong> ${esc(entry.evaluation.recommendedNextStep)}</p>${entry.evaluation.proposedExternalComment ? `<details><summary>Draft external comment</summary><p>${esc(entry.evaluation.proposedExternalComment)}</p></details>` : ''}</section>`
    : '<section class="agent muted">No evaluator decision yet.</section>';
  const verification = entry.verification
    ? `<section class="agent"><h3>🛠️ Verifier</h3>${badge(entry.verification.action)} ${badge(entry.verification.confidence)}<p><strong>Subsystem:</strong> ${esc(entry.verification.subsystem)}</p><p>${esc(entry.verification.developerNotes)}</p><details><summary>Likely files</summary><ul>${entry.verification.likelyFiles.map((file) => `<li><code>${esc(file)}</code></li>`).join('')}</ul></details><details><summary>Hypotheses</summary><ul>${entry.verification.hypotheses.map((text) => `<li>${esc(text)}</li>`).join('')}</ul></details><details><summary>Suggested repro/tests</summary><ul>${[...entry.verification.suggestedReproSteps, ...entry.verification.suggestedTests].map((text) => `<li>${esc(text)}</li>`).join('')}</ul></details></section>`
    : '<section class="agent muted">No verifier plan yet.</section>';
  return `<article class="card ${esc(f.decision.finalDecision)}">
    <header>
      <div>${badge(f.decision.finalDecision)} ${badge(f.recap.confidence)} ${f.surfacingLabel ? badge(f.surfacingLabel) : ''}</div>
      <h2>${esc(f.recap.summary)}</h2>
      <a href="${esc(source)}" target="_blank" rel="noreferrer">Open source</a>
    </header>
    <p>${esc(f.decision.surfacingReason)}</p>
    <details><summary>Suggested next step</summary><p>${esc(f.recap.bestSolution)}</p></details>
    <details><summary>Evidence</summary><ul>${f.recap.evidence.map((e) => `<li><a href="${esc(e.sourceUrl)}" target="_blank" rel="noreferrer">${esc(e.label)}</a>: ${esc(e.detail)} ${e.quote ? `<blockquote>${esc(e.quote)}</blockquote>` : ''}</li>`).join('')}</ul></details>
    <details><summary>Gate reasons</summary>${gates}</details>
    ${evaluation}
    ${verification}
    <div class="current-feedback">${latestFeedback(entry.feedback)}</div>
    ${feedbackForm(f.id)}
  </article>`;
}

export function renderReviewPage(args: { statePath: string; runs: ReviewRun[]; findings: ReviewFinding[] }): string {
  const latest = args.runs[0];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Backlog Gardener Review</title>
<style>
:root { color-scheme: light dark; --bg:#0f172a; --panel:#111827; --text:#e5e7eb; --muted:#9ca3af; --line:#374151; --accent:#22c55e; }
body { margin:0; font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif; background:var(--bg); color:var(--text); }
main { max-width:1100px; margin:0 auto; padding:24px; }
h1 { margin:0 0 8px; font-size:32px; } h2 { margin:10px 0; font-size:18px; }
.grid { display:grid; grid-template-columns:280px 1fr; gap:20px; align-items:start; }
.panel,.card { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px; box-shadow:0 8px 24px #0003; }
.card { margin-bottom:16px; } .card.surface { border-left:5px solid #22c55e; } .card.defer { border-left:5px solid #f59e0b; }
.badge { display:inline-block; padding:2px 8px; border-radius:999px; background:#334155; margin-right:4px; font-size:12px; }
.badge.surface,.badge.high,.badge.useful,.badge.accepted { background:#166534; } .badge.defer,.badge.maybe-useful,.badge.snoozed { background:#92400e; } .badge.dismissed,.badge.not-useful { background:#7f1d1d; }
.muted { color:var(--muted); } a { color:#93c5fd; } button { background:var(--accent); color:#052e16; border:0; border-radius:8px; padding:8px 10px; font-weight:700; }
input,select { background:#020617; color:var(--text); border:1px solid var(--line); border-radius:8px; padding:8px; }
.feedback { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; } details { margin:8px 0; } blockquote { color:var(--muted); border-left:3px solid var(--line); margin:6px 0; padding-left:10px; }
.agent { margin:12px 0; padding:12px; border:1px solid var(--line); border-radius:10px; background:#02061766; } .agent h3 { margin:0 0 8px; }
.run { border-bottom:1px solid var(--line); padding:8px 0; }
</style>
</head>
<body><main>
<h1>🌱 Backlog Gardener Review</h1>
<p class="muted">Local review UI for <code>${esc(args.statePath)}</code>. Feedback is stored locally only.</p>
${latest ? `<p>${badge(String(latest.status))} Latest run <code>${esc(latest.id)}</code> — ${esc(latest.startedAt)}</p>` : '<p>No runs yet.</p>'}
<div class="grid">
  <aside class="panel"><h2>Runs</h2>${args.runs.map((run) => `<div class="run"><strong>${esc(run.mode)}</strong> ${badge(run.status)}<br/><code>${esc(run.id)}</code><br/><span class="muted">${esc(run.startedAt)}</span></div>`).join('')}</aside>
  <section>${args.findings.length ? args.findings.map(findingCard).join('') : '<div class="panel">No findings yet.</div>'}</section>
</div>
</main></body></html>`;
}
