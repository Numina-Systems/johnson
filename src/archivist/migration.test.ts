// pattern: Imperative Shell (test)

import { test, expect, describe } from 'bun:test';
import { createStore } from '@/store/store.ts';
import { migrateRefsFromKnowledge } from './migration.ts';

describe('migrateRefsFromKnowledge', () => {
  test('migrates document with PDF source marker from knowledge to ref prefix', () => {
    const store = createStore(':memory:');
    const content = '<!-- source: book.pdf -->\nSome content';

    store.docUpsert('knowledge:book', content);

    const result = migrateRefsFromKnowledge(store);

    expect(result.migrated).toBe(1);
    expect(result.skipped).toBe(false);

    // Original should be deleted
    expect(store.docGet('knowledge:book')).toBeNull();

    // New one should exist with same content
    const migrated = store.docGet('ref:book');
    expect(migrated).not.toBeNull();
    expect(migrated?.content).toBe(content);
  });

  test('migrates document with EPUB source marker', () => {
    const store = createStore(':memory:');
    const content = '<!-- source: guide.epub -->\nGuide content';

    store.docUpsert('knowledge:guide', content);

    const result = migrateRefsFromKnowledge(store);

    expect(result.migrated).toBe(1);
    expect(store.docGet('ref:guide')).not.toBeNull();
  });

  test('migrates document with 10+ chunks even without source marker', () => {
    const store = createStore(':memory:');
    const content = 'Large document content';

    store.docUpsert('knowledge:large', content);

    // Add exactly 10 chunks
    for (let i = 0; i < 10; i++) {
      store.docUpsert(`knowledge:large:chunk:${i}`, `Chunk ${i}`);
    }

    const result = migrateRefsFromKnowledge(store);

    expect(result.migrated).toBe(1);
    expect(store.docGet('ref:large')).not.toBeNull();
  });

  test('renames chunks from knowledge:* to ref:*', () => {
    const store = createStore(':memory:');
    const content = '<!-- source: book.pdf -->\nContent';

    store.docUpsert('knowledge:book', content);
    store.docUpsert('knowledge:book:chunk:0', 'First chunk');
    store.docUpsert('knowledge:book:chunk:1', 'Second chunk');

    migrateRefsFromKnowledge(store);

    // Old chunks deleted
    expect(store.docGet('knowledge:book:chunk:0')).toBeNull();
    expect(store.docGet('knowledge:book:chunk:1')).toBeNull();

    // New chunks exist
    expect(store.docGet('ref:book:chunk:0')?.content).toBe('First chunk');
    expect(store.docGet('ref:book:chunk:1')?.content).toBe('Second chunk');
  });

  test('deletes original knowledge:* document after migration', () => {
    const store = createStore(':memory:');
    store.docUpsert('knowledge:book', '<!-- source: book.pdf -->\nContent');

    migrateRefsFromKnowledge(store);

    expect(store.docGet('knowledge:book')).toBeNull();
  });

  test('second call is idempotent (no-op)', () => {
    const store = createStore(':memory:');
    store.docUpsert('knowledge:book', '<!-- source: book.pdf -->\nContent');

    const firstResult = migrateRefsFromKnowledge(store);
    expect(firstResult.migrated).toBe(1);
    expect(firstResult.skipped).toBe(false);

    const secondResult = migrateRefsFromKnowledge(store);
    expect(secondResult.migrated).toBe(0);
    expect(secondResult.skipped).toBe(true);
  });

  test('does not migrate non-reference knowledge:* documents', () => {
    const store = createStore(':memory:');
    const smallContent = 'Just a small note without 10 chunks';

    store.docUpsert('knowledge:small', smallContent);

    const result = migrateRefsFromKnowledge(store);

    expect(result.migrated).toBe(0);

    // Original should still exist
    expect(store.docGet('knowledge:small')).not.toBeNull();
    expect(store.docGet('ref:small')).toBeNull();
  });

  test('handles mixed knowledge documents (migrates references, keeps small docs)', () => {
    const store = createStore(':memory:');

    // Large reference with PDF source
    store.docUpsert('knowledge:pdf-book', '<!-- source: reference.pdf -->\nRef content');

    // Small doc without PDF source and no chunks
    store.docUpsert('knowledge:note', 'Small note');

    const result = migrateRefsFromKnowledge(store);

    expect(result.migrated).toBe(1);

    // PDF book migrated
    expect(store.docGet('ref:pdf-book')).not.toBeNull();
    expect(store.docGet('knowledge:pdf-book')).toBeNull();

    // Small note stays
    expect(store.docGet('knowledge:note')).not.toBeNull();
  });

  test('handles contiguous chunk numbering (0-indexed, no gaps)', () => {
    const store = createStore(':memory:');
    store.docUpsert('knowledge:doc', 'Large doc');

    // Add chunks with contiguous indices
    for (let i = 0; i < 11; i++) {
      store.docUpsert(`knowledge:doc:chunk:${i}`, `Chunk ${i}`);
    }

    const result = migrateRefsFromKnowledge(store);

    expect(result.migrated).toBe(1);

    // All chunks migrated
    for (let i = 0; i < 11; i++) {
      expect(store.docGet(`ref:doc:chunk:${i}`)?.content).toBe(`Chunk ${i}`);
      expect(store.docGet(`knowledge:doc:chunk:${i}`)).toBeNull();
    }
  });

  test('migration marker is set in archivist:ref-migration document', () => {
    const store = createStore(':memory:');
    store.docUpsert('knowledge:book', '<!-- source: book.pdf -->\nContent');

    migrateRefsFromKnowledge(store);

    const migrationDoc = store.docGet('archivist:ref-migration');
    expect(migrationDoc).not.toBeNull();
    expect(migrationDoc?.content).toContain('<!-- archivist-ref-migration-complete -->');
  });
});
