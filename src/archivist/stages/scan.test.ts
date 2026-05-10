// pattern: Imperative Shell (test)

import { describe, test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { createStore } from '@/store/store.ts';
import { scan } from './scan.ts';
import { saveSnapshot, createEmptySnapshot, loadSnapshot } from '../state.ts';

describe('scan stage', () => {
  describe('archivist.AC5.4: First scan', () => {
    test('with empty store produces empty ChangeSet', () => {
      const store = createStore(':memory:');
      const result = scan(store, 'incremental');

      expect(result.changeSet.added).toEqual([]);
      expect(result.changeSet.modified).toEqual([]);
      expect(result.changeSet.deleted).toEqual([]);
      expect(result.changeSet.unchanged).toEqual([]);
      expect(result.currentHashes).toEqual({});
    });

    test('with documents and no prior snapshot treats all as added', () => {
      const store = createStore(':memory:');
      store.docUpsert('knowledge:doc1', 'content1');
      store.docUpsert('knowledge:doc2', 'content2');

      const result = scan(store, 'incremental');

      expect(result.changeSet.added.length).toBe(2);
      expect(result.changeSet.added).toContain('knowledge:doc1');
      expect(result.changeSet.added).toContain('knowledge:doc2');
      expect(result.changeSet.modified).toEqual([]);
      expect(result.changeSet.deleted).toEqual([]);
      expect(result.changeSet.unchanged).toEqual([]);
    });
  });

  describe('archivist.AC5.2: Incremental scan detects', () => {
    test('added documents', () => {
      const store = createStore(':memory:');
      store.docUpsert('knowledge:doc1', 'content1');
      store.docUpsert('knowledge:doc2', 'content2');

      // Save snapshot with just doc1
      const snapshot = createEmptySnapshot('2026-05-10T00:00:00Z');
      const doc1Hash = createHash('sha256').update('content1').digest('hex');
      saveSnapshot(store, {
        ...snapshot,
        documents: { 'knowledge:doc1': doc1Hash },
      });

      const result = scan(store, 'incremental');

      expect(result.changeSet.added).toContain('knowledge:doc2');
      expect(result.changeSet.modified).toEqual([]);
      expect(result.changeSet.deleted).toEqual([]);
      expect(result.changeSet.unchanged).toContain('knowledge:doc1');
    });

    test('modified documents', () => {
      const store = createStore(':memory:');
      store.docUpsert('knowledge:doc1', 'new-content');

      // Save snapshot with old content hash
      const snapshot = createEmptySnapshot('2026-05-10T00:00:00Z');
      saveSnapshot(store, {
        ...snapshot,
        documents: { 'knowledge:doc1': 'old-hash-value' },
      });

      const result = scan(store, 'incremental');

      expect(result.changeSet.added).toEqual([]);
      expect(result.changeSet.modified).toContain('knowledge:doc1');
      expect(result.changeSet.deleted).toEqual([]);
    });

    test('deleted documents', () => {
      const store = createStore(':memory:');
      store.docUpsert('knowledge:doc1', 'content1');

      // Save snapshot with two documents
      const snapshot = createEmptySnapshot('2026-05-10T00:00:00Z');
      const doc1Hash = createHash('sha256').update('content1').digest('hex');
      const doc2Hash = 'different-hash';
      saveSnapshot(store, {
        ...snapshot,
        documents: { 'knowledge:doc1': doc1Hash, 'knowledge:doc2': doc2Hash },
      });

      const result = scan(store, 'incremental');

      expect(result.changeSet.added).toEqual([]);
      expect(result.changeSet.modified).toEqual([]);
      expect(result.changeSet.deleted).toContain('knowledge:doc2');
      expect(result.changeSet.unchanged).toContain('knowledge:doc1');
    });

    test('unchanged documents', () => {
      const store = createStore(':memory:');
      store.docUpsert('knowledge:doc1', 'content1');
      store.docUpsert('knowledge:doc2', 'content2');

      // Calculate actual hashes
      const hash1 = createHash('sha256').update('content1').digest('hex');
      const hash2 = createHash('sha256').update('content2').digest('hex');

      // Save snapshot with same hashes
      const snapshot = createEmptySnapshot('2026-05-10T00:00:00Z');
      saveSnapshot(store, {
        ...snapshot,
        documents: { 'knowledge:doc1': hash1, 'knowledge:doc2': hash2 },
      });

      const result = scan(store, 'incremental');

      expect(result.changeSet.added).toEqual([]);
      expect(result.changeSet.modified).toEqual([]);
      expect(result.changeSet.deleted).toEqual([]);
      expect(result.changeSet.unchanged).toContain('knowledge:doc1');
      expect(result.changeSet.unchanged).toContain('knowledge:doc2');
    });
  });

  describe('archivist.AC5.3: Full sweep mode', () => {
    test('treats all documents as added regardless of snapshot', () => {
      const store = createStore(':memory:');
      store.docUpsert('knowledge:doc1', 'content1');
      store.docUpsert('knowledge:doc2', 'content2');

      // Save snapshot with these documents
      const snapshot = createEmptySnapshot('2026-05-10T00:00:00Z');
      const hash1 = 'hash1-value';
      const hash2 = 'hash2-value';
      saveSnapshot(store, {
        ...snapshot,
        documents: { 'knowledge:doc1': hash1, 'knowledge:doc2': hash2 },
      });

      const result = scan(store, 'full');

      expect(result.changeSet.added.length).toBe(2);
      expect(result.changeSet.added).toContain('knowledge:doc1');
      expect(result.changeSet.added).toContain('knowledge:doc2');
      expect(result.changeSet.modified).toEqual([]);
      expect(result.changeSet.deleted).toEqual([]);
      expect(result.changeSet.unchanged).toEqual([]);
    });
  });

  describe('archivist.AC4: Immutable prefixes filtering', () => {
    test('filters ref: prefix from added mutations', () => {
      const store = createStore(':memory:');
      store.docUpsert('ref:book1', 'ref-content');
      store.docUpsert('knowledge:doc1', 'doc-content');

      // Save snapshot with both docs so ref stays unchanged
      const snapshot = createEmptySnapshot('2026-05-10T00:00:00Z');
      const refHash = createHash('sha256').update('ref-content').digest('hex');
      const docHash = createHash('sha256').update('doc-content').digest('hex');
      saveSnapshot(store, {
        ...snapshot,
        documents: { 'ref:book1': refHash, 'knowledge:doc1': docHash },
      });

      const result = scan(store, 'incremental');

      expect(result.changeSet.added).toEqual([]);
      expect(result.changeSet.modified).toEqual([]);
      expect(result.changeSet.deleted).toEqual([]);
      expect(result.changeSet.unchanged).toContain('ref:book1');
      expect(result.changeSet.unchanged).toContain('knowledge:doc1');
    });

    test('filters skill: prefix from added mutations', () => {
      const store = createStore(':memory:');
      store.docUpsert('skill:my-skill', 'skill-content');
      store.docUpsert('knowledge:doc1', 'doc-content');

      // Save snapshot with both docs
      const snapshot = createEmptySnapshot('2026-05-10T00:00:00Z');
      const skillHash = createHash('sha256').update('skill-content').digest('hex');
      const docHash = createHash('sha256').update('doc-content').digest('hex');
      saveSnapshot(store, {
        ...snapshot,
        documents: { 'skill:my-skill': skillHash, 'knowledge:doc1': docHash },
      });

      const result = scan(store, 'incremental');

      expect(result.changeSet.added).toEqual([]);
      expect(result.changeSet.modified).toEqual([]);
      expect(result.changeSet.deleted).toEqual([]);
      expect(result.changeSet.unchanged).toContain('skill:my-skill');
      expect(result.changeSet.unchanged).toContain('knowledge:doc1');
    });

    test('filters customtool: prefix from added mutations', () => {
      const store = createStore(':memory:');
      store.docUpsert('customtool:my-tool', 'tool-content');
      store.docUpsert('knowledge:doc1', 'doc-content');

      // Save snapshot with both docs
      const snapshot = createEmptySnapshot('2026-05-10T00:00:00Z');
      const toolHash = createHash('sha256').update('tool-content').digest('hex');
      const docHash = createHash('sha256').update('doc-content').digest('hex');
      saveSnapshot(store, {
        ...snapshot,
        documents: { 'customtool:my-tool': toolHash, 'knowledge:doc1': docHash },
      });

      const result = scan(store, 'incremental');

      expect(result.changeSet.added).toEqual([]);
      expect(result.changeSet.modified).toEqual([]);
      expect(result.changeSet.deleted).toEqual([]);
      expect(result.changeSet.unchanged).toContain('customtool:my-tool');
      expect(result.changeSet.unchanged).toContain('knowledge:doc1');
    });

    test('immutable docs removed from added list in first scan', () => {
      const store = createStore(':memory:');
      store.docUpsert('ref:book', 'ref-content');
      store.docUpsert('skill:test', 'skill-content');
      store.docUpsert('customtool:foo', 'tool-content');
      store.docUpsert('knowledge:doc1', 'doc-content');

      // No snapshot, so all would normally be added
      const result = scan(store, 'incremental');

      // Knowledge doc is in added, immutable docs are filtered out
      expect(result.changeSet.added).toContain('knowledge:doc1');
      expect(result.changeSet.added).not.toContain('ref:book');
      expect(result.changeSet.added).not.toContain('skill:test');
      expect(result.changeSet.added).not.toContain('customtool:foo');
    });

    test('filters skill: prefix from modified mutations', () => {
      const store = createStore(':memory:');
      store.docUpsert('skill:my-skill', 'new-content');
      store.docUpsert('knowledge:doc1', 'doc-content');

      // Save snapshot with old skill content and matching doc1
      const snapshot = createEmptySnapshot('2026-05-10T00:00:00Z');
      const docHash = createHash('sha256').update('doc-content').digest('hex');
      saveSnapshot(store, {
        ...snapshot,
        documents: { 'skill:my-skill': 'old-skill-hash', 'knowledge:doc1': docHash },
      });

      const result = scan(store, 'incremental');

      // Skill should NOT appear in modified (filtered out), doc1 unchanged
      expect(result.changeSet.modified).not.toContain('skill:my-skill');
      expect(result.changeSet.added).toEqual([]);
      expect(result.changeSet.deleted).toEqual([]);
      expect(result.changeSet.unchanged).toContain('knowledge:doc1');
    });

    test('filters ref: prefix from deleted mutations', () => {
      const store = createStore(':memory:');
      store.docUpsert('knowledge:doc1', 'doc-content');

      // Save snapshot with a ref: doc that was removed
      const snapshot = createEmptySnapshot('2026-05-10T00:00:00Z');
      const docHash = createHash('sha256').update('doc-content').digest('hex');
      saveSnapshot(store, {
        ...snapshot,
        documents: { 'ref:book': 'ref-hash', 'knowledge:doc1': docHash },
      });

      const result = scan(store, 'incremental');

      // ref:book should NOT appear in deleted (filtered out)
      expect(result.changeSet.deleted).not.toContain('ref:book');
      expect(result.changeSet.added).toEqual([]);
      expect(result.changeSet.modified).toEqual([]);
      expect(result.changeSet.unchanged).toContain('knowledge:doc1');
    });

    test('filters customtool: prefix from deleted mutations', () => {
      const store = createStore(':memory:');
      store.docUpsert('knowledge:doc1', 'doc-content');

      // Save snapshot with a customtool: doc that was removed
      const snapshot = createEmptySnapshot('2026-05-10T00:00:00Z');
      const docHash = createHash('sha256').update('doc-content').digest('hex');
      saveSnapshot(store, {
        ...snapshot,
        documents: { 'customtool:my-tool': 'tool-hash', 'knowledge:doc1': docHash },
      });

      const result = scan(store, 'incremental');

      // customtool:my-tool should NOT appear in deleted (filtered out)
      expect(result.changeSet.deleted).not.toContain('customtool:my-tool');
      expect(result.changeSet.added).toEqual([]);
      expect(result.changeSet.modified).toEqual([]);
      expect(result.changeSet.unchanged).toContain('knowledge:doc1');
    });
  });

  describe('state persistence', () => {
    test('archivist.AC5.1: saveSnapshot persists to archivist:state document', () => {
      const store = createStore(':memory:');
      const snapshot = createEmptySnapshot('2026-05-10T00:00:00Z');

      saveSnapshot(store, snapshot);

      const loaded = store.docGet('archivist:state');
      expect(loaded).not.toBeNull();
      expect(loaded!.content).toBe(JSON.stringify(snapshot));
    });

    test('loadSnapshot returns null when no state document exists', () => {
      const store = createStore(':memory:');

      const snapshot = loadSnapshot(store);

      expect(snapshot).toBeNull();
    });

    test('loadSnapshot reads persisted snapshot correctly', () => {
      const store = createStore(':memory:');
      const originalSnapshot = {
        lastRun: '2026-05-10T00:00:00Z',
        mode: 'incremental' as const,
        documents: { 'knowledge:doc1': 'hash1' },
      };

      saveSnapshot(store, originalSnapshot);
      const loaded = loadSnapshot(store);

      expect(loaded).toEqual(originalSnapshot);
    });
  });

  describe('StageResult', () => {
    test('returns stageResult with scan metadata', () => {
      const store = createStore(':memory:');
      store.docUpsert('knowledge:doc1', 'content1');
      store.docUpsert('knowledge:doc2', 'content2');

      const result = scan(store, 'incremental');

      expect(result.stageResult.stage).toBe('scan');
      expect(result.stageResult.tokensUsed).toBe(0);
      expect(result.stageResult.skipped).toBe(false);
      expect(result.stageResult.actions.length).toBeGreaterThan(0);
      expect(result.stageResult.actions[0]).toContain('scanned');
      expect(result.stageResult.actions[0]).toContain('2 documents');
      expect(result.stageResult.actions[0]).toContain('2 changes');
    });

    test('counts unchanged documents correctly in action message', () => {
      const store = createStore(':memory:');
      store.docUpsert('knowledge:doc1', 'content1');
      store.docUpsert('knowledge:doc2', 'content2');

      // Calculate actual hashes
      const hash1 = createHash('sha256').update('content1').digest('hex');
      const hash2 = createHash('sha256').update('content2').digest('hex');

      // Save snapshot with same hashes so both are unchanged
      const snapshot = createEmptySnapshot('2026-05-10T00:00:00Z');
      saveSnapshot(store, {
        ...snapshot,
        documents: { 'knowledge:doc1': hash1, 'knowledge:doc2': hash2 },
      });

      const result = scan(store, 'incremental');

      expect(result.stageResult.actions[0]).toContain('scanned 2 documents');
      expect(result.stageResult.actions[0]).toContain('0 changes');
    });
  });
});
