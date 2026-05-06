import { describe, test, expect, beforeEach } from 'bun:test';
import {
  type RecallFragment,
  type RecallResult,
  filterByPrefix,
  deduplicateFragments,
  trimToTokenBudget,
  retrieveContext,
} from './retrieve.ts';
import type { DecompositionResult } from './decompose.ts';
import type { HybridSearchDeps } from '../search/hybrid.ts';
import type { Store } from '../store/store.ts';
import type { EmbeddingProvider } from '../embedding/types.ts';

// ─────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────

function createMockFragment(
  rkey: string,
  content: string = 'test content',
  score: number = 1.0,
  source: 'semantic' | 'entity' = 'semantic',
): RecallFragment {
  return { rkey, content, score, source };
}

// ─────────────────────────────────────────────────────────────────────────
// filterByPrefix tests
// ─────────────────────────────────────────────────────────────────────────

describe('filterByPrefix', () => {
  test('reflexive-recall.AC3.1: allows knowledge: prefix', () => {
    const fragments = [createMockFragment('knowledge:foo')];
    const result = filterByPrefix(fragments);
    expect(result).toHaveLength(1);
    expect(result[0]!.rkey).toBe('knowledge:foo');
  });

  test('reflexive-recall.AC3.1: allows skill: prefix', () => {
    const fragments = [createMockFragment('skill:bar')];
    const result = filterByPrefix(fragments);
    expect(result).toHaveLength(1);
  });

  test('reflexive-recall.AC3.1: allows archive: prefix', () => {
    const fragments = [createMockFragment('archive:2024-01-01')];
    const result = filterByPrefix(fragments);
    expect(result).toHaveLength(1);
  });

  test('reflexive-recall.AC3.2: excludes self', () => {
    const fragments = [createMockFragment('self')];
    const result = filterByPrefix(fragments);
    expect(result).toHaveLength(0);
  });

  test('reflexive-recall.AC3.2: excludes operator', () => {
    const fragments = [createMockFragment('operator')];
    const result = filterByPrefix(fragments);
    expect(result).toHaveLength(0);
  });

  test('reflexive-recall.AC3.3: excludes task: prefix', () => {
    const fragments = [createMockFragment('task:research')];
    const result = filterByPrefix(fragments);
    expect(result).toHaveLength(0);
  });

  test('excludes customtool: prefix', () => {
    const fragments = [createMockFragment('customtool:foo')];
    const result = filterByPrefix(fragments);
    expect(result).toHaveLength(0);
  });

  test('preserves order when filtering', () => {
    const fragments = [
      createMockFragment('knowledge:a'),
      createMockFragment('operator'),
      createMockFragment('skill:b'),
      createMockFragment('self'),
      createMockFragment('archive:c'),
    ];
    const result = filterByPrefix(fragments);
    expect(result).toHaveLength(3);
    expect(result[0]!.rkey).toBe('knowledge:a');
    expect(result[1]!.rkey).toBe('skill:b');
    expect(result[2]!.rkey).toBe('archive:c');
  });

  test('accepts custom allowed prefixes', () => {
    const fragments = [
      createMockFragment('custom:a'),
      createMockFragment('knowledge:b'),
    ];
    const result = filterByPrefix(fragments, ['custom:']);
    expect(result).toHaveLength(1);
    expect(result[0]!.rkey).toBe('custom:a');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// deduplicateFragments tests
// ─────────────────────────────────────────────────────────────────────────

describe('deduplicateFragments', () => {
  test('reflexive-recall.AC2.3: keeps higher-scored duplicate', () => {
    const fragments = [
      createMockFragment('knowledge:foo', 'content1', 0.5),
      createMockFragment('knowledge:foo', 'content2', 0.8),
    ];
    const result = deduplicateFragments(fragments);
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBe(0.8);
    expect(result[0]!.content).toBe('content2');
  });

  test('keeps fragments with different rkeys', () => {
    const fragments = [
      createMockFragment('knowledge:a', 'content1', 0.5),
      createMockFragment('knowledge:b', 'content2', 0.3),
    ];
    const result = deduplicateFragments(fragments);
    expect(result).toHaveLength(2);
  });

  test('handles single fragment', () => {
    const fragments = [createMockFragment('knowledge:foo')];
    const result = deduplicateFragments(fragments);
    expect(result).toHaveLength(1);
  });

  test('handles empty array', () => {
    const fragments: Array<RecallFragment> = [];
    const result = deduplicateFragments(fragments);
    expect(result).toHaveLength(0);
  });

  test('keeps first occurrence when scores are equal', () => {
    const fragments = [
      createMockFragment('knowledge:foo', 'first', 0.5),
      createMockFragment('knowledge:foo', 'second', 0.5),
    ];
    const result = deduplicateFragments(fragments);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe('first');
  });

  test('handles multiple duplicates of same rkey', () => {
    const fragments = [
      createMockFragment('knowledge:foo', 'low', 0.3),
      createMockFragment('knowledge:foo', 'high', 0.9),
      createMockFragment('knowledge:foo', 'medium', 0.5),
    ];
    const result = deduplicateFragments(fragments);
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBe(0.9);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// trimToTokenBudget tests
// ─────────────────────────────────────────────────────────────────────────

describe('trimToTokenBudget', () => {
  test('reflexive-recall.AC4.1: includes all fragments when under budget', () => {
    // Each fragment with "test" (4 chars) = 1 token
    const fragments = [
      createMockFragment('knowledge:a', 'test', 0.9),
      createMockFragment('knowledge:b', 'test', 0.8),
      createMockFragment('knowledge:c', 'test', 0.7),
    ];
    const result = trimToTokenBudget(fragments, 100);
    expect(result.fragments).toHaveLength(3);
    expect(result.totalTokens).toBe(3);
  });

  test('reflexive-recall.AC4.1: stops when budget exhausted', () => {
    // Each fragment with 40 chars = ~10 tokens
    const fragments = [
      createMockFragment('knowledge:a', 'x'.repeat(40), 0.9),
      createMockFragment('knowledge:b', 'x'.repeat(40), 0.8),
      createMockFragment('knowledge:c', 'x'.repeat(40), 0.7),
    ];
    const result = trimToTokenBudget(fragments, 20);
    expect(result.fragments).toHaveLength(2);
    expect(result.totalTokens).toBeLessThanOrEqual(20);
  });

  test('reflexive-recall.AC4.2: truncates single large fragment to fit budget', () => {
    const largeContent = 'x'.repeat(500); // ~125 tokens
    const fragments = [createMockFragment('knowledge:a', largeContent, 0.9)];
    const result = trimToTokenBudget(fragments, 50);
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0]!.content.length).toBeLessThan(500);
    expect(result.totalTokens).toBeLessThanOrEqual(50);
  });

  test('reflexive-recall.AC4.3: empty fragments returns empty result', () => {
    const fragments: Array<RecallFragment> = [];
    const result = trimToTokenBudget(fragments, 1500);
    expect(result.fragments).toHaveLength(0);
    expect(result.totalTokens).toBe(0);
  });

  test('truncates when one fragment fits partially', () => {
    const fragments = [
      createMockFragment('knowledge:a', 'x'.repeat(80), 0.9), // ~20 tokens
      createMockFragment('knowledge:b', 'x'.repeat(80), 0.8), // ~20 tokens
    ];
    const result = trimToTokenBudget(fragments, 25);
    expect(result.fragments).toHaveLength(2);
    expect(result.fragments[1]!.content.length).toBeLessThan(80);
  });

  test('respects fragment order by score', () => {
    const fragments = [
      createMockFragment('knowledge:a', 'a', 0.9),
      createMockFragment('knowledge:b', 'b', 0.5),
    ];
    const result = trimToTokenBudget(fragments, 1);
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0]!.rkey).toBe('knowledge:a');
  });

  test('returns zero budget fragments when remainder is 0', () => {
    const fragments = [
      createMockFragment('knowledge:a', 'x'.repeat(80), 0.9), // ~20 tokens
    ];
    const result = trimToTokenBudget(fragments, 20);
    expect(result.fragments).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// retrieveContext integration tests (with mocked deps)
// ─────────────────────────────────────────────────────────────────────────

describe('retrieveContext', () => {
  let mockStore: Store;
  let mockEmbedding: EmbeddingProvider;

  beforeEach(() => {
    // Mock store with docSearch and docGet
    mockStore = {
      docSearch: (query: string, limit?: number) => {
        // Simulate FTS results
        if (query.includes('test')) {
          return [
            { rkey: 'knowledge:test1', content: 'test content 1', rank: 1 },
            { rkey: 'knowledge:test2', content: 'test content 2', rank: 2 },
          ];
        }
        return [];
      },
      docGet: (rkey: string) => {
        const docs: Record<string, string> = {
          'knowledge:test1': 'test content 1',
          'knowledge:test2': 'test content 2',
        };
        if (docs[rkey]) {
          return { content: docs[rkey]!, rkey, createdAt: '', updatedAt: '' };
        }
        return null;
      },
      getAllEmbeddings: () => [],
      getStaleEmbeddings: () => [],
      saveEmbedding: () => {},
      getEmbedding: () => null,
      createSession: () => {},
      ensureSession: () => {},
      getSession: () => null,
      listSessions: () => [],
      updateSessionTitle: () => {},
      appendMessage: () => {},
      getMessages: () => [],
      clearMessages: () => {},
      deleteSession: () => false,
      getSessionMessageCount: () => 0,
      saveTask: () => {},
      listTasks: () => [],
      getTask: () => null,
      updateTaskRun: () => {},
      deleteTask: () => false,
      saveGrant: () => {},
      getGrant: () => null,
      listGrants: () => [],
      updateGrantStatus: () => {},
      updateGrantSecrets: () => {},
      deleteGrant: () => false,
      addManagedThread: () => {},
      removeManagedThread: () => false,
      getManagedThreadIds: () => new Set(),
      docUpsert: () => {},
      docList: () => ({ documents: [] }),
      docDelete: () => false,
      close: () => {},
    } as unknown as Store;

    // Mock embedding provider
    mockEmbedding = {
      embed: async () => [0.1, 0.2, 0.3],
      embedBatch: async (texts) => texts.map(() => [0.1, 0.2, 0.3]),
    } as unknown as EmbeddingProvider;
  });

  test('reflexive-recall.AC2.1: returns results from semantic queries', async () => {
    const decomposition: DecompositionResult = {
      queries: ['test'],
      entities: [],
    };
    const deps: HybridSearchDeps = { store: mockStore, embedding: mockEmbedding };

    const result = await retrieveContext(decomposition, deps, 1500);

    expect(result.fragments.length).toBeGreaterThan(0);
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.queryCount).toBeGreaterThan(0);
  });

  test('reflexive-recall.AC2.2: returns results from entity queries', async () => {
    const decomposition: DecompositionResult = {
      queries: [],
      entities: ['test'],
    };
    const deps: HybridSearchDeps = { store: mockStore, embedding: mockEmbedding };

    const result = await retrieveContext(decomposition, deps, 1500);

    expect(result.fragments.length).toBeGreaterThan(0);
  });

  test('reflexive-recall.AC4.3: empty decomposition produces empty result', async () => {
    const decomposition: DecompositionResult = {
      queries: [],
      entities: [],
    };
    const deps: HybridSearchDeps = { store: mockStore, embedding: mockEmbedding };

    const result = await retrieveContext(decomposition, deps, 1500);

    expect(result.fragments).toHaveLength(0);
    expect(result.totalTokens).toBe(0);
  });

  test('respects token budget', async () => {
    const decomposition: DecompositionResult = {
      queries: ['test'],
      entities: [],
    };
    const deps: HybridSearchDeps = { store: mockStore, embedding: mockEmbedding };

    const result = await retrieveContext(decomposition, deps, 5);

    expect(result.totalTokens).toBeLessThanOrEqual(5);
  });

  test('includes elapsed time', async () => {
    const decomposition: DecompositionResult = {
      queries: ['test'],
      entities: [],
    };
    const deps: HybridSearchDeps = { store: mockStore, embedding: mockEmbedding };

    const result = await retrieveContext(decomposition, deps, 1500);

    expect(result.elapsed).toBeGreaterThanOrEqual(0);
  });

  test('counts queries and entities executed', async () => {
    const decomposition: DecompositionResult = {
      queries: ['q1', 'q2'],
      entities: ['e1'],
    };
    const deps: HybridSearchDeps = { store: mockStore, embedding: mockEmbedding };

    const result = await retrieveContext(decomposition, deps, 1500);

    // queryCount = queries.length + entities.length
    expect(result.queryCount).toBe(3);
  });
});
