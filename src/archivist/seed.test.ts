// pattern: Imperative Shell (test)

import { test, expect } from 'bun:test';
import { createStore } from '../store/store.ts';
import { seedArchivistIdentity, loadArchivistIdentity } from './seed.ts';

test('seedArchivistIdentity: first call creates archivist:identity document', () => {
  const store = createStore(':memory:');

  seedArchivistIdentity(store);

  const doc = store.docGet('archivist:identity');
  expect(doc).not.toBeNull();
  expect(doc?.content).toContain('archivist');
  expect(doc?.content).toContain('<!-- archivist-identity-seeded -->');
});

test('seedArchivistIdentity: second call is a no-op', () => {
  const store = createStore(':memory:');

  seedArchivistIdentity(store);
  const firstCall = store.docGet('archivist:identity');
  const firstContent = firstCall?.content ?? '';

  seedArchivistIdentity(store);
  const secondCall = store.docGet('archivist:identity');
  const secondContent = secondCall?.content ?? '';

  expect(firstContent).toBe(secondContent);
});

test('seedArchivistIdentity: existing identity with marker is not overwritten', () => {
  const store = createStore(':memory:');

  const existingContent = 'existing content\n\n<!-- archivist-identity-seeded -->\nmore stuff';
  store.docUpsert('archivist:identity', existingContent);

  seedArchivistIdentity(store);

  const doc = store.docGet('archivist:identity');
  expect(doc?.content).toBe(existingContent);
});

test('loadArchivistIdentity: returns content from archivist:identity', () => {
  const store = createStore(':memory:');

  seedArchivistIdentity(store);

  const content = loadArchivistIdentity(store);
  expect(content).toContain('archivist');
  expect(content).toContain('<!-- archivist-identity-seeded -->');
});

test('loadArchivistIdentity: returns empty string when no identity exists', () => {
  const store = createStore(':memory:');

  const content = loadArchivistIdentity(store);
  expect(content).toBe('');
});
