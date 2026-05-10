// pattern: Functional Core (test)

import { describe, test, expect } from 'bun:test';
import {
  computeChangeSet,
  filterMutable,
  isImmutable,
  createEmptySnapshot,
} from './state.ts';

describe('state module', () => {
  describe('isImmutable', () => {
    test('returns true for ref: prefix', () => {
      expect(isImmutable('ref:some-doc')).toBe(true);
    });

    test('returns true for skill: prefix', () => {
      expect(isImmutable('skill:my-skill')).toBe(true);
    });

    test('returns true for customtool: prefix', () => {
      expect(isImmutable('customtool:my-tool')).toBe(true);
    });

    test('returns false for knowledge: prefix', () => {
      expect(isImmutable('knowledge:article')).toBe(false);
    });

    test('returns false for archive: prefix', () => {
      expect(isImmutable('archive:2026-05-10')).toBe(false);
    });

    test('returns false for self', () => {
      expect(isImmutable('self')).toBe(false);
    });

    test('returns false for operator', () => {
      expect(isImmutable('operator')).toBe(false);
    });
  });

  describe('computeChangeSet', () => {
    test('archivist.AC5.4: first run with no previous snapshot treats all documents as added', () => {
      const current = {
        'knowledge:doc1': 'hash1',
        'knowledge:doc2': 'hash2',
      };

      const changeSet = computeChangeSet(current, undefined);

      expect(changeSet.added).toEqual(['knowledge:doc1', 'knowledge:doc2']);
      expect(changeSet.modified).toEqual([]);
      expect(changeSet.deleted).toEqual([]);
      expect(changeSet.unchanged).toEqual([]);
    });

    test('archivist.AC5.2: detects added documents', () => {
      const previous = {
        'knowledge:doc1': 'hash1',
      };
      const current = {
        'knowledge:doc1': 'hash1',
        'knowledge:doc2': 'hash2',
      };

      const changeSet = computeChangeSet(current, previous);

      expect(changeSet.added).toEqual(['knowledge:doc2']);
      expect(changeSet.modified).toEqual([]);
      expect(changeSet.deleted).toEqual([]);
      expect(changeSet.unchanged).toEqual(['knowledge:doc1']);
    });

    test('archivist.AC5.2: detects modified documents', () => {
      const previous = {
        'knowledge:doc1': 'old-hash',
      };
      const current = {
        'knowledge:doc1': 'new-hash',
      };

      const changeSet = computeChangeSet(current, previous);

      expect(changeSet.added).toEqual([]);
      expect(changeSet.modified).toEqual(['knowledge:doc1']);
      expect(changeSet.deleted).toEqual([]);
      expect(changeSet.unchanged).toEqual([]);
    });

    test('archivist.AC5.2: detects deleted documents', () => {
      const previous = {
        'knowledge:doc1': 'hash1',
        'knowledge:doc2': 'hash2',
      };
      const current = {
        'knowledge:doc1': 'hash1',
      };

      const changeSet = computeChangeSet(current, previous);

      expect(changeSet.added).toEqual([]);
      expect(changeSet.modified).toEqual([]);
      expect(changeSet.deleted).toEqual(['knowledge:doc2']);
      expect(changeSet.unchanged).toEqual(['knowledge:doc1']);
    });

    test('archivist.AC5.2: detects unchanged documents', () => {
      const previous = {
        'knowledge:doc1': 'hash1',
        'knowledge:doc2': 'hash2',
      };
      const current = {
        'knowledge:doc1': 'hash1',
        'knowledge:doc2': 'hash2',
      };

      const changeSet = computeChangeSet(current, previous);

      expect(changeSet.added).toEqual([]);
      expect(changeSet.modified).toEqual([]);
      expect(changeSet.deleted).toEqual([]);
      expect(changeSet.unchanged).toEqual(['knowledge:doc1', 'knowledge:doc2']);
    });

    test('handles mixed changes correctly', () => {
      const previous = {
        'knowledge:old': 'hash-old',
        'knowledge:shared': 'hash-shared',
        'knowledge:modified': 'hash-old-mod',
      };
      const current = {
        'knowledge:shared': 'hash-shared',
        'knowledge:modified': 'hash-new-mod',
        'knowledge:new': 'hash-new',
      };

      const changeSet = computeChangeSet(current, previous);

      expect(changeSet.added).toEqual(['knowledge:new']);
      expect(changeSet.modified).toEqual(['knowledge:modified']);
      expect(changeSet.deleted).toEqual(['knowledge:old']);
      expect(changeSet.unchanged).toEqual(['knowledge:shared']);
    });
  });

  describe('filterMutable', () => {
    test('removes immutable rkeys from added list', () => {
      const changeSet = {
        added: ['skill:my-skill', 'knowledge:article', 'ref:something'],
        modified: [],
        deleted: [],
        unchanged: [],
      };

      const filtered = filterMutable(changeSet);

      expect(filtered.added).toEqual(['knowledge:article']);
    });

    test('removes immutable rkeys from modified list', () => {
      const changeSet = {
        added: [],
        modified: ['skill:my-skill', 'knowledge:article', 'customtool:my-tool'],
        deleted: [],
        unchanged: [],
      };

      const filtered = filterMutable(changeSet);

      expect(filtered.modified).toEqual(['knowledge:article']);
    });

    test('removes immutable rkeys from deleted list', () => {
      const changeSet = {
        added: [],
        modified: [],
        deleted: ['ref:doc', 'knowledge:article'],
        unchanged: [],
      };

      const filtered = filterMutable(changeSet);

      expect(filtered.deleted).toEqual(['knowledge:article']);
    });

    test('preserves unchanged list as-is', () => {
      const changeSet = {
        added: [],
        modified: [],
        deleted: [],
        unchanged: ['skill:my-skill', 'knowledge:article'],
      };

      const filtered = filterMutable(changeSet);

      expect(filtered.unchanged).toEqual(['skill:my-skill', 'knowledge:article']);
    });

    test('filters all lists correctly', () => {
      const changeSet = {
        added: ['skill:added-skill', 'knowledge:added-doc'],
        modified: ['ref:modified-ref', 'knowledge:modified-doc'],
        deleted: ['customtool:deleted-tool', 'knowledge:deleted-doc'],
        unchanged: ['skill:unchanged-skill', 'knowledge:unchanged-doc'],
      };

      const filtered = filterMutable(changeSet);

      expect(filtered.added).toEqual(['knowledge:added-doc']);
      expect(filtered.modified).toEqual(['knowledge:modified-doc']);
      expect(filtered.deleted).toEqual(['knowledge:deleted-doc']);
      expect(filtered.unchanged).toEqual(['skill:unchanged-skill', 'knowledge:unchanged-doc']);
    });
  });

  describe('createEmptySnapshot', () => {
    test('creates snapshot with provided ISO timestamp', () => {
      const timestamp = '2026-05-10T12:34:56.789Z';
      const snapshot = createEmptySnapshot(timestamp);

      expect(snapshot.lastRun).toBe(timestamp);
    });

    test('creates snapshot with incremental mode', () => {
      const snapshot = createEmptySnapshot('2026-05-10T12:34:56.789Z');

      expect(snapshot.mode).toBe('incremental');
    });

    test('creates snapshot with empty documents', () => {
      const snapshot = createEmptySnapshot('2026-05-10T12:34:56.789Z');

      expect(snapshot.documents).toEqual({});
    });
  });
});
