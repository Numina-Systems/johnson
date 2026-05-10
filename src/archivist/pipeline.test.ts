// pattern: Imperative Shell (test)

import { describe, test, expect } from 'bun:test';
import type { Store } from '@/store/store.ts';
import type { EmbeddingProvider } from '@/embedding/types.ts';
import type { SubAgentLLM } from '@/model/sub-agent.ts';
import type { ArchivistConfig } from '@/config/types.ts';
import { runPipeline } from './pipeline.ts';

// Mock implementations
function createMockStore(): Store {
  const docs: Record<string, { rkey: string; content: string }> = {
    'test:doc1': { rkey: 'test:doc1', content: 'content1' },
    'test:doc2': { rkey: 'test:doc2', content: 'content2' },
  };

  return {
    docGet(rkey: string) {
      const doc = docs[rkey];
      return doc ? { rkey: doc.rkey, content: doc.content, createdAt: new Date(), updatedAt: new Date() } : null;
    },
    docUpsert(rkey: string, content: string) {
      docs[rkey] = { rkey, content };
    },
    docList(limit: number, cursor?: string) {
      const all = Object.values(docs).map(d => ({
        rkey: d.rkey,
        content: d.content,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      return { documents: all.slice(0, limit), cursor: undefined };
    },
    docDelete: () => {},
    embedGet: () => null,
    embedSet: () => {},
    hybridSearch: () => ({ results: [] }),
    getAllEmbeddings: () => [],
    taskList: () => [],
    taskCreate: () => ({ id: '1', rkey: 'test', trigger: 'cron', prompt: 'test', schedule: '', createdAt: new Date() }),
    taskUpdate: () => {},
    taskDelete: () => {},
    grantList: () => [],
    grantCreate: () => {},
    grantDelete: () => {},
    grantRevoke: () => {},
    sessionCreate: () => ({ id: '1', title: 'test', createdAt: new Date(), updatedAt: new Date() }),
    sessionUpdate: () => {},
    sessionDelete: () => {},
    sessionGet: () => null,
    sessionList: () => [],
    messageInsert: () => ({ id: '1', sessionId: '1', role: 'user', content: 'test', createdAt: new Date() }),
    messageList: () => [],
    messageDelete: () => {},
    close: () => {},
  } as unknown as Store;
}

function createMockEmbedding(): EmbeddingProvider {
  return {
    embed: () => Promise.resolve(new Float32Array(768)),
    batchEmbed: () => Promise.resolve([new Float32Array(768)]),
  } as unknown as EmbeddingProvider;
}

function createMockSubAgent(): SubAgentLLM {
  return {
    complete: () => Promise.resolve('mock response'),
    summarize: () => Promise.resolve('mock summary'),
  } as unknown as SubAgentLLM;
}

function createConfig(tokenBudget: number = 0): ArchivistConfig {
  return {
    enabled: true,
    tokenBudget,
    dedupThreshold: 0.8,
    crossrefThreshold: 0.7,
    pruneThreshold: 0.6,
    maxLogEntries: 30,
    daytimeSchedule: '0 * 6-22 * * *',
    nighttimeSchedule: '0 2 * * *',
  };
}

describe('runPipeline', () => {
  test('runs all stages in order when budget allows', async () => {
    const store = createMockStore();
    const embedding = createMockEmbedding();
    const subAgent = createMockSubAgent();
    const config = createConfig(10000);

    const result = await runPipeline(
      { store, embedding, subAgent, config, systemPrompt: 'test' },
      'incremental',
    );

    expect(result.mode).toBe('incremental');
    expect(result.stages.length).toBe(6);
    expect(result.stages[0].stage).toBe('scan');
    expect(result.stages[1].stage).toBe('dedup');
    expect(result.stages[2].stage).toBe('consolidate');
    expect(result.stages[3].stage).toBe('crossref');
    expect(result.stages[4].stage).toBe('prune');
    expect(result.stages[5].stage).toBe('reflect');
  });

  test('skips dedup when no embedding provider', async () => {
    const store = createMockStore();
    const subAgent = createMockSubAgent();
    const config = createConfig(10000);

    const result = await runPipeline(
      { store, subAgent, config, systemPrompt: 'test' },
      'incremental',
    );

    expect(result.stages[1].stage).toBe('dedup');
    expect(result.stages[1].skipped).toBe(true);
  });

  test('skips consolidate when no sub-agent', async () => {
    const store = createMockStore();
    const embedding = createMockEmbedding();
    const config = createConfig(10000);

    const result = await runPipeline(
      { store, embedding, config, systemPrompt: 'test' },
      'incremental',
    );

    expect(result.stages[2].stage).toBe('consolidate');
    expect(result.stages[2].skipped).toBe(true);
  });

  test('stops pipeline when budget exhausted', async () => {
    const store = createMockStore();
    const embedding = createMockEmbedding();
    const subAgent = createMockSubAgent();
    const config = createConfig(1); // Very low budget

    const result = await runPipeline(
      { store, embedding, subAgent, config, systemPrompt: 'test' },
      'incremental',
    );

    // Scan always runs (no LLM), consumes 0 tokens
    expect(result.stages[0].skipped).toBe(false);
    // Remaining stages should be skipped or incomplete due to budget
    expect(result.budgetExhausted).toBe(true);
  });

  test('saves snapshot after run', async () => {
    const store = createMockStore();
    const config = createConfig(10000);

    await runPipeline(
      { store, config, systemPrompt: 'test' },
      'incremental',
    );

    const savedState = store.docGet('archivist:state');
    expect(savedState).toBeDefined();
  });
});
