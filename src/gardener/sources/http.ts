export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface FetchJsonOptions {
  retries?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
}

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

async function fetchWithPolicy(
  fetchImpl: FetchLike,
  url: string,
  init?: RequestInit,
  options: FetchJsonOptions = {},
): Promise<Response> {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retryDelayMs = options.retryDelayMs ?? 250;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...init, signal: init?.signal ?? controller.signal });
      if (response.ok || !shouldRetry(response.status) || attempt === retries) return response;
      lastError = new HttpError(url, response.status, await response.text());
    } catch (error) {
      lastError = error;
      if (attempt === retries) throw error;
    } finally {
      clearTimeout(timeout);
    }
    await sleep(retryDelayMs * (attempt + 1));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchJson<T>(
  fetchImpl: FetchLike,
  url: string,
  init?: RequestInit,
  options?: FetchJsonOptions,
): Promise<T> {
  const response = await fetchWithPolicy(fetchImpl, url, init, options);
  if (!response.ok) throw new HttpError(url, response.status, await response.text());
  return (await response.json()) as T;
}

export async function fetchText(
  fetchImpl: FetchLike,
  url: string,
  init?: RequestInit,
  options?: FetchJsonOptions,
): Promise<string> {
  const response = await fetchWithPolicy(fetchImpl, url, init, options);
  if (!response.ok) throw new HttpError(url, response.status, await response.text());
  return response.text();
}
