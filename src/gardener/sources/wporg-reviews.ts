import Parser from 'rss-parser';

import type { WporgReviewsSourceConfig } from '../config/index.js';
import type { Item, Reply } from '../domain.js';
import { bodyHash } from '../normalize/hashes.js';
import { htmlToText } from '../normalize/html.js';
import type { SourceAdapter } from './base.js';
import { fetchText, type FetchLike } from './http.js';

type FeedItem = Parser.Item & {
  content?: string;
  contentSnippet?: string;
  creator?: string;
  dc?: { creator?: string };
};

function ratingFromText(text: string): number | null {
  const match = /Rated\s+(\d)\s+out of 5/i.exec(text) ?? /(\d)\s+stars?/i.exec(text);
  if (!match?.[1]) return null;
  const rating = Number.parseInt(match[1], 10);
  return rating >= 1 && rating <= 5 ? rating : null;
}

function entryId(entry: FeedItem): string {
  return entry.guid ?? entry.link ?? `${entry.title ?? 'review'}:${entry.isoDate ?? entry.pubDate ?? ''}`;
}

export function normalizeWporgReview(args: {
  sourceKey: string;
  pluginSlug: string;
  entry: FeedItem;
}): Omit<Item, 'id'> {
  const rawBody = args.entry['content:encoded' as keyof FeedItem] as string | undefined;
  const html = rawBody ?? args.entry.content ?? args.entry.contentSnippet ?? '';
  const body = htmlToText(html);
  const created = args.entry.isoDate ?? args.entry.pubDate ?? new Date(0).toISOString();
  const author = args.entry.creator ?? args.entry.dc?.creator ?? null;
  return {
    sourceKey: args.sourceKey,
    sourceType: 'wporg-reviews',
    sourceId: entryId(args.entry),
    url: args.entry.link ?? `https://wordpress.org/support/plugin/${args.pluginSlug}/reviews/`,
    title: args.entry.title ?? 'Untitled review',
    body,
    author,
    createdAt: created,
    updatedAt: created,
    bodyHash: bodyHash(body),
    latestSnapshotHash: null,
    referenceOnly: false,
    metadata: {
      rating: ratingFromText(`${args.entry.title ?? ''} ${body}`),
      hasPluginAuthorResponse: /Plugin Author\s+[^:]+:/i.test(body) || /Moderator\s*:/i.test(body),
    },
    raw: args.entry,
  };
}

export class WporgReviewsSourceAdapter implements SourceAdapter {
  readonly sourceKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly config: WporgReviewsSourceConfig;
  private readonly parser = new Parser();

  constructor(args: { config: WporgReviewsSourceConfig; fetchImpl?: FetchLike | undefined }) {
    this.config = args.config;
    this.fetchImpl = args.fetchImpl ?? fetch;
    this.sourceKey = args.config.key ?? `wporg-reviews:${args.config.pluginSlug}`;
  }

  async *fetchItems(): AsyncIterable<Omit<Item, 'id'>> {
    const url = `https://wordpress.org/support/plugin/${this.config.pluginSlug}/reviews/feed/`;
    const xml = await fetchText(this.fetchImpl, url, {
      headers: { 'User-Agent': 'BacklogGardener/0.0 (+https://github.com/example-org/gardener)' },
    });
    const feed = await this.parser.parseString(xml);
    for (const entry of feed.items as FeedItem[]) {
      yield normalizeWporgReview({ sourceKey: this.sourceKey, pluginSlug: this.config.pluginSlug, entry });
    }
  }

  async *fetchReplies(_item: Item): AsyncIterable<Omit<Reply, 'id' | 'itemId'>> {
    // wp.org review replies are embedded in the review body for MVP purposes.
  }
}
