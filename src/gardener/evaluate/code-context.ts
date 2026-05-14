import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DEFAULT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.php', '.md', '.json', '.yml', '.yaml']);
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', '.gardener-state', 'out']);

function ext(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot);
}

function keywords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 4),
    ),
  ].slice(0, 12);
}

function walk(root: string, dir = root, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(root, path, out);
    else if (stat.isFile() && stat.size <= 120_000 && DEFAULT_EXTENSIONS.has(ext(path))) out.push(path);
  }
  return out;
}

export interface CodeContextResult {
  snippets: Array<{ path: string; excerpt: string }>;
}

export function collectCodeContext(args: {
  rootDir?: string;
  query: string;
  maxFiles?: number;
  maxCharsPerFile?: number;
}): CodeContextResult {
  const root = args.rootDir ?? process.cwd();
  const terms = keywords(args.query);
  if (terms.length === 0) return { snippets: [] };
  const scored = walk(root)
    .map((path) => {
      const text = readFileSync(path, 'utf8');
      const lower = text.toLowerCase();
      const score = terms.reduce((count, term) => count + (lower.includes(term) ? 1 : 0), 0);
      return { path, text, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, args.maxFiles ?? 5);
  return {
    snippets: scored.map((entry) => ({
      path: relative(root, entry.path),
      excerpt: entry.text.slice(0, args.maxCharsPerFile ?? 1200),
    })),
  };
}

export function renderCodeContext(context: CodeContextResult): string {
  if (context.snippets.length === 0) return 'No relevant local code snippets found.';
  return context.snippets.map((snippet) => `File: ${snippet.path}\n\n${snippet.excerpt}`).join('\n\n---\n\n');
}
