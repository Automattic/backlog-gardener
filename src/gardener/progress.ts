function color(code: number, text: string): string {
  if (process.env.NO_COLOR) return text;
  return `\u001b[${code}m${text}\u001b[0m`;
}

const dim = (text: string) => color(2, text);
const green = (text: string) => color(32, text);
const yellow = (text: string) => color(33, text);
const blue = (text: string) => color(34, text);
const magenta = (text: string) => color(35, text);
const cyan = (text: string) => color(36, text);
const red = (text: string) => color(31, text);
const bold = (text: string) => color(1, text);

export type ProgressEvent =
  | { type: 'run-started'; runId: string; mode: 'run' | 'sweep' | 'backfill' }
  | { type: 'source-started'; sourceKey: string }
  | { type: 'item-fetched'; title: string; url: string; referenceOnly: boolean }
  | { type: 'analysis-started'; title: string }
  | { type: 'finding-decided'; title: string; decision: string }
  | { type: 'embeddings-started'; count: number }
  | { type: 'dedup-started'; count: number }
  | { type: 'evaluation-started'; count: number }
  | { type: 'verification-started'; count: number }
  | { type: 'publishing-started'; publisher: string }
  | { type: 'run-finished'; runId: string; status: 'completed' | 'failed' };

export type ProgressReporter = (event: ProgressEvent) => void;

export function renderProgressEvent(event: ProgressEvent): string {
  switch (event.type) {
    case 'run-started': {
      const label =
        event.mode === 'backfill' ? 'Backfill started' : event.mode === 'sweep' ? 'Sweep started' : 'Run started';
      return `${green('🌱')} ${bold(label)} ${dim(event.runId)}`;
    }
    case 'source-started':
      return `${blue('🔎')} ${bold('Fetching')} ${cyan(event.sourceKey)}`;
    case 'item-fetched':
      return `  ${event.referenceOnly ? dim('📎 Reference') : '📥 Item'} ${event.title}`;
    case 'analysis-started':
      return `    ${magenta('🧠')} Analyzing ${dim(event.title)}`;
    case 'finding-decided': {
      const badge =
        event.decision === 'surface'
          ? green('surface')
          : event.decision === 'defer'
            ? yellow('defer')
            : dim(event.decision);
      return `    ${green('✓')} Decision ${badge} ${dim('—')} ${event.title}`;
    }
    case 'embeddings-started':
      return `${cyan('🧬')} Embedding ${bold(String(event.count))} item(s)`;
    case 'dedup-started':
      return `${yellow('🧩')} Deduping ${bold(String(event.count))} candidate pair(s)`;
    case 'evaluation-started':
      return `${magenta('🧭')} Evaluating ${bold(String(event.count))} finding(s)`;
    case 'verification-started':
      return `${cyan('🛠️')} Verifying ${bold(String(event.count))} accepted finding(s)`;
    case 'publishing-started':
      return `${magenta('📣')} Publishing to ${bold(event.publisher)}`;
    case 'run-finished':
      return event.status === 'completed'
        ? `${green('✅')} ${bold('Run completed')} ${dim(event.runId)}`
        : `${red('❌')} ${bold('Run failed')} ${dim(event.runId)}`;
  }
}
