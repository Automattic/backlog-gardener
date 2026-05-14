import { createHash } from 'node:crypto';

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function bodyHash(body: string): string {
  return sha256(normalizeText(body));
}

export function snapshotHash(input: { itemBodyHash: string; replyBodyHashes: string[] }): string {
  return sha256([input.itemBodyHash, ...input.replyBodyHashes.sort()].join('\n'));
}
