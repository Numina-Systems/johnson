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
  let docSearchCalls: Array<{ query: string; limit?: number }>;
  let hybridSearchSpy: { calls: Array<{ query: string; limit: number }> };

  beforeEach(() => {
    docSearchCalls = [];
    hybridSearchSpy = { calls: [] };

    // Mock store with docSearch and docGet
    mockStore = {
      docSearch: (query: string, limit?: number) => {
        docSearchCalls.push({ query, limit });
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
      listSessionsWithCounts: () => [],
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

  // ─────────────────────────────────────────────────────────────────────────
  // Missing coverage tests
  // ─────────────────────────────────────────────────────────────────────────

  test('reflexive-recall.AC2.1: per-query limit of 5 for hybridSearch', async () => {
    // This test verifies that hybridSearch is called with limit 5 for each semantic query
    // We'll use a spy on the store.docSearch to verify the behavior indirectly
    const decomposition: DecompositionResult = {
      queries: ['query1', 'query2'],
      entities: [],
    };
    const deps: HybridSearchDeps = { store: mockStore, embedding: mockEmbedding };

    const result = await retrieveContext(decomposition, deps, 1500);

    // Each semantic query should call hybridSearch(deps, query, 5)
    // hybridSearch calls store.docSearch with expandedLimit = 5 * 2 = 10
    // We expect 2 docSearch calls (one per query)
    expect(docSearchCalls.length).toBe(2);
    // Each docSearch call should have limit parameter of 10 (expanded from 5)
    for (const call of docSearchCalls) {
      expect(call.limit).toBe(10);
    }
  });

  test('reflexive-recall.AC2.2: per-entity limit of 3 for docSearch and source is entity', async () => {
    // This test verifies:
    // 1. docSearch is called with limit 3 for each entity
    // 2. returned entity fragments have source: 'entity'
    const decomposition: DecompositionResult = {
      queries: [],
      entities: ['entity1', 'entity2'],
    };
    const deps: HybridSearchDeps = { store: mockStore, embedding: mockEmbedding };

    const result = await retrieveContext(decomposition, deps, 1500);

    // Should have 2 docSearch calls for the 2 entities
    expect(docSearchCalls.length).toBe(2);
    // Each call should use limit 3
    for (const call of docSearchCalls) {
      expect(call.limit).toBe(3);
    }

    // All returned fragments should have source: 'entity'
    for (const fragment of result.fragments) {
      expect(fragment.source).toBe('entity');
    }
  });

  test('reflexive-recall.AC2.3: output sorted descending by score and entity scores use 1/(60+rank)', async () => {
    // This test verifies:
    // 1. output is sorted descending by score
    // 2. entity fragment scores equal 1/(60+rank) where rank is from docSearch
    const decomposition: DecompositionResult = {
      queries: [],
      entities: ['test'],
    };
    const deps: HybridSearchDeps = { store: mockStore, embedding: mockEmbedding };

    const result = await retrieveContext(decomposition, deps, 1500);

    // Verify fragments are sorted descending by score
    for (let i = 1; i < result.fragments.length; i++) {
      expect(result.fragments[i]!.score).toBeLessThanOrEqual(result.fragments[i - 1]!.score);
    }

    // Verify entity fragment scores match formula: 1/(60+rank)
    // From mock: rank 1 -> score = 1/61, rank 2 -> score = 1/62
    for (const fragment of result.fragments) {
      if (fragment.source === 'entity') {
        // Expected scores from mock docSearch results
        if (fragment.rkey === 'knowledge:test1') {
          expect(fragment.score).toBe(1 / 61); // rank 1
        } else if (fragment.rkey === 'knowledge:test2') {
          expect(fragment.score).toBe(1 / 62); // rank 2
        }
      }
    }
  });

  test('reflexive-recall.AC2.1: no more than 5 fragments per semantic query', async () => {
    // Even if hybridSearch were to return more results, they should be limited to 5
    // This test creates a mock that could return many results and verifies the limit
    const multiResultStore: Store = {
      ...mockStore,
      docSearch: (query: string, limit?: number) => {
        // Return up to limit results
        if (query.includes('multi')) {
          const allResults = [
            { rkey: 'knowledge:multi1', content: 'content 1', rank: 1 },
            { rkey: 'knowledge:multi2', content: 'content 2', rank: 2 },
            { rkey: 'knowledge:multi3', content: 'content 3', rank: 3 },
            { rkey: 'knowledge:multi4', content: 'content 4', rank: 4 },
            { rkey: 'knowledge:multi5', content: 'content 5', rank: 5 },
            { rkey: 'knowledge:multi6', content: 'content 6', rank: 6 },
            { rkey: 'knowledge:multi7', content: 'content 7', rank: 7 },
            { rkey: 'knowledge:multi8', content: 'content 8', rank: 8 },
            { rkey: 'knowledge:multi9', content: 'content 9', rank: 9 },
            { rkey: 'knowledge:multi10', content: 'content 10', rank: 10 },
          ];
          return allResults.slice(0, limit);
        }
        return [];
      },
      docGet: (rkey: string) => {
        if (rkey.startsWith('knowledge:multi')) {
          const num = rkey.replace('knowledge:multi', '');
          return { content: `content ${num}`, rkey, createdAt: '', updatedAt: '' };
        }
        return null;
      },
    } as unknown as Store;

    const decomposition: DecompositionResult = {
      queries: ['multi'],
      entities: [],
    };
    const deps: HybridSearchDeps = { store: multiResultStore, embedding: mockEmbedding };

    const result = await retrieveContext(decomposition, deps, 10000);

    // hybridSearch should return at most 5 results per query (from semantic search)
    // Since we have only 1 query and large token budget, we should get at most 5 semantic fragments
    const semanticFragments = result.fragments.filter(f => f.source === 'semantic');
    expect(semanticFragments.length).toBeLessThanOrEqual(5);
  });
});
