// pattern: Imperative Shell (test)

import { describe, test, expect } from 'bun:test';
import type { Store } from '@/store/store.ts';
import type { PipelineResult } from './types.ts';
import { appendRunLog } from './logging.ts';

function createMockStore(): Store {
  const docs: Record<string, { content: string }> = {};

  return {
    docGet(rkey: string) {
      const doc = docs[rkey];
      return doc ? { rkey, content: doc.content, createdAt: new Date(), updatedAt: new Date() } : null;
    },
    docUpsert(rkey: string, content: string) {
      docs[rkey] = { content };
    },
    docList: () => ({ documents: [], cursor: undefined }),
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

function createMockPipelineResult(): PipelineResult {
  return {
    mode: 'incremental',
    stages: [
      { stage: 'scan', tokensUsed: 10, actions: ['scanned docs'], skipped: false },
      { stage: 'dedup', tokensUsed: 50, actions: ['deduplicated 1 pair'], skipped: false },
    ],
    totalTokens: 60,
    duration: 1234,
    budgetExhausted: false,
  };
}

describe('appendRunLog', () => {
  test('writes token breakdown by stage to archivist:log', () => {
    const store = createMockStore();
    const result = createMockPipelineResult();

    appendRunLog(store, result, 30);

    const doc = store.docGet('archivist:log');
    expect(doc).toBeDefined();
    expect(doc?.content).toBeTruthy();

    const entries = JSON.parse(doc!.content) as Array<any>;
    expect(entries.length).toBe(1);
    expect(entries[0].totalTokens).toBe(60);
    expect(entries[0].stages.length).toBe(2);
    expect(entries[0].stages[0].stage).toBe('scan');
    expect(entries[0].stages[0].tokensUsed).toBe(10);
  });

  test('creates log document on first entry', () => {
    const store = createMockStore();
    const result = createMockPipelineResult();

    expect(store.docGet('archivist:log')).toBeNull();
    appendRunLog(store, result, 30);
    expect(store.docGet('archivist:log')).toBeDefined();
  });

  test('accumulates multiple entries', () => {
    const store = createMockStore();
    const result1 = createMockPipelineResult();
    const result2 = { ...createMockPipelineResult(), totalTokens: 100 };

    appendRunLog(store, result1, 30);
    appendRunLog(store, result2, 30);

    const doc = store.docGet('archivist:log');
    const entries = JSON.parse(doc!.content) as Array<any>;
    expect(entries.length).toBe(2);
    expect(entries[0].totalTokens).toBe(60);
    expect(entries[1].totalTokens).toBe(100);
  });

  test('trims to maxEntries when exceeding window', () => {
    const store = createMockStore();
    const maxEntries = 3;

    for (let i = 0; i < 5; i++) {
      const result = { ...createMockPipelineResult(), totalTokens: 10 + i };
      appendRunLog(store, result, maxEntries);
    }

    const doc = store.docGet('archivist:log');
    const entries = JSON.parse(doc!.content) as Array<any>;
    expect(entries.length).toBe(maxEntries);
    // Should keep the last 3 entries (most recent)
    expect(entries[0].totalTokens).toBe(12);
    expect(entries[1].totalTokens).toBe(13);
    expect(entries[2].totalTokens).toBe(14);
  });

  test('records action count per stage', () => {
    const store = createMockStore();
    const result: PipelineResult = {
      mode: 'full',
      stages: [
        { stage: 'scan', tokensUsed: 0, actions: ['scanned docs'], skipped: false },
        { stage: 'dedup', tokensUsed: 50, actions: ['merged pair 1', 'merged pair 2'], skipped: false },
      ],
      totalTokens: 50,
      duration: 500,
      budgetExhausted: false,
    };

    appendRunLog(store, result, 30);

    const doc = store.docGet('archivist:log');
    const entries = JSON.parse(doc!.content) as Array<any>;
    expect(entries[0].stages[0].actionCount).toBe(1);
    expect(entries[0].stages[1].actionCount).toBe(2);
  });

  test('records budget exhaustion flag', () => {
    const store = createMockStore();
    const result: PipelineResult = {
      mode: 'incremental',
      stages: [{ stage: 'scan', tokensUsed: 0, actions: [], skipped: false }],
      totalTokens: 1000,
      duration: 100,
      budgetExhausted: true,
    };

    appendRunLog(store, result, 30);

    const doc = store.docGet('archivist:log');
    const entries = JSON.parse(doc!.content) as Array<any>;
    expect(entries[0].budgetExhausted).toBe(true);
  });
});
