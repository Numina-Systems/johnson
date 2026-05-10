// pattern: Imperative Shell (test)

import { describe, test, expect, beforeEach } from 'bun:test';
import { createStore } from '@/store/store.ts';
import type { EmbeddingProvider } from '@/embedding/types.ts';
import type { SubAgentLLM } from '@/model/sub-agent.ts';
import type { BudgetTracker } from '../types.ts';
import {
  stripRelatedMarker,
  addRelatedMarker,
  parseRelatedMarker,
  crossref,
} from './crossref.ts';

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
  async complete(): Promise<string> {
    return JSON.stringify({
      topicName: 'Test Topic',
      summary: 'This is a test summary of the topic.',
    });
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

describe('crossref: marker management', () => {
  describe('addRelatedMarker', () => {
    test('adds marker at top of document', () => {
      const content = 'Some document content\nLine 2\nLine 3';
      const result = addRelatedMarker(content, ['rkey1', 'rkey2']);

      expect(result).toContain('<!-- related: rkey1, rkey2 -->');
      expect(result.startsWith('<!-- related:')).toBe(true);
      expect(result).toContain('Some document content');
    });

    test('replaces existing marker (idempotent)', () => {
      const content = '<!-- related: old1, old2 -->\nDocument content';
      const result = addRelatedMarker(content, ['new1', 'new2']);

      expect(result).toContain('<!-- related: new1, new2 -->');
      expect(result).not.toContain('old1');
      expect(result).not.toContain('old2');
    });

    test('removes marker with empty rkeys array', () => {
      const content = '<!-- related: rkey1, rkey2 -->\nDocument content';
      const result = addRelatedMarker(content, []);

      expect(result).not.toContain('<!-- related:');
      expect(result).toBe('Document content');
    });
  });

  describe('stripRelatedMarker', () => {
    test('removes marker, leaves content intact', () => {
      const content = '<!-- related: rkey1, rkey2 -->\nDocument content\nMore content';
      const result = stripRelatedMarker(content);

      expect(result).not.toContain('<!-- related:');
      expect(result).toContain('Document content');
      expect(result).toContain('More content');
    });

    test('handles missing marker gracefully', () => {
      const content = 'Document content\nNo marker here';
      const result = stripRelatedMarker(content);

      expect(result).toBe(content);
    });
  });

  describe('parseRelatedMarker', () => {
    test('extracts rkeys from marker', () => {
      const content = '<!-- related: rkey1, rkey2, rkey3 -->\nContent';
      const result = parseRelatedMarker(content);

      expect(result).toEqual(['rkey1', 'rkey2', 'rkey3']);
    });

    test('returns empty array when marker missing', () => {
      const content = 'Document content\nNo marker';
      const result = parseRelatedMarker(content);

      expect(result).toEqual([]);
    });

    test('handles whitespace around rkeys', () => {
      const content = '<!-- related: rkey1 , rkey2 , rkey3 -->\nContent';
      const result = parseRelatedMarker(content);

      expect(result).toEqual(['rkey1', 'rkey2', 'rkey3']);
    });
  });
});

describe('crossref: integration tests', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore(':memory:');
  });

  describe('archivist.AC2.4: Inline marker management', () => {
    test('documents with similarity >= threshold get related markers added', async () => {
      // Create two documents with identical embeddings (perfect similarity)
      store.docUpsert('knowledge:doc1', 'Content about AI and machine learning');
      store.docUpsert('knowledge:doc2', 'Content about artificial intelligence');

      // Save identical embeddings
      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:doc2', [0.95, 0.1, 0.05], 'test');

      const budget = createBudgetTracker(10000);
      const result = await crossref(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgent,
          threshold: 0.9,
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

      expect(result.stage).toBe('crossref');
      expect(result.skipped).toBe(false);

      // Check that markers were added
      const doc1Updated = store.docGet('knowledge:doc1')!;
      const doc2Updated = store.docGet('knowledge:doc2')!;

      expect(doc1Updated.content).toContain('<!-- related:');
      expect(doc2Updated.content).toContain('<!-- related:');
      expect(doc1Updated.content).toContain('knowledge:doc2');
      expect(doc2Updated.content).toContain('knowledge:doc1');
    });

    test('running crossref twice produces identical markers (idempotency)', async () => {
      store.docUpsert('knowledge:doc1', 'AI content');
      store.docUpsert('knowledge:doc2', 'AI-related content');

      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:doc2', [0.95, 0.1, 0.05], 'test');

      const budget = createBudgetTracker(10000);

      // First run
      await crossref(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgent,
          threshold: 0.9,
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

      const doc1After1 = store.docGet('knowledge:doc1')!.content;
      const doc2After1 = store.docGet('knowledge:doc2')!.content;

      // Second run
      await crossref(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgent,
          threshold: 0.9,
          budget,
          systemPrompt: 'test',
        },
        {
          added: [],
          modified: ['knowledge:doc1', 'knowledge:doc2'],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      const doc1After2 = store.docGet('knowledge:doc1')!.content;
      const doc2After2 = store.docGet('knowledge:doc2')!.content;

      expect(doc1After1).toBe(doc1After2);
      expect(doc2After1).toBe(doc2After2);
    });

    test('immutable documents do NOT get markers added to them', async () => {
      store.docUpsert('knowledge:doc1', 'Content');
      store.docUpsert('skill:mypython', '# Skill: My Python\n// Description: test\ncode here');

      // Save similar embeddings
      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('skill:mypython', [0.95, 0.1, 0.05], 'test');

      const budget = createBudgetTracker(10000);
      await crossref(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgent,
          threshold: 0.9,
          budget,
          systemPrompt: 'test',
        },
        {
          added: ['knowledge:doc1', 'skill:mypython'],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      const doc1 = store.docGet('knowledge:doc1')!;
      const skill = store.docGet('skill:mypython')!;

      // Mutable document should get marker
      expect(doc1.content).toContain('<!-- related:');

      // Immutable skill should NOT get marker
      expect(skill.content).not.toContain('<!-- related:');
      expect(skill.content.startsWith('# Skill:')).toBe(true);
    });

    test('immutable documents CAN appear as targets in other documents markers', async () => {
      store.docUpsert('knowledge:doc1', 'Content');
      store.docUpsert('ref:referenced', 'Some reference material');

      // Save similar embeddings
      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('ref:referenced', [0.95, 0.1, 0.05], 'test');

      const budget = createBudgetTracker(10000);
      await crossref(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgent,
          threshold: 0.9,
          budget,
          systemPrompt: 'test',
        },
        {
          added: ['knowledge:doc1', 'ref:referenced'],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      const doc1 = store.docGet('knowledge:doc1')!;

      // doc1 should reference the immutable ref:referenced
      expect(doc1.content).toContain('<!-- related:');
      expect(doc1.content).toContain('ref:referenced');
    });
  });

  describe('archivist.AC2.5: Index documents', () => {
    test('index documents are created for topic clusters', async () => {
      store.docUpsert('knowledge:doc1', 'Content');
      store.docUpsert('knowledge:doc2', 'Related content');
      store.docUpsert('knowledge:doc3', 'More content');

      // Create two similar pairs
      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:doc2', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:doc3', [0.1, 0.95, 0.05], 'test');

      const budget = createBudgetTracker(10000);
      await crossref(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgent,
          threshold: 0.9,
          budget,
          systemPrompt: 'test',
        },
        {
          added: ['knowledge:doc1', 'knowledge:doc2', 'knowledge:doc3'],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      // Check that index documents were created
      // We expect 2 clusters: {doc1, doc2} and {doc3} (doc3 has no similar matches)
      // But doc3 alone won't form a cluster since it needs at least one relationship
      const allDocs = store.docList(100).documents;
      const indexDocs = allDocs.filter(doc => doc.rkey.startsWith('index:'));

      expect(indexDocs.length).toBeGreaterThan(0);

      // Index document should have archivist-managed marker
      const indexContent = indexDocs[0]!.content;
      expect(indexContent).toContain('<!-- archivist-managed -->');
      expect(indexContent).toContain('# Topic:');
      expect(indexContent).toContain('## Related Documents');
    });

    test('index documents are updated when new related documents appear', async () => {
      store.docUpsert('knowledge:doc1', 'Content');
      store.docUpsert('knowledge:doc2', 'Related content');

      store.saveEmbedding('knowledge:doc1', [0.95, 0.1, 0.05], 'test');
      store.saveEmbedding('knowledge:doc2', [0.95, 0.1, 0.05], 'test');

      const budget = createBudgetTracker(10000);

      // First run
      await crossref(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgent,
          threshold: 0.9,
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

      const indexDocs1 = store.docList(100).documents.filter(doc => doc.rkey.startsWith('index:'));
      const indexContent1 = indexDocs1.length > 0 ? indexDocs1[0]!.content : '';

      // Add new document with same embeddings
      store.docUpsert('knowledge:doc3', 'Another related document');
      store.saveEmbedding('knowledge:doc3', [0.95, 0.1, 0.05], 'test');

      // Second run
      await crossref(
        {
          store,
          embedding: mockEmbedding,
          subAgent: mockSubAgent,
          threshold: 0.9,
          budget,
          systemPrompt: 'test',
        },
        {
          added: ['knowledge:doc3'],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      const indexDocs2 = store.docList(100).documents.filter(doc => doc.rkey.startsWith('index:'));

      // Index should still exist and be updated
      expect(indexDocs2.length).toBeGreaterThan(0);

      // Verify doc3 is now referenced in some index
      const updatedIndexContent = indexDocs2.map(d => d.content).join('|');
      expect(updatedIndexContent).toContain('knowledge:doc3');
    });
  });

  describe('degradation', () => {
    test('no embedding provider: stage is skipped', async () => {
      store.docUpsert('knowledge:doc1', 'Content');
      store.docUpsert('knowledge:doc2', 'Related content');

      const budget = createBudgetTracker(10000);
      const result = await crossref(
        {
          store,
          // embedding provider is undefined
          threshold: 0.9,
          budget,
          systemPrompt: 'test',
        } as any, // simulate undefined embedding provider
        {
          added: ['knowledge:doc1', 'knowledge:doc2'],
          modified: [],
          deleted: [],
          unchanged: [],
        },
        'full',
      );

      expect(result.skipped).toBe(true);
      expect(result.actions).toEqual([]);
    });
  });
});
