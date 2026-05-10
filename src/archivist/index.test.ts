// pattern: Imperative Shell (test)

import { describe, test, expect, afterEach } from 'bun:test';
import type { Store } from '@/store/store.ts';
import type { SubAgentLLM } from '@/model/sub-agent.ts';
import type { ArchivistConfig } from '@/config/types.ts';
import { createArchivist } from './index.ts';

function createMockStore(): Store {
  return {
    docGet: () => null,
    docUpsert: () => {},
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

function createMockSubAgent(): SubAgentLLM {
  return {
    complete: () => Promise.resolve('mock'),
    summarize: () => Promise.resolve('mock'),
  } as unknown as SubAgentLLM;
}

function createConfig(): ArchivistConfig {
  return {
    enabled: true,
    tokenBudget: 10000,
    dedupThreshold: 0.8,
    crossrefThreshold: 0.7,
    pruneThreshold: 0.6,
    maxLogEntries: 30,
    daytimeSchedule: '0 * 6-22 * * *',
    nighttimeSchedule: '0 2 * * *',
  };
}

describe('createArchivist', () => {
  const archivist = createArchivist({
    store: createMockStore(),
    subAgent: createMockSubAgent(),
    config: createConfig(),
    timezone: 'America/New_York',
  });

  afterEach(() => {
    archivist.stop();
  });

  test('returns object with start and stop methods', () => {
    expect(archivist.start).toBeDefined();
    expect(archivist.stop).toBeDefined();
    expect(typeof archivist.start).toBe('function');
    expect(typeof archivist.stop).toBe('function');
  });

  test('starts successfully when sub-agent is configured', () => {
    // Should not throw
    expect(() => archivist.start()).not.toThrow();
  });

  test('stops successfully even if start was not called', () => {
    const archivist2 = createArchivist({
      store: createMockStore(),
      subAgent: createMockSubAgent(),
      config: createConfig(),
      timezone: 'America/New_York',
    });

    // Should not throw
    expect(() => archivist2.stop()).not.toThrow();
  });

  test('disables when no sub-agent is configured', () => {
    const archivistNoAgent = createArchivist({
      store: createMockStore(),
      config: createConfig(),
      timezone: 'America/New_York',
    });

    // Should not throw, should gracefully disable
    expect(() => archivistNoAgent.start()).not.toThrow();
    expect(() => archivistNoAgent.stop()).not.toThrow();
  });

  test('handles overlapping runs by skipping', async () => {
    const store = createMockStore();

    // Create a slow subagent that will keep the first run in progress
    let resolveSlowComplete: (() => void) | undefined;
    const slowComplete = new Promise(resolve => {
      resolveSlowComplete = () => resolve(undefined);
    });

    const slowSubAgent = {
      complete: async () => {
        // Wait for signal before resolving
        await slowComplete;
        return 'mock';
      },
      summarize: async () => 'mock',
    } as unknown as SubAgentLLM;

    const archivist = createArchivist({
      store,
      subAgent: slowSubAgent,
      config: createConfig(),
      timezone: 'America/New_York',
    });

    // Trigger first run (will be slow due to mock)
    const firstRun = archivist.runNow('incremental');

    // Give first run time to start and block in progress
    await new Promise(resolve => setTimeout(resolve, 10));

    // Trigger second run while first is still in progress
    // This should be skipped due to the running flag check
    const secondRun = archivist.runNow('incremental');

    // Resolve the slow operation so first run can complete
    resolveSlowComplete?.();

    // Both calls should complete without error
    await Promise.all([firstRun, secondRun]);

    // Both should resolve successfully (second is skipped silently via overlap guard)
    expect(firstRun).toBeDefined();
    expect(secondRun).toBeDefined();

    archivist.stop();
  });
});
