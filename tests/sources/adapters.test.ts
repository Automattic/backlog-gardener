import { describe, expect, it } from 'vitest';

import { parseTriageProfile } from '../../src/gardener/config/index.js';
import { GitHubSourceAdapter } from '../../src/gardener/sources/github.js';
import { WporgForumSourceAdapter } from '../../src/gardener/sources/wporg-forum.js';
import { WporgReviewsSourceAdapter } from '../../src/gardener/sources/wporg-reviews.js';
import type { FetchLike } from '../../src/gardener/sources/http.js';

function response(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

const profile = parseTriageProfile({
  product: { name: 'Example Product', slug: 'example-product' },
  sources: [
    { type: 'github', host: 'github.com', repo: 'example-org/example-product' },
    { type: 'wporg-reviews', pluginSlug: 'example-product' },
    { type: 'wporg-forum', pluginSlug: 'example-product' },
  ],
  llm: {
    completion: { provider: 'anthropic', model: 'claude' },
    embedding: { provider: 'openai', model: 'embedding' },
  },
});

describe('source adapters', () => {
  it('fetches GitHub issues and comments with pagination-shaped requests', async () => {
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('/comments')) {
        return response([
          {
            id: 901001,
            body: 'Can you share details?',
            user: { login: 'support-engineer' },
            created_at: '2026-04-23T09:11:30Z',
            updated_at: '2026-04-23T09:11:30Z',
            author_association: 'MEMBER',
          },
        ]);
      }
      return response([
        {
          number: 8421,
          html_url: 'https://github.com/example-org/example-product/issues/8421',
          title: 'Apple Pay vanishes',
          body: 'Body',
          user: { login: 'merchant' },
          created_at: '2026-04-20T00:00:00Z',
          updated_at: '2026-04-21T00:00:00Z',
          state: 'open',
          author_association: 'NONE',
          labels: [],
        },
      ]);
    };
    const adapter = new GitHubSourceAdapter({ config: profile.sources[0] as never, fetchImpl });
    const items = [];
    for await (const item of adapter.fetchItems()) items.push(item);
    const replies = [];
    for await (const reply of adapter.fetchReplies({ ...items[0]!, id: 'itm_1' })) replies.push(reply);

    expect(items).toHaveLength(1);
    expect(replies[0]?.metadata.authorAssociation).toBe('MEMBER');
    expect(seen.some((url) => url.includes('/issues?'))).toBe(true);
    expect(seen.some((url) => url.includes('/comments?'))).toBe(true);
  });

  it('fetches wp.org reviews from RSS', async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><item><title>Rated 2 out of 5 stars</title><link>https://wordpress.org/support/topic/review/</link><guid>review-1</guid><pubDate>Wed, 29 Apr 2026 00:00:00 GMT</pubDate><description><![CDATA[<p>Checkout failed.</p>]]></description><dc:creator>merchant</dc:creator></item></channel></rss>`;
    const adapter = new WporgReviewsSourceAdapter({
      config: profile.sources[1] as never,
      fetchImpl: async () => response(xml),
    });
    const items = [];
    for await (const item of adapter.fetchItems()) items.push(item);

    expect(items[0]?.sourceType).toBe('wporg-reviews');
    expect(items[0]?.metadata.rating).toBe(2);
    expect(items[0]?.body).toContain('Checkout failed');
  });

  it('fetches wp.org forum topics and per-thread replies from RSS', async () => {
    const topicXml = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>[Resolved] Apple Pay vanishes</title><link>https://wordpress.org/support/topic/apple-pay-vanishes/</link><guid>topic-1</guid><pubDate>Wed, 29 Apr 2026 00:00:00 GMT</pubDate><description><![CDATA[<p>Button disappears.</p>]]></description></item></channel></rss>`;
    const replyXml = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>OP</title><link>https://wordpress.org/support/topic/apple-pay-vanishes/</link><guid>op</guid><pubDate>Wed, 29 Apr 2026 00:00:00 GMT</pubDate><description><![CDATA[OP]]></description></item><item><title>Reply</title><link>https://wordpress.org/support/topic/apple-pay-vanishes/#post-1</link><guid>reply-1</guid><pubDate>Wed, 29 Apr 2026 01:00:00 GMT</pubDate><description><![CDATA[<p>Plugin Author Foo: fixed.</p>]]></description></item></channel></rss>`;
    const fetchImpl: FetchLike = async (input) => response(String(input).includes('/topic/') ? replyXml : topicXml);
    const adapter = new WporgForumSourceAdapter({ config: profile.sources[2] as never, fetchImpl });
    const items = [];
    for await (const item of adapter.fetchItems()) items.push(item);
    const replies = [];
    for await (const reply of adapter.fetchReplies({ ...items[0]!, id: 'itm_1' })) replies.push(reply);

    expect(items[0]?.metadata.isResolved).toBe(true);
    expect(items[0]?.title).toBe('Apple Pay vanishes');
    expect(replies).toHaveLength(1);
    expect(replies[0]?.metadata.isPluginAuthor).toBe(true);
  });
});
