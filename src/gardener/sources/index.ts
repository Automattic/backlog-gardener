import type { SourceConfig } from '../config/index.js';
import type { SourceAdapter } from './base.js';
import { GitHubSourceAdapter } from './github.js';
import type { FetchLike } from './http.js';
import { WporgForumSourceAdapter } from './wporg-forum.js';
import { WporgReviewsSourceAdapter } from './wporg-reviews.js';

function adapterArgs<T extends SourceConfig>(
  config: T,
  fetchImpl: FetchLike | undefined,
): { config: T; fetchImpl?: FetchLike } {
  return fetchImpl ? { config, fetchImpl } : { config };
}

export function createSourceAdapter(config: SourceConfig, fetchImpl?: FetchLike): SourceAdapter {
  if (config.type === 'github') return new GitHubSourceAdapter(adapterArgs(config, fetchImpl));
  if (config.type === 'wporg-reviews') return new WporgReviewsSourceAdapter(adapterArgs(config, fetchImpl));
  return new WporgForumSourceAdapter(adapterArgs(config, fetchImpl));
}

export type { SourceAdapter } from './base.js';
