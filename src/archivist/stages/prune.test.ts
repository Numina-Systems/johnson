// pattern: Imperative Shell (test)

import { describe, test, expect } from 'bun:test';
import { createStore } from '@/store/store.ts';
import type { EmbeddingProvider } from '@/embedding/types.ts';
import type { SubAgentLLM } from '@/model/sub-agent.ts';
import type { BudgetTracker } from '../types.ts';
import { prune } from './prune.ts';

const mockEmbedding: EmbeddingProvider = {
  dimensions: 3,
  async embed(_text: string): Promise<Array<number>> {
    return [1, 0, 0];
  },
  async embedBatch(texts: ReadonlyArray<string>): Promise<Array<Array<number>>> {
    return texts.map(() => [1, 0, 0]);
  },
};

const mockSubAgent: SubAgentLLM = {
  async complete(_prompt: string, _system?: string): Promise<string> {
    return JSON.stringify({ subset: false });
  },
};

function createBudgetTracker(limit: number): BudgetTracker {
  return {
    limit,
    consumed: 0,
    breakdown: {},
    record(stage: string, tokens: number) {
      this.consumed += tokens;
      this.breakdown[stage] = (this.breakdown[stage] ?? 0) + tokens;
    },
    shouldContinue() {
      return this.consumed < this.limit;
    },
  };
}

describe('prune stage', () => {
  describe('archivist.AC2.6: Redundancy detection', () => {
    test('removes documents confirmed as strict information subsets', async () => {
      const store = createStore(':memory:');

      // Create a comprehensive document and a subset document
      store.docUpsert(
        'knowledge:comprehensive',
        'The quick brown fox jumps over the lazy dog. The fox is clever. The dog is lazy.',
      );
      store.docUpsert('knowledge:subset', 'The fox is clever.');

      // Save similar embeddings (subset would have high similarity to comprehensive)
      store.saveEmbedding('knowledge:comprehensive', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:subset', [0.94, 0.11, 0.05], 'test');

      const mockSubAgentConfirming: SubAgentLLM = {
        async complete(): Promise<string> {
          return JSON.stringify({ subset: true, superset: 'a' });
        },
      };

      const budget = createBudgetTracker(10000);
      await prune(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgentConfirming,
          threshold: 0.92,
          budget,
          systemPrompt: 'test',
        },
        {
          added: ['knowledge:comprehensive', 'knowledge:subset'],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      // Subset should be deleted
      expect(store.docGet('knowledge:subset')).toBeNull();
      // Comprehensive should remain
      expect(store.docGet('knowledge:comprehensive')).not.toBeNull();
    });

    test('leaves documents intact when sub-agent says not subset', async () => {
      const store = createStore(':memory:');

      store.docUpsert('knowledge:doc1', 'Content A with unique info');
      store.docUpsert('knowledge:doc2', 'Content B with different unique info');

      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:doc2', [0.94, 0.11, 0.05], 'test');

      const mockSubAgentRejecting: SubAgentLLM = {
        async complete(): Promise<string> {
          return JSON.stringify({ subset: false });
        },
      };

      const budget = createBudgetTracker(10000);
      await prune(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgentRejecting,
          threshold: 0.92,
          budget,
          systemPrompt: 'test',
        },
        {
          added: ['knowledge:doc1', 'knowledge:doc2'],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      // Both should remain
      expect(store.docGet('knowledge:doc1')).not.toBeNull();
      expect(store.docGet('knowledge:doc2')).not.toBeNull();
    });
  });

  describe('archivist.AC2.7: Orphaned chunk cleanup', () => {
    test('removes orphaned chunk documents when parent deleted', async () => {
      const store = createStore(':memory:');

      // Create a parent document with chunks (parent was already deleted)
      store.docUpsert('knowledge:doc1:chunk:0', 'Chunk 0');
      store.docUpsert('knowledge:doc1:chunk:1', 'Chunk 1');
      store.docUpsert('knowledge:doc1:chunk:2', 'Chunk 2');

      // Create valid document with chunks
      store.docUpsert('knowledge:doc2', 'Main content');
      store.docUpsert('knowledge:doc2:chunk:0', 'Chunk 0');

      const budget = createBudgetTracker(10000);
      const result = await prune(
        {
          store,
          embedding: undefined,
          subAgent: undefined,
          threshold: 0.92,
          budget,
          systemPrompt: 'test',
        },
        {
          added: [],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      // Orphaned chunks should be deleted
      expect(store.docGet('knowledge:doc1:chunk:0')).toBeNull();
      expect(store.docGet('knowledge:doc1:chunk:1')).toBeNull();
      expect(store.docGet('knowledge:doc1:chunk:2')).toBeNull();

      // Valid chunks should remain
      expect(store.docGet('knowledge:doc2')).not.toBeNull();
      expect(store.docGet('knowledge:doc2:chunk:0')).not.toBeNull();

      // Should have reported cleanup action
      expect(result.actions.some(a => a.includes('orphaned'))).toBe(true);
    });

    test('does not delete chunks when parent exists', async () => {
      const store = createStore(':memory:');

      store.docUpsert('knowledge:doc1', 'Main content');
      store.docUpsert('knowledge:doc1:chunk:0', 'Chunk 0');
      store.docUpsert('knowledge:doc1:chunk:1', 'Chunk 1');

      const budget = createBudgetTracker(10000);
      await prune(
        {
          store,
          embedding: undefined,
          subAgent: undefined,
          threshold: 0.92,
          budget,
          systemPrompt: 'test',
        },
        {
          added: [],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      // All should remain
      expect(store.docGet('knowledge:doc1')).not.toBeNull();
      expect(store.docGet('knowledge:doc1:chunk:0')).not.toBeNull();
      expect(store.docGet('knowledge:doc1:chunk:1')).not.toBeNull();
    });
  });

  describe('archivist.AC4.1/4.2/4.3: Immutability boundaries', () => {
    test('never modifies or deletes ref: documents', async () => {
      const store = createStore(':memory:');

      store.docUpsert('ref:document', 'Reference content');
      store.docUpsert('knowledge:doc1', 'Regular content');

      store.saveEmbedding('ref:document', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');

      const mockSubAgent: SubAgentLLM = {
        async complete(): Promise<string> {
          return JSON.stringify({ subset: true, superset: 'a' });
        },
      };

      const budget = createBudgetTracker(10000);
      await prune(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgent,
          threshold: 0.92,
          budget,
          systemPrompt: 'test',
        },
        {
          added: ['ref:document', 'knowledge:doc1'],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      // ref: should never be considered
      expect(store.docGet('ref:document')).not.toBeNull();
    });

    test('never modifies or deletes skill: documents', async () => {
      const store = createStore(':memory:');

      store.docUpsert('skill:helper', 'Skill code');
      store.docUpsert('knowledge:doc1', 'Regular content');

      store.saveEmbedding('skill:helper', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');

      const mockSubAgent: SubAgentLLM = {
        async complete(): Promise<string> {
          return JSON.stringify({ subset: true, superset: 'a' });
        },
      };

      const budget = createBudgetTracker(10000);
      await prune(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgent,
          threshold: 0.92,
          budget,
          systemPrompt: 'test',
        },
        {
          added: ['skill:helper', 'knowledge:doc1'],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      expect(store.docGet('skill:helper')).not.toBeNull();
    });

    test('never modifies or deletes customtool: documents', async () => {
      const store = createStore(':memory:');

      store.docUpsert('customtool:thing', 'Custom tool');
      store.docUpsert('knowledge:doc1', 'Regular content');

      store.saveEmbedding('customtool:thing', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');

      const mockSubAgent: SubAgentLLM = {
        async complete(): Promise<string> {
          return JSON.stringify({ subset: true, superset: 'a' });
        },
      };

      const budget = createBudgetTracker(10000);
      await prune(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgent,
          threshold: 0.92,
          budget,
          systemPrompt: 'test',
        },
        {
          added: ['customtool:thing', 'knowledge:doc1'],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      expect(store.docGet('customtool:thing')).not.toBeNull();
    });
  });

  describe('incremental mode filtering', () => {
    test('in incremental mode, only considers pairs where at least one side is in changeSet', async () => {
      const store = createStore(':memory:');

      // Create three documents: two that are similar, one unchanged and unrelated
      store.docUpsert(
        'knowledge:comprehensive',
        'The quick brown fox jumps over the lazy dog. The fox is clever. The dog is lazy.',
      );
      store.docUpsert('knowledge:subset', 'The fox is clever.');
      store.docUpsert('knowledge:unrelated', 'Something completely different');

      // Save embeddings
      store.saveEmbedding('knowledge:comprehensive', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:subset', [0.94, 0.11, 0.05], 'test');
      store.saveEmbedding('knowledge:unrelated', [0.1, 0.95, 0.05], 'test');

      const mockSubAgentConfirming: SubAgentLLM = {
        async complete(): Promise<string> {
          return JSON.stringify({ subset: true, superset: 'a' });
        },
      };

      const budget = createBudgetTracker(10000);

      // Run with incremental mode where neither comprehensive nor subset changed (both unchanged)
      const result = await prune(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgentConfirming,
          threshold: 0.92,
          budget,
          systemPrompt: 'test',
        },
        {
          added: ['knowledge:unrelated'],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'incremental',
      );

      // Should not process the pair because neither side is in changeSet (only unrelated was added)
      expect(result.actions.filter(a => a.includes('removed')).length).toBe(0);

      // Both documents should still exist
      expect(store.docGet('knowledge:comprehensive')).not.toBeNull();
      expect(store.docGet('knowledge:subset')).not.toBeNull();
    });

    test('in incremental mode, processes pair when both sides are in changeSet', async () => {
      const store = createStore(':memory:');

      store.docUpsert(
        'knowledge:comprehensive',
        'The quick brown fox jumps over the lazy dog. The fox is clever. The dog is lazy.',
      );
      store.docUpsert('knowledge:subset', 'The fox is clever.');

      store.saveEmbedding('knowledge:comprehensive', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:subset', [0.94, 0.11, 0.05], 'test');

      const mockSubAgentConfirming: SubAgentLLM = {
        async complete(): Promise<string> {
          return JSON.stringify({ subset: true, superset: 'a' });
        },
      };

      const budget = createBudgetTracker(10000);

      // Run with incremental mode where both changed
      const result = await prune(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgentConfirming,
          threshold: 0.92,
          budget,
          systemPrompt: 'test',
        },
        {
          added: ['knowledge:comprehensive', 'knowledge:subset'],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'incremental',
      );

      // Should process the pair
      expect(result.actions.filter(a => a.includes('removed')).length).toBeGreaterThan(0);

      // Subset should be deleted
      expect(store.docGet('knowledge:subset')).toBeNull();
      expect(store.docGet('knowledge:comprehensive')).not.toBeNull();
    });

    test('in incremental mode, processes pair when one side is modified', async () => {
      const store = createStore(':memory:');

      store.docUpsert(
        'knowledge:comprehensive',
        'The quick brown fox jumps over the lazy dog. The fox is clever. The dog is lazy.',
      );
      store.docUpsert('knowledge:subset', 'The fox is clever.');

      store.saveEmbedding('knowledge:comprehensive', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:subset', [0.94, 0.11, 0.05], 'test');

      const mockSubAgentConfirming: SubAgentLLM = {
        async complete(): Promise<string> {
          return JSON.stringify({ subset: true, superset: 'a' });
        },
      };

      const budget = createBudgetTracker(10000);

      // Run with incremental mode where comprehensive is modified
      const result = await prune(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgentConfirming,
          threshold: 0.92,
          budget,
          systemPrompt: 'test',
        },
        {
          added: [],
          modified: ['knowledge:comprehensive'],
          deleted: [],
          unchanged: [],
        },
        'incremental',
      );

      // Should process the pair (at least one side changed)
      expect(result.actions.filter(a => a.includes('removed')).length).toBeGreaterThan(0);
    });

    test('in full mode, processes all similar pairs regardless of changeSet', async () => {
      const store = createStore(':memory:');

      store.docUpsert(
        'knowledge:comprehensive',
        'The quick brown fox jumps over the lazy dog. The fox is clever. The dog is lazy.',
      );
      store.docUpsert('knowledge:subset', 'The fox is clever.');

      store.saveEmbedding('knowledge:comprehensive', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:subset', [0.94, 0.11, 0.05], 'test');

      const mockSubAgentConfirming: SubAgentLLM = {
        async complete(): Promise<string> {
          return JSON.stringify({ subset: true, superset: 'a' });
        },
      };

      const budget = createBudgetTracker(10000);

      // Run with full mode, but changeSet is empty
      const result = await prune(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgentConfirming,
          threshold: 0.92,
          budget,
          systemPrompt: 'test',
        },
        {
          added: [],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      // Should still process the pair in full mode
      expect(result.actions.filter(a => a.includes('removed')).length).toBeGreaterThan(0);

      // Subset should be deleted
      expect(store.docGet('knowledge:subset')).toBeNull();
    });
  });

  describe('graceful degradation', () => {
    test('skips redundancy detection when no embedding provider but cleans orphans', async () => {
      const store = createStore(':memory:');

      // Create orphaned chunks
      store.docUpsert('knowledge:orphan:chunk:0', 'Orphaned');
      // Create valid document
      store.docUpsert('knowledge:valid', 'Content');

      const budget = createBudgetTracker(10000);
      const result = await prune(
        {
          store,
          embedding: undefined,
          subAgent: mockSubAgent,
          threshold: 0.92,
          budget,
          systemPrompt: 'test',
        },
        {
          added: [],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      // Orphan should be cleaned
      expect(store.docGet('knowledge:orphan:chunk:0')).toBeNull();
      // Valid should remain
      expect(store.docGet('knowledge:valid')).not.toBeNull();
      // Should not skip (orphan cleanup still happens)
      expect(result.skipped).toBe(false);
    });

    test('skips redundancy detection when no sub-agent but cleans orphans', async () => {
      const store = createStore(':memory:');

      store.docUpsert('knowledge:orphan:chunk:0', 'Orphaned');
      store.docUpsert('knowledge:valid', 'Content');

      const budget = createBudgetTracker(10000);
      const result = await prune(
        {
          store,
          embedding: mockEmbedding,
          subAgent: undefined,
          threshold: 0.92,
          budget,
          systemPrompt: 'test',
        },
        {
          added: [],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      expect(store.docGet('knowledge:orphan:chunk:0')).toBeNull();
      expect(store.docGet('knowledge:valid')).not.toBeNull();
      expect(result.skipped).toBe(false);
    });

    test('works with neither embedding nor sub-agent (orphan cleanup only)', async () => {
      const store = createStore(':memory:');

      store.docUpsert('knowledge:orphan:chunk:0', 'Orphaned');
      store.docUpsert('knowledge:valid', 'Content');

      const budget = createBudgetTracker(10000);
      const result = await prune(
        {
          store,
          embedding: undefined,
          subAgent: undefined,
          threshold: 0.92,
          budget,
          systemPrompt: 'test',
        },
        {
          added: [],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      expect(store.docGet('knowledge:orphan:chunk:0')).toBeNull();
      expect(store.docGet('knowledge:valid')).not.toBeNull();
      expect(result.skipped).toBe(false);
    });
  });
});
