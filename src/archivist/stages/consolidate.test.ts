// pattern: Imperative Shell (test)

import { describe, it, expect } from 'bun:test';
import {
  extractDate,
  isArchiveRkey,
  isConsolidatedRkey,
  getCompressionDepth,
  groupArchivesByDate,
  buildConsolidatedRkey,
  buildConsolidationMarker,
} from './consolidate';

describe('consolidate.ts - pure functions', () => {
  describe('extractDate', () => {
    it('extracts YYYY-MM-DD from context compaction archive rkey', () => {
      const rkey = 'archive:2026-05-10T12-34-56';
      const result = extractDate(rkey);
      expect(result).toBe('2026-05-10');
    });

    it('extracts YYYY-MM-DD from session archive rkey', () => {
      const rkey = 'archive:session:my-session:2026-05-10T12-34';
      const result = extractDate(rkey);
      expect(result).toBe('2026-05-10');
    });

    it('returns null for non-archive rkeys', () => {
      const result = extractDate('skill:typescript-helpers');
      expect(result).toBeNull();
    });

    it('returns null for invalid date in rkey', () => {
      const result = extractDate('archive:2026-13-45T12-34-56');
      expect(result).toBeNull();
    });

    it('returns null for rkey without date pattern', () => {
      const result = extractDate('archive:something');
      expect(result).toBeNull();
    });
  });

  describe('isArchiveRkey', () => {
    it('returns true for context compaction archives', () => {
      expect(isArchiveRkey('archive:2026-05-10T12-34-56')).toBe(true);
    });

    it('returns true for session archives', () => {
      expect(isArchiveRkey('archive:session:my-session:2026-05-10T12-34')).toBe(true);
    });

    it('returns true for consolidated archives', () => {
      expect(isArchiveRkey('archive:consolidated:2026-05-10:2026-05-10T12-34-56')).toBe(true);
    });

    it('returns false for archivist prefixed documents', () => {
      expect(isArchiveRkey('archivist:state')).toBe(false);
    });

    it('returns false for other documents', () => {
      expect(isArchiveRkey('skill:typescript')).toBe(false);
    });
  });

  describe('isConsolidatedRkey', () => {
    it('returns true for consolidated archive rkey', () => {
      expect(isConsolidatedRkey('archive:consolidated:2026-05-10:2026-05-10T12-34-56')).toBe(true);
    });

    it('returns false for regular archive rkey', () => {
      expect(isConsolidatedRkey('archive:2026-05-10T12-34-56')).toBe(false);
    });

    it('returns false for session archive rkey', () => {
      expect(isConsolidatedRkey('archive:session:my-session:2026-05-10T12-34')).toBe(false);
    });
  });

  describe('getCompressionDepth', () => {
    it('returns 0 for un-consolidated documents', () => {
      const content = 'just some content';
      expect(getCompressionDepth(content)).toBe(0);
    });

    it('parses depth from consolidation marker', () => {
      const content = '<!-- archivist-consolidated: depth=1, sources=3, date=2026-05-10 -->\nContent here';
      expect(getCompressionDepth(content)).toBe(1);
    });

    it('parses depth 2', () => {
      const content = '<!-- archivist-consolidated: depth=2, sources=5, date=2026-05-10 -->\nContent';
      expect(getCompressionDepth(content)).toBe(2);
    });

    it('returns 0 when marker is malformed', () => {
      const content = '<!-- archivist-consolidated: sources=3 -->\nContent';
      expect(getCompressionDepth(content)).toBe(0);
    });
  });

  describe('groupArchivesByDate', () => {
    it('groups same-day archives together', () => {
      const documents = [
        { rkey: 'archive:2026-05-10T10-00-00', content: 'content1' },
        { rkey: 'archive:2026-05-10T14-30-00', content: 'content2' },
        { rkey: 'archive:session:session1:2026-05-10T16-45', content: 'content3' },
      ];

      const result = groupArchivesByDate(documents);

      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2026-05-10');
      expect(result[0].documents).toHaveLength(3);
    });

    it('separates archives by different dates', () => {
      const documents = [
        { rkey: 'archive:2026-05-10T10-00-00', content: 'content1' },
        { rkey: 'archive:2026-05-09T14-30-00', content: 'content2' },
        { rkey: 'archive:session:session1:2026-05-10T16-45', content: 'content3' },
      ];

      const result = groupArchivesByDate(documents);

      expect(result).toHaveLength(2);
      expect(result[0].date).toBe('2026-05-09');
      expect(result[0].documents).toHaveLength(1);
      expect(result[1].date).toBe('2026-05-10');
      expect(result[1].documents).toHaveLength(2);
    });

    it('ignores non-archive documents', () => {
      const documents = [
        { rkey: 'skill:typescript', content: 'skill content' },
        { rkey: 'archive:2026-05-10T10-00-00', content: 'archive content' },
        { rkey: 'knowledge:something', content: 'knowledge content' },
      ];

      const result = groupArchivesByDate(documents);

      expect(result).toHaveLength(1);
      expect(result[0].documents).toHaveLength(1);
    });

    it('ignores archives with unparseable dates', () => {
      const documents = [
        { rkey: 'archive:2026-05-10T10-00-00', content: 'content1' },
        { rkey: 'archive:invalid-date', content: 'content2' },
      ];

      const result = groupArchivesByDate(documents);

      expect(result).toHaveLength(1);
      expect(result[0].documents).toHaveLength(1);
    });

    it('sorts groups by date ascending', () => {
      const documents = [
        { rkey: 'archive:2026-05-12T10-00-00', content: 'content1' },
        { rkey: 'archive:2026-05-10T10-00-00', content: 'content2' },
        { rkey: 'archive:2026-05-11T10-00-00', content: 'content3' },
      ];

      const result = groupArchivesByDate(documents);

      expect(result).toHaveLength(3);
      expect(result[0].date).toBe('2026-05-10');
      expect(result[1].date).toBe('2026-05-11');
      expect(result[2].date).toBe('2026-05-12');
    });

    it('returns empty array when no archives present', () => {
      const documents = [
        { rkey: 'skill:typescript', content: 'skill content' },
        { rkey: 'knowledge:something', content: 'knowledge content' },
      ];

      const result = groupArchivesByDate(documents);

      expect(result).toHaveLength(0);
    });
  });

  describe('buildConsolidatedRkey', () => {
    it('builds rkey with date and current timestamp', () => {
      const date = '2026-05-10';
      const rkey = buildConsolidatedRkey(date);

      expect(rkey.startsWith('archive:consolidated:2026-05-10:2026-')).toBe(true);
      expect(rkey).toMatch(/^archive:consolidated:2026-05-10:\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
    });
  });

  describe('buildConsolidationMarker', () => {
    it('builds consolidation marker with correct format', () => {
      const marker = buildConsolidationMarker(1, 3, '2026-05-10');
      expect(marker).toBe('<!-- archivist-consolidated: depth=1, sources=3, date=2026-05-10 -->');
    });

    it('formats depth 0', () => {
      const marker = buildConsolidationMarker(0, 2, '2026-05-10');
      expect(marker).toBe('<!-- archivist-consolidated: depth=0, sources=2, date=2026-05-10 -->');
    });

    it('formats depth 2', () => {
      const marker = buildConsolidationMarker(2, 5, '2026-05-11');
      expect(marker).toBe('<!-- archivist-consolidated: depth=2, sources=5, date=2026-05-11 -->');
    });
  });
});
