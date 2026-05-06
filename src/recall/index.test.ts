// Integration tests for performRecall orchestrator against mocks and real in-memory store

import { describe, test, expect, beforeEach } from 'bun:test';
import { createStore, type Store } from '../store/store.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';
import type { EmbeddingProvider } from '../embedding/types.ts';
import { performRecall, type RecallDeps } from './index.ts';
import type { RecallResult } from './retrieve.ts';

// ─────────────────────────────────────────────────────────────────────────
// Mock builders
// ─────────────────────────────────────────────────────────────────────────

function makeMockSubAgent(response: string): { subAgent: SubAgentLLM; calls: Array<{ prompt: string; system?: string }> } {
  const calls: Array<{ prompt: string; system?: string }> = [];
  const subAgent: SubAgentLLM = {
    async complete(prompt: string, system?: string) {
      calls.push({ prompt, system });
      return response;
    },
  };
  return { subAgent, calls };
}

function makeMockEmbedding(throwOnEmbed: boolean = false): { embedding: EmbeddingProvider; embedCalls: string[] } {
  const embedCalls: string[] = [];

  const embedFn = async (text: string) => {
    embedCalls.push(text);
    if (throwOnEmbed) {
      throw new Error('Embedding provider error');
    }
    // Return fixed-dimension vector
    return Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0));
  };

  const embedding: EmbeddingProvider = {
    embed: embedFn,
    async embedBatch(texts: ReadonlyArray<string>) {
      return Promise.all(texts.map((t) => embedFn(t)));
    },
    dimensions: 1536,
  };
  return { embedding, embedCalls };
}

// ─────────────────────────────────────────────────────────────────────────
// Guard condition tests
// ─────────────────────────────────────────────────────────────────────────

describe('performRecall - guard conditions', () => {
  let store: Store;
  let embedding: EmbeddingProvider;
  let subAgent: SubAgentLLM;

  beforeEach(() => {
    store = createStore(':memory:');
    const { embedding: e } = makeMockEmbedding();
    embedding = e;
    const { subAgent: s } = makeMockSubAgent(JSON.stringify({ queries: ['test'], entities: [] }));
    subAgent = s;
  });

  test('reflexive-recall.AC6.2: skips recall for messages < 10 chars', async () => {
    const result = await performRecall('hi', { store, embedding, subAgent, tokenBudget: 1500 });
    expect(result).toBeNull();
  });

  test('reflexive-recall.AC6.3: skips recall for empty document store', async () => {
    const result = await performRecall('this is a long enough message', {
      store,
      embedding,
      subAgent,
      tokenBudget: 1500,
    });
    expect(result).toBeNull();
  });

  test('reflexive-recall.AC6.4: skips recall when embedding is undefined', async () => {
    store.docUpsert('knowledge:test', 'some content');
    const result = await performRecall('this is a long enough message', {
      store,
      embedding: undefined,
      subAgent,
      tokenBudget: 1500,
    });
    expect(result).toBeNull();
  });

  test('normal message with valid deps returns RecallResult (not null)', async () => {
    store.docUpsert('knowledge:test', 'some test content');
    const result = await performRecall('this is a long enough message', {
      store,
      embedding,
      subAgent,
      tokenBudget: 1500,
    });
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('fragments');
    expect(result).toHaveProperty('elapsed');
    expect(result).toHaveProperty('queryCount');
    expect(result).toHaveProperty('totalTokens');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Fallback cascade tests
// ─────────────────────────────────────────────────────────────────────────

describe('performRecall - fallback cascade', () => {
  let store: Store;

  beforeEach(() => {
    store = createStore(':memory:');
    store.docUpsert('knowledge:test', 'test content to find');
  });

  test('reflexive-recall.AC5.1: subAgent undefined falls back to raw message as query', async () => {
    const { embedding } = makeMockEmbedding();

    const result = await performRecall('this is a long enough message', {
      store,
      embedding,
      subAgent: undefined,
      tokenBudget: 1500,
    });

    expect(result).not.toBeNull();
    expect(result!.queryCount).toBeGreaterThan(0);
    // Should still find results via FTS fallback on raw message
  });

  test('reflexive-recall.AC5.2: malformed JSON from SubAgentLLM triggers fallback', async () => {
    const { subAgent } = makeMockSubAgent('not valid json at all {[');
    const { embedding } = makeMockEmbedding();

    const result = await performRecall('this is a long enough message', {
      store,
      embedding,
      subAgent,
      tokenBudget: 1500,
    });

    expect(result).not.toBeNull();
    expect(result!.queryCount).toBeGreaterThan(0);
  });

  test('reflexive-recall.AC5.3: embedding provider throwing degrades to FTS-only', async () => {
    const { subAgent } = makeMockSubAgent(JSON.stringify({ queries: ['test query'], entities: [] }));
    const { embedding } = makeMockEmbedding(true); // throws on embed

    const result = await performRecall('this is a long enough message', {
      store,
      embedding,
      subAgent,
      tokenBudget: 1500,
    });

    expect(result).not.toBeNull();
    // Should still return FTS results even when embedding fails
    expect(result!.queryCount).toBeGreaterThan(0);
  });

  test('reflexive-recall.AC5.4: both subAgent undefined and embedding throws still returns FTS results', async () => {
    const { embedding } = makeMockEmbedding(true); // throws on embed

    const result = await performRecall('this is a long enough message', {
      store,
      embedding,
      subAgent: undefined,
      tokenBudget: 1500,
    });

    expect(result).not.toBeNull();
    expect(result!.queryCount).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Happy path test
// ─────────────────────────────────────────────────────────────────────────

describe('performRecall - happy path', () => {
  test('returns correct result structure with valid deps', async () => {
    const store = createStore(':memory:');
    store.docUpsert('knowledge:first', 'important first document content');
    store.docUpsert('skill:second', 'important skill document');

    const { subAgent } = makeMockSubAgent(
      JSON.stringify({
        queries: ['important', 'document'],
        entities: ['Content'],
      })
    );
    const { embedding } = makeMockEmbedding();

    const result = await performRecall('what are the important documents?', {
      store,
      embedding,
      subAgent,
      tokenBudget: 1500,
    });

    expect(result).not.toBeNull();
    expect(Array.isArray(result!.fragments)).toBe(true);
    expect(result!.totalTokens).toBeGreaterThanOrEqual(0);
    expect(result!.queryCount).toBeGreaterThan(0);
    expect(result!.elapsed).toBeGreaterThanOrEqual(0);

    // Should find the documents
    const rkeySet = new Set(result!.fragments.map((f) => f.rkey));
    expect(rkeySet.has('knowledge:first')).toBe(true);
    expect(rkeySet.has('skill:second')).toBe(true);
  });

  test('sets elapsed time correctly', async () => {
    const store = createStore(':memory:');
    store.docUpsert('knowledge:test', 'test content');

    const { subAgent } = makeMockSubAgent(JSON.stringify({ queries: ['test'], entities: [] }));
    const { embedding } = makeMockEmbedding();

    const startWall = Date.now();
    const result = await performRecall('this is a long enough message', {
      store,
      embedding,
      subAgent,
      tokenBudget: 1500,
    });
    const endWall = Date.now();

    expect(result).not.toBeNull();
    expect(result!.elapsed).toBeGreaterThanOrEqual(0);
    expect(result!.elapsed).toBeLessThanOrEqual(endWall - startWall + 100); // small buffer
  });

  test('prefixes fragments correctly (excludes self, includes knowledge/skill)', async () => {
    const store = createStore(':memory:');
    store.docUpsert('self', 'should not appear');
    store.docUpsert('knowledge:allowed', 'this should appear');
    store.docUpsert('skill:also_allowed', 'this should also appear');

    const { subAgent } = makeMockSubAgent(
      JSON.stringify({
        queries: ['should', 'appear'],
        entities: [],
      })
    );
    const { embedding } = makeMockEmbedding();

    const result = await performRecall('this is a long enough message about should appear', {
      store,
      embedding,
      subAgent,
      tokenBudget: 5000,
    });

    expect(result).not.toBeNull();
    const rkeySet = new Set(result!.fragments.map((f) => f.rkey));
    expect(rkeySet.has('self')).toBe(false);
    expect(rkeySet.has('knowledge:allowed')).toBe(true);
    expect(rkeySet.has('skill:also_allowed')).toBe(true);
  });
});
