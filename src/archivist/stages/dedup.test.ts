// pattern: Imperative Shell (test)

import { describe, test, expect, beforeEach } from 'bun:test';
import { createStore } from '@/store/store.ts';
import type { EmbeddingProvider } from '@/embedding/types.ts';
import type { SubAgentLLM } from '@/model/sub-agent.ts';
import type { BudgetTracker } from '../types.ts';
import { dedup } from './dedup.ts';

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
    return JSON.stringify({ duplicate: true, keep: 'a' });
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

describe('dedup stage', () => {
  describe('archivist.AC2.1: Identify similar pairs', () => {
    test('finds documents with embedding similarity >= threshold', async () => {
      const store = createStore(':memory:');

      // Create two very similar documents
      store.docUpsert('knowledge:doc1', 'The quick brown fox');
      store.docUpsert('knowledge:doc2', 'The quick brown fox');

      // Save embeddings (identical)
      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:doc2', [0.95, 0.1, 0.05], 'test');

      const mockSubAgentConfirming: SubAgentLLM = {
        async complete(): Promise<string> {
          return JSON.stringify({ duplicate: true, keep: 'a' });
        },
      };

      const budget = createBudgetTracker(10000);
      const result = await dedup(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgentConfirming,
          threshold: 0.88,
          budget,
          systemPrompt: 'test',
        },
        { added: ['knowledge:doc1', 'knowledge:doc2'], modified: [], deleted: [], unchanged: [] },
        'full',
      );

      expect(result.stage).toBe('dedup');
      expect(result.skipped).toBe(false);
      // Should have processed the similar pair
      expect(result.actions.length).toBeGreaterThan(0);
    });
  });

  describe('archivist.AC2.2: Merge duplicates', () => {
    test('merges confirmed duplicates with merged-from marker', async () => {
      const store = createStore(':memory:');

      store.docUpsert('knowledge:doc1', 'Short content');
      store.docUpsert('knowledge:doc2', 'Much longer content that is more complete');

      // Save similar embeddings
      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:doc2', [0.95, 0.1, 0.05], 'test');

      const mockSubAgentConfirming: SubAgentLLM = {
        async complete(): Promise<string> {
          return JSON.stringify({ duplicate: true, keep: 'b' });
        },
      };

      const budget = createBudgetTracker(10000);
      await dedup(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgentConfirming,
          threshold: 0.88,
          budget,
          systemPrompt: 'test',
        },
        { added: ['knowledge:doc1', 'knowledge:doc2'], modified: [], deleted: [], unchanged: [] },
        'full',
      );

      // Check that doc2 (winner) has marker
      const winnerDoc = store.docGet('knowledge:doc2');
      expect(winnerDoc).not.toBeNull();
      expect(winnerDoc!.content).toContain('<!-- merged-from: knowledge:doc1');

      // Check that doc1 (loser) is deleted
      const loserDoc = store.docGet('knowledge:doc1');
      expect(loserDoc).toBeNull();
    });

    test('deletes loser and its chunks', async () => {
      const store = createStore(':memory:');

      store.docUpsert('knowledge:doc1', 'Content');
      store.docUpsert('knowledge:doc1:chunk:0', 'Chunk 0');
      store.docUpsert('knowledge:doc1:chunk:1', 'Chunk 1');
      store.docUpsert('knowledge:doc2', 'Other content');

      // Save similar embeddings
      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:doc2', [0.95, 0.1, 0.05], 'test');

      const mockSubAgentConfirming: SubAgentLLM = {
        async complete(): Promise<string> {
          return JSON.stringify({ duplicate: true, keep: 'b' });
        },
      };

      const budget = createBudgetTracker(10000);
      await dedup(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgentConfirming,
          threshold: 0.88,
          budget,
          systemPrompt: 'test',
        },
        { added: ['knowledge:doc1', 'knowledge:doc2'], modified: [], deleted: [], unchanged: [] },
        'full',
      );

      // Verify loser and chunks deleted
      expect(store.docGet('knowledge:doc1')).toBeNull();
      expect(store.docGet('knowledge:doc1:chunk:0')).toBeNull();
      expect(store.docGet('knowledge:doc1:chunk:1')).toBeNull();
      expect(store.docGet('knowledge:doc2')).not.toBeNull();
    });
  });

  describe('archivist.AC2.10: Uncertain sub-agent response', () => {
    test('leaves documents separate when sub-agent says not duplicate', async () => {
      const store = createStore(':memory:');

      store.docUpsert('knowledge:doc1', 'Content A');
      store.docUpsert('knowledge:doc2', 'Content B');

      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:doc2', [0.95, 0.1, 0.05], 'test');

      const mockSubAgentRejecting: SubAgentLLM = {
        async complete(): Promise<string> {
          return JSON.stringify({ duplicate: false });
        },
      };

      const budget = createBudgetTracker(10000);
      await dedup(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgentRejecting,
          threshold: 0.88,
          budget,
          systemPrompt: 'test',
        },
        { added: ['knowledge:doc1', 'knowledge:doc2'], modified: [], deleted: [], unchanged: [] },
        'full',
      );

      // Both should still exist
      expect(store.docGet('knowledge:doc1')).not.toBeNull();
      expect(store.docGet('knowledge:doc2')).not.toBeNull();
    });

    test('leaves documents separate when sub-agent returns unparseable response', async () => {
      const store = createStore(':memory:');

      store.docUpsert('knowledge:doc1', 'Content A');
      store.docUpsert('knowledge:doc2', 'Content B');

      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:doc2', [0.95, 0.1, 0.05], 'test');

      const mockSubAgentBroken: SubAgentLLM = {
        async complete(): Promise<string> {
          return 'not valid json';
        },
      };

      const budget = createBudgetTracker(10000);
      await dedup(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgentBroken,
          threshold: 0.88,
          budget,
          systemPrompt: 'test',
        },
        { added: ['knowledge:doc1', 'knowledge:doc2'], modified: [], deleted: [], unchanged: [] },
        'full',
      );

      // Both should still exist
      expect(store.docGet('knowledge:doc1')).not.toBeNull();
      expect(store.docGet('knowledge:doc2')).not.toBeNull();
    });
  });

  describe('archivist.AC2.11: Immutable documents', () => {
    test('store with only immutable documents produces no mutations', async () => {
      const store = createStore(':memory:');

      store.docUpsert('ref:doc1', 'Reference content');
      store.docUpsert('skill:tool', 'Skill code');
      store.docUpsert('customtool:thing', 'Custom tool');

      // Save embeddings
      store.saveEmbedding('ref:doc1', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('skill:tool', [0.95, 0.1, 0.05], 'test');

      const mockSubAgent: SubAgentLLM = {
        async complete(): Promise<string> {
          return JSON.stringify({ duplicate: true, keep: 'a' });
        },
      };

      const budget = createBudgetTracker(10000);
      const result = await dedup(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgent,
          threshold: 0.88,
          budget,
          systemPrompt: 'test',
        },
        {
          added: ['ref:doc1', 'skill:tool', 'customtool:thing'],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      // Should skip or have no mutations
      expect(result.actions.length).toBe(0);

      // All immutable documents should remain unchanged
      expect(store.docGet('ref:doc1')).not.toBeNull();
      expect(store.docGet('skill:tool')).not.toBeNull();
      expect(store.docGet('customtool:thing')).not.toBeNull();
    });
  });

  describe('archivist.AC4.1/4.2/4.3: Immutability boundaries', () => {
    test('never modifies or deletes ref: documents', async () => {
      const store = createStore(':memory:');

      store.docUpsert('ref:original', 'Reference');
      store.docUpsert('knowledge:doc1', 'Content');

      store.saveEmbedding('ref:original', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');

      const mockSubAgent: SubAgentLLM = {
        async complete(): Promise<string> {
          return JSON.stringify({ duplicate: true, keep: 'a' });
        },
      };

      const budget = createBudgetTracker(10000);
      await dedup(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgent,
          threshold: 0.88,
          budget,
          systemPrompt: 'test',
        },
        {
          added: ['ref:original', 'knowledge:doc1'],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      // ref: should never be in consideration
      expect(store.docGet('ref:original')).not.toBeNull();
    });

    test('never modifies or deletes skill: documents', async () => {
      const store = createStore(':memory:');

      store.docUpsert('skill:helper', 'Skill code');
      store.docUpsert('knowledge:doc1', 'Content');

      store.saveEmbedding('skill:helper', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');

      const mockSubAgent: SubAgentLLM = {
        async complete(): Promise<string> {
          return JSON.stringify({ duplicate: true, keep: 'a' });
        },
      };

      const budget = createBudgetTracker(10000);
      await dedup(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgent,
          threshold: 0.88,
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
      store.docUpsert('knowledge:doc1', 'Content');

      store.saveEmbedding('customtool:thing', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');

      const mockSubAgent: SubAgentLLM = {
        async complete(): Promise<string> {
          return JSON.stringify({ duplicate: true, keep: 'a' });
        },
      };

      const budget = createBudgetTracker(10000);
      await dedup(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgent,
          threshold: 0.88,
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

  describe('graceful degradation', () => {
    test('skips stage when no embedding provider', async () => {
      const store = createStore(':memory:');
      store.docUpsert('knowledge:doc1', 'Content');

      const budget = createBudgetTracker(10000);
      const result = await dedup(
        {
          store,
          embedding: undefined,
          subAgent: mockSubAgent,
          threshold: 0.88,
          budget,
          systemPrompt: 'test',
        },
        { added: ['knowledge:doc1'], modified: [], deleted: [], unchanged: [] },
        'full',
      );

      expect(result.skipped).toBe(true);
    });

    test('skips stage when no sub-agent', async () => {
      const store = createStore(':memory:');
      store.docUpsert('knowledge:doc1', 'Content');

      const budget = createBudgetTracker(10000);
      const result = await dedup(
        {
          store,
          embedding: mockEmbedding,
          subAgent: undefined,
          threshold: 0.88,
          budget,
          systemPrompt: 'test',
        },
        { added: ['knowledge:doc1'], modified: [], deleted: [], unchanged: [] },
        'full',
      );

      expect(result.skipped).toBe(true);
    });
  });
});
