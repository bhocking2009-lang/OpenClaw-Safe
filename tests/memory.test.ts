/**
 * Tests for the memory service.
 */

import { MemoryStore } from '../src/core/memory';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('stores and retrieves a memory item', () => {
    const item = store.store({
      namespace: 'agent-1',
      kind: 'factual',
      content: 'The user prefers Python over JavaScript.',
      sourceRefs: ['session:s-1:turn:3'],
      confidence: 0.9,
      redactClass: 'internal',
    });

    expect(item.id).toBeTruthy();
    expect(item.kind).toBe('factual');
    expect(item.confidence).toBe(0.9);

    const fetched = store.getById(item.id);
    expect(fetched).toEqual(item);
  });

  it('returns undefined for unknown id', () => {
    expect(store.getById('nonexistent')).toBeUndefined();
  });

  it('queries by namespace', () => {
    store.store({ namespace: 'ns-1', kind: 'factual', content: 'fact 1' });
    store.store({ namespace: 'ns-1', kind: 'preference', content: 'pref 1' });
    store.store({ namespace: 'ns-2', kind: 'factual', content: 'fact 2' });

    const results = store.query({ namespace: 'ns-1' });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.namespace === 'ns-1')).toBe(true);
  });

  it('queries by kind', () => {
    store.store({ namespace: 'ns-1', kind: 'factual', content: 'fact' });
    store.store({ namespace: 'ns-1', kind: 'transcript', content: 'turn' });

    const results = store.query({ kind: 'factual' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.kind === 'factual')).toBe(true);
  });

  it('queries by minimum confidence', () => {
    store.store({ namespace: 'ns-1', kind: 'factual', content: 'high conf', confidence: 0.9 });
    store.store({ namespace: 'ns-1', kind: 'factual', content: 'low conf', confidence: 0.3 });

    const results = store.query({ minConfidence: 0.8 });
    expect(results.every((r) => r.confidence >= 0.8)).toBe(true);
  });

  it('respects limit in query', () => {
    for (let i = 0; i < 5; i++) {
      store.store({ namespace: 'ns-limit', kind: 'factual', content: `fact ${i}` });
    }
    const results = store.query({ namespace: 'ns-limit', limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('deletes an item by id', () => {
    const item = store.store({ namespace: 'ns-1', kind: 'factual', content: 'to delete' });
    store.deleteById(item.id);
    expect(store.getById(item.id)).toBeUndefined();
  });

  it('deletes all items in a namespace', () => {
    store.store({ namespace: 'ns-del', kind: 'factual', content: 'a' });
    store.store({ namespace: 'ns-del', kind: 'preference', content: 'b' });
    store.store({ namespace: 'ns-keep', kind: 'factual', content: 'c' });

    store.deleteByNamespace('ns-del');
    expect(store.query({ namespace: 'ns-del' })).toHaveLength(0);
    expect(store.query({ namespace: 'ns-keep' })).toHaveLength(1);
  });

  it('stores source references and deserializes them', () => {
    const refs = ['session:s-1', 'artifact:art-1'];
    const item = store.store({
      namespace: 'ns-1',
      kind: 'document',
      content: 'content',
      sourceRefs: refs,
    });

    const fetched = store.getById(item.id)!;
    expect(fetched.sourceRefs).toEqual(refs);
  });
});
