import { createServer, type IncomingMessage } from 'node:http';
import { parse as parseQuery } from 'node:querystring';

import { markFeedback } from '../feedback/commands.js';
import { readReviewFindings, readReviewRuns } from './data.js';
import { renderReviewPage } from './render.js';

export interface ReviewServerOptions {
  statePath: string;
  host?: string;
  port?: number;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function createReviewServer(options: ReviewServerOptions) {
  return createServer((req, res) => {
    void (async () => {
      try {
        if (req.method === 'GET' && (req.url === '/' || req.url?.startsWith('/?'))) {
          const html = renderReviewPage({
            statePath: options.statePath,
            runs: readReviewRuns(options.statePath),
            findings: readReviewFindings(options.statePath),
          });
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }
        if (req.method === 'POST' && req.url === '/feedback') {
          const form = parseQuery(await readBody(req));
          const findingId = String(form.findingId ?? '');
          const reason = String(form.reason ?? '').trim();
          markFeedback({
            statePath: options.statePath,
            findingId,
            verdict: String(form.verdict ?? 'maybe-useful') as Parameters<typeof markFeedback>[0]['verdict'],
            status: String(form.status ?? 'snoozed') as Parameters<typeof markFeedback>[0]['status'],
            reasons: reason ? [reason] : [],
            note: String(form.note ?? '').trim() || null,
            reviewer: 'local-review-ui',
          });
          res.writeHead(303, { location: '/' });
          res.end();
          return;
        }
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not found');
      } catch (error) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(error instanceof Error ? error.message : String(error));
      }
    })();
  });
}

export async function startReviewServer(
  options: ReviewServerOptions,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createReviewServer(options);
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4317;
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  return {
    url: `http://${host}:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
