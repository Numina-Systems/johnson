// pattern: Imperative Shell (test)

import { describe, it, expect, beforeEach } from 'bun:test';
import { createStore } from '@/store/store.ts';
import type { SubAgentLLM } from '@/model/sub-agent.ts';
import type { BudgetTracker } from '../types.ts';
import {
  extractDate,
  isArchiveRkey,
  isConsolidatedRkey,
  getCompressionDepth,
  groupArchivesByDate,
  buildConsolidatedRkey,
  buildConsolidationMarker,
  consolidate,
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

describe('consolidate() - integration', () => {
  let mockSubAgent: SubAgentLLM;
  let mockBudget: BudgetTracker;

  beforeEach(() => {
    mockSubAgent = {
      complete: async (prompt: string, system?: string): Promise<string> => {
        return `Synthesized: ${prompt.substring(0, 50)}...`;
      },
    };

    mockBudget = {
      limit: 10000,
      consumed: 0,
      breakdown: {},
      record: (stage: string, tokens: number) => {
        mockBudget.consumed += tokens;
        mockBudget.breakdown[stage] = (mockBudget.breakdown[stage] ?? 0) + tokens;
      },
      shouldContinue: () => true,
    };
  });

  it('archivist.AC2.3: consolidates two same-day archives into one document with marker', async () => {
    const store = createStore(':memory:');

    // Insert two archives from same day
    store.docUpsert('archive:2026-05-10T10-00-00', 'Archive content 1');
    store.docUpsert('archive:2026-05-10T14-30-00', 'Archive content 2');

    const changeSet = {
      added: ['archive:2026-05-10T10-00-00', 'archive:2026-05-10T14-30-00'],
      modified: [],
      deleted: [],
      unchanged: [],
    };

    const result = await consolidate(
      {
        store,
        subAgent: mockSubAgent,
        budget: mockBudget,
        systemPrompt: 'test',
      },
      changeSet,
      'incremental',
    );

    expect(result.stage).toBe('consolidate');
    expect(result.skipped).toBe(false);
    expect(result.actions.length).toBeGreaterThan(0);

    // Check that consolidated document exists
    const consolidatedDocs: Array<{ rkey: string; content: string }> = [];
    let cursor: string | undefined;
    do {
      const page = store.docList(500, cursor);
      consolidatedDocs.push(...page.documents);
      cursor = page.cursor;
    } while (cursor);

    const consolidated = consolidatedDocs.find(d => d.rkey.startsWith('archive:consolidated:'));
    expect(consolidated).toBeDefined();
    if (consolidated) {
      expect(consolidated.content).toContain('archivist-consolidated:');
      expect(consolidated.content).toContain('depth=1');
      expect(consolidated.content).toContain('sources=2');
    }
  });

  it('archivist.AC2.3: consolidated document contains sub-agent synthesis', async () => {
    const store = createStore(':memory:');

    store.docUpsert('archive:2026-05-10T10-00-00', 'Archive content 1');
    store.docUpsert('archive:2026-05-10T14-30-00', 'Archive content 2');

    const changeSet = {
      added: ['archive:2026-05-10T10-00-00', 'archive:2026-05-10T14-30-00'],
      modified: [],
      deleted: [],
      unchanged: [],
    };

    await consolidate(
      {
        store,
        subAgent: mockSubAgent,
        budget: mockBudget,
        systemPrompt: 'test',
      },
      changeSet,
      'incremental',
    );

    let cursor: string | undefined;
    const consolidatedDocs: Array<{ rkey: string; content: string }> = [];
    do {
      const page = store.docList(500, cursor);
      consolidatedDocs.push(...page.documents);
      cursor = page.cursor;
    } while (cursor);

    const consolidated = consolidatedDocs.find(d => d.rkey.startsWith('archive:consolidated:'));
    expect(consolidated).toBeDefined();
    if (consolidated) {
      expect(consolidated.content).toContain('Synthesized:');
    }
  });

  it('archivist.AC2.3: deletes original source documents after consolidation', async () => {
    const store = createStore(':memory:');

    const rkey1 = 'archive:2026-05-10T10-00-00';
    const rkey2 = 'archive:2026-05-10T14-30-00';
    store.docUpsert(rkey1, 'Archive content 1');
    store.docUpsert(rkey2, 'Archive content 2');

    const changeSet = {
      added: [rkey1, rkey2],
      modified: [],
      deleted: [],
      unchanged: [],
    };

    await consolidate(
      {
        store,
        subAgent: mockSubAgent,
        budget: mockBudget,
        systemPrompt: 'test',
      },
      changeSet,
      'incremental',
    );

    // Original documents should be deleted
    expect(store.docGet(rkey1)).toBeNull();
    expect(store.docGet(rkey2)).toBeNull();
  });

  it('single-archive day: no consolidation occurs', async () => {
    const store = createStore(':memory:');

    store.docUpsert('archive:2026-05-10T10-00-00', 'Archive content 1');

    const changeSet = {
      added: ['archive:2026-05-10T10-00-00'],
      modified: [],
      deleted: [],
      unchanged: [],
    };

    const result = await consolidate(
      {
        store,
        subAgent: mockSubAgent,
        budget: mockBudget,
        systemPrompt: 'test',
      },
      changeSet,
      'incremental',
    );

    // Single archive should not trigger consolidation
    expect(result.actions.every(a => !a.includes('consolidated'))).toBe(true);
    expect(store.docGet('archive:2026-05-10T10-00-00')).toBeDefined();
  });

  it('archivist.AC2.3: progressive compression - depth=1 gets further compressed to depth=2 on full sweep', async () => {
    const store = createStore(':memory:');

    // Create a depth=1 consolidated document
    const consolidatedContent =
      '<!-- archivist-consolidated: depth=1, sources=2, date=2026-05-10 -->\nSynthesized content';
    store.docUpsert('archive:consolidated:2026-05-10:2026-05-10T10-00-00', consolidatedContent);

    const changeSet = {
      added: [],
      modified: [],
      deleted: [],
      unchanged: [],
    };

    const result = await consolidate(
      {
        store,
        subAgent: mockSubAgent,
        budget: mockBudget,
        systemPrompt: 'test',
      },
      changeSet,
      'full',
    );

    expect(result.skipped).toBe(false);

    // Check that re-compression occurred
    const doc = store.docGet('archive:consolidated:2026-05-10:2026-05-10T10-00-00');
    expect(doc).toBeDefined();
    if (doc) {
      expect(doc.content).toContain('depth=2');
    }
  });

  it('no sub-agent: stage is skipped', async () => {
    const store = createStore(':memory:');

    store.docUpsert('archive:2026-05-10T10-00-00', 'Archive content 1');
    store.docUpsert('archive:2026-05-10T14-30-00', 'Archive content 2');

    const changeSet = {
      added: ['archive:2026-05-10T10-00-00', 'archive:2026-05-10T14-30-00'],
      modified: [],
      deleted: [],
      unchanged: [],
    };

    const result = await consolidate(
      {
        store,
        subAgent: undefined as any,
        budget: mockBudget,
        systemPrompt: 'test',
      },
      changeSet,
      'incremental',
    );

    expect(result.skipped).toBe(true);
  });

  it('incremental mode: skips groups without changed documents', async () => {
    const store = createStore(':memory:');

    store.docUpsert('archive:2026-05-10T10-00-00', 'Archive content 1');
    store.docUpsert('archive:2026-05-10T14-30-00', 'Archive content 2');

    const changeSet = {
      added: [],
      modified: [],
      deleted: [],
      unchanged: [
        'archive:2026-05-10T10-00-00',
        'archive:2026-05-10T14-30-00',
      ],
    };

    const result = await consolidate(
      {
        store,
        subAgent: mockSubAgent,
        budget: mockBudget,
        systemPrompt: 'test',
      },
      changeSet,
      'incremental',
    );

    // Should skip consolidation for unchanged archives
    expect(result.actions.every(a => !a.includes('consolidated'))).toBe(true);
  });
});
