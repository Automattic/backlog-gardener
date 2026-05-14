import Parser from 'rss-parser';

import type { WporgForumSourceConfig } from '../config/index.js';
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

function slugFromLink(link: string | undefined): string | null {
  if (!link) return null;
  const match = /\/support\/topic\/([^/]+)\/?/.exec(link);
  return match?.[1] ?? null;
}

function entryId(entry: FeedItem): string {
  return entry.guid ?? entry.link ?? `${entry.title ?? 'thread'}:${entry.isoDate ?? entry.pubDate ?? ''}`;
}

function isResolved(title: string | undefined): boolean {
  return /\bresolved\b/i.test(title ?? '');
}

export function normalizeWporgForumTopic(args: {
  sourceKey: string;
  pluginSlug: string;
  entry: FeedItem;
}): Omit<Item, 'id'> {
  const rawBody = args.entry['content:encoded' as keyof FeedItem] as string | undefined;
  const html = rawBody ?? args.entry.content ?? args.entry.contentSnippet ?? '';
  const body = htmlToText(html);
  const created = args.entry.isoDate ?? args.entry.pubDate ?? new Date(0).toISOString();
  const topicSlug = slugFromLink(args.entry.link) ?? entryId(args.entry);
  return {
    sourceKey: args.sourceKey,
    sourceType: 'wporg-forum',
    sourceId: topicSlug,
    url: args.entry.link ?? `https://wordpress.org/support/plugin/${args.pluginSlug}/`,
    title: (args.entry.title ?? 'Untitled topic').replace(/^\[?Resolved\]?\s*/i, ''),
    body,
    author: args.entry.creator ?? args.entry.dc?.creator ?? null,
    createdAt: created,
    updatedAt: created,
    bodyHash: bodyHash(body),
    latestSnapshotHash: null,
    referenceOnly: false,
    metadata: { topicSlug, isResolved: isResolved(args.entry.title) },
    raw: args.entry,
  };
}

export function normalizeWporgForumReply(entry: FeedItem): Omit<Reply, 'id' | 'itemId'> {
  const rawBody = entry['content:encoded' as keyof FeedItem] as string | undefined;
  const html = rawBody ?? entry.content ?? entry.contentSnippet ?? '';
  const body = htmlToText(html);
  const created = entry.isoDate ?? entry.pubDate ?? new Date(0).toISOString();
  return {
    sourceReplyId: entryId(entry),
    author: entry.creator ?? entry.dc?.creator ?? null,
    body,
    createdAt: created,
    updatedAt: created,
    bodyHash: bodyHash(body),
    metadata: {
      isPluginAuthor: /Plugin Author/i.test(body),
      isModerator: /Moderator/i.test(body),
    },
    raw: entry,
  };
}

export class WporgForumSourceAdapter implements SourceAdapter {
  readonly sourceKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly config: WporgForumSourceConfig;
  private readonly parser = new Parser();

  constructor(args: { config: WporgForumSourceConfig; fetchImpl?: FetchLike | undefined }) {
    this.config = args.config;
    this.fetchImpl = args.fetchImpl ?? fetch;
    this.sourceKey = args.config.key ?? `wporg-forum:${args.config.pluginSlug}`;
  }

  async *fetchItems(): AsyncIterable<Omit<Item, 'id'>> {
    const url = `https://wordpress.org/support/plugin/${this.config.pluginSlug}/feed/`;
    const xml = await fetchText(this.fetchImpl, url, {
      headers: { 'User-Agent': 'BacklogGardener/0.0 (+https://github.com/example-org/gardener)' },
    });
    const feed = await this.parser.parseString(xml);
    for (const entry of feed.items as FeedItem[]) {
      yield normalizeWporgForumTopic({ sourceKey: this.sourceKey, pluginSlug: this.config.pluginSlug, entry });
    }
  }

  async *fetchReplies(item: Item): AsyncIterable<Omit<Reply, 'id' | 'itemId'>> {
    const topicSlug = typeof item.metadata.topicSlug === 'string' ? item.metadata.topicSlug : item.sourceId;
    const url = `https://wordpress.org/support/topic/${topicSlug}/feed/`;
    const xml = await fetchText(this.fetchImpl, url, {
      headers: { 'User-Agent': 'BacklogGardener/0.0 (+https://github.com/example-org/gardener)' },
    });
    const feed = await this.parser.parseString(xml);
    for (const entry of feed.items.slice(1) as FeedItem[]) {
      yield normalizeWporgForumReply(entry);
    }
  }
}
