import { createHmac, createSign } from 'node:crypto';

export interface GitHubAppAuthConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  apiBaseUrl?: string;
}

export interface InstallationTokenResponse {
  token: string;
  expires_at: string;
}

export function verifyGitHubWebhookSignature(args: {
  secret: string;
  payload: string | Buffer;
  signature256?: string;
}): boolean {
  if (!args.signature256?.startsWith('sha256=')) return false;
  const payload = typeof args.payload === 'string' ? Buffer.from(args.payload) : args.payload;
  const expected = `sha256=${createHmac('sha256', args.secret).update(payload).digest('hex')}`;
  return timingSafeEqualString(expected, args.signature256);
}

export function createGitHubAppJwt(args: { appId: string; privateKey: string; now?: Date }): string {
  const nowSeconds = Math.floor((args.now?.getTime() ?? Date.now()) / 1000);
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
  const payload = base64UrlJson({ iat: nowSeconds - 60, exp: nowSeconds + 9 * 60, iss: args.appId });
  const signingInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(args.privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

export async function createInstallationToken(args: {
  appId: string;
  privateKey: string;
  installationId: number;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}): Promise<InstallationTokenResponse> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const baseUrl = args.apiBaseUrl ?? 'https://api.github.com';
  const jwt = createGitHubAppJwt({ appId: args.appId, privateKey: args.privateKey });
  const response = await fetchImpl(`${baseUrl}/app/installations/${args.installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub installation token request failed: ${response.status}`);
  return (await response.json()) as InstallationTokenResponse;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  let diff = 0;
  for (let i = 0; i < aBuffer.length; i += 1) diff |= (aBuffer[i] ?? 0) ^ (bBuffer[i] ?? 0);
  return diff === 0;
}
