import type { Item, Reply } from '../domain.js';

export interface SourceAdapter {
  readonly sourceKey: string;
  fetchItems(): AsyncIterable<Omit<Item, 'id'>>;
  fetchItemsSince?(since: Date): AsyncIterable<Omit<Item, 'id'>>;
  fetchBackfillItems?(since?: Date): AsyncIterable<Omit<Item, 'id'>>;
  fetchReplies(item: Item): AsyncIterable<Omit<Reply, 'id' | 'itemId'>>;
}

export class FakeSourceAdapter implements SourceAdapter {
  constructor(
    readonly sourceKey: string,
    private readonly items: Array<Omit<Item, 'id'>>,
    private readonly repliesBySourceId: Map<string, Array<Omit<Reply, 'id' | 'itemId'>>> = new Map(),
  ) {}

  async *fetchItems(): AsyncIterable<Omit<Item, 'id'>> {
    for (const item of this.items) yield item;
  }

  async *fetchReplies(item: Item): AsyncIterable<Omit<Reply, 'id' | 'itemId'>> {
    for (const reply of this.repliesBySourceId.get(item.sourceId) ?? []) yield reply;
  }
}
