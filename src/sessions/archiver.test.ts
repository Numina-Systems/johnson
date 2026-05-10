// pattern: Imperative Shell (test)

import { describe, expect, test } from 'bun:test';
import { archiveSession, pruneSessions } from './archiver.ts';
import type { Store, DocumentRow, GrantRow } from '../store/store.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';
import type { EmbeddingProvider } from '../embedding/types.ts';
import type { SessionWithCounts } from './types.ts';

// Helper: Create a noop store base
function createNoopStore(): Store {
  return {
    docUpsert: () => {},
    docGet: (_rkey: string): DocumentRow | null => null,
    docList: () => ({ documents: [], cursor: undefined }),
    docDelete: () => false,
    docSearch: () => [],
    saveEmbedding: () => {},
    getEmbedding: () => null,
    getAllEmbeddings: () => [],
    getStaleEmbeddings: () => [],
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
    getGrant: (): GrantRow | null => null,
    listGrants: () => [],
    updateGrantStatus: () => {},
    updateGrantSecrets: () => {},
    deleteGrant: () => false,
    addManagedThread: () => {},
    removeManagedThread: () => false,
    getManagedThreadIds: () => new Set(),
    close: () => {},
  };
}

// Helper: Create mock store with test data
interface CreateMockStoreOptions {
  sessions: Array<{ id: string; title: string | null; createdAt: string; updatedAt: string }>;
  messagesPerSession: Record<string, Array<{ role: string; content: string; createdAt: string }>>;
}

interface MockStoreTest extends Store {
  docUpsertCalls: Array<{ rkey: string; content: string }>;
  deleteSessionCalls: string[];
  saveEmbeddingCalls: Array<{ rkey: string; embedding: Array<number>; model: string }>;
}

function createMockStore(options: CreateMockStoreOptions): MockStoreTest {
  const { sessions, messagesPerSession } = options;
  const docUpsertCalls: Array<{ rkey: string; content: string }> = [];
  const deleteSessionCalls: string[] = [];
  const saveEmbeddingCalls: Array<{ rkey: string; embedding: Array<number>; model: string }> = [];

  const base = createNoopStore();

  return {
    ...base,
    docUpsertCalls,
    deleteSessionCalls,
    saveEmbeddingCalls,
    getSession: (id: string) => sessions.find((s) => s.id === id) ?? null,
    getMessages: (sessionId: string) => messagesPerSession[sessionId] ?? [],
    listSessionsWithCounts: (): SessionWithCounts[] => {
      return sessions.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: (messagesPerSession[s.id] ?? []).length,
        lastMessageAt: (() => {
          const msgs = messagesPerSession[s.id] ?? [];
          return msgs.length > 0 ? msgs[msgs.length - 1]?.createdAt ?? null : null;
        })(),
      }));
    },
    docUpsert: (rkey: string, content: string) => {
      docUpsertCalls.push({ rkey, content });
    },
    deleteSession: (id: string) => {
      deleteSessionCalls.push(id);
      return true;
    },
    saveEmbedding: (rkey: string, embedding: Array<number>, model: string) => {
      saveEmbeddingCalls.push({ rkey, embedding, model });
    },
  };
}

// Helper: Create mock SubAgentLLM
function createMockSubAgent(response: string): SubAgentLLM & {
  completeCalls: Array<{ prompt: string; system?: string }>;
} {
  const completeCalls: Array<{ prompt: string; system?: string }> = [];
  return {
    complete: async (prompt: string, system?: string) => {
      completeCalls.push({ prompt, system });
      return response;
    },
    completeCalls,
  };
}

// Helper: Create mock EmbeddingProvider
function createMockEmbedding(): EmbeddingProvider & {
  embedCalls: string[];
} {
  const embedCalls: string[] = [];
  return {
    embed: async (text: string) => {
      embedCalls.push(text);
      return [1, 0, 0]; // Fixed vector for testing
    },
    embedBatch: async (texts: ReadonlyArray<string>) => {
      return texts.map(() => [1, 0, 0]);
    },
    dimensions: 3,
    embedCalls,
  };
}

// Helper: Create mock EmbeddingProvider that throws
function createMockEmbeddingError(): EmbeddingProvider {
  return {
    embed: async () => {
      throw new Error('Embedding failed');
    },
    embedBatch: async () => {
      throw new Error('Embedding failed');
    },
    dimensions: 3,
  };
}

// Helper: Create mock SubAgentLLM that throws
function createMockSubAgentError(): SubAgentLLM {
  return {
    complete: async () => {
      throw new Error('SubAgent failed');
    },
  };
}

describe('archiveSession', () => {
  test('AC3.1: creates archive document and deletes session', async () => {
    const now = new Date('2026-01-15T12:00:00Z');
    const mockStore = createMockStore({
      sessions: [
        {
          id: 'session-123',
          title: 'Test Session',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      messagesPerSession: {
        'session-123': [
          { role: 'user', content: 'Hello', createdAt: now.toISOString() },
          { role: 'assistant', content: 'Hi', createdAt: new Date(now.getTime() + 1000).toISOString() },
          { role: 'user', content: 'How are you?', createdAt: new Date(now.getTime() + 2000).toISOString() },
        ],
      },
    });

    const result = await archiveSession('session-123', mockStore);

    expect(result.rkey).toMatch(/^archive:session:/);
    expect(result.title).toBe('Test Session');
    expect(result.messageCount).toBe(3);
    expect(mockStore.docUpsertCalls.length).toBe(1);
    expect(mockStore.docUpsertCalls[0]?.rkey).toBe(result.rkey);
    expect(mockStore.deleteSessionCalls).toContain('session-123');
  });

  test('AC3.2: calls SubAgentLLM for sessions with >5 messages', async () => {
    const now = new Date('2026-01-15T12:00:00Z');
    const mockStore = createMockStore({
      sessions: [
        {
          id: 'session-long',
          title: 'Long Session',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      messagesPerSession: {
        'session-long': [
          { role: 'user', content: 'Msg1', createdAt: new Date(now.getTime()).toISOString() },
          { role: 'assistant', content: 'Msg2', createdAt: new Date(now.getTime() + 1000).toISOString() },
          { role: 'user', content: 'Msg3', createdAt: new Date(now.getTime() + 2000).toISOString() },
          { role: 'assistant', content: 'Msg4', createdAt: new Date(now.getTime() + 3000).toISOString() },
          { role: 'user', content: 'Msg5', createdAt: new Date(now.getTime() + 4000).toISOString() },
          { role: 'assistant', content: 'Msg6', createdAt: new Date(now.getTime() + 5000).toISOString() },
          { role: 'user', content: 'Msg7', createdAt: new Date(now.getTime() + 6000).toISOString() },
          { role: 'assistant', content: 'Msg8', createdAt: new Date(now.getTime() + 7000).toISOString() },
        ],
      },
    });

    const mockSubAgent = createMockSubAgent('Test summary');

    await archiveSession('session-long', mockStore, mockSubAgent);

    expect(mockSubAgent.completeCalls.length).toBe(1);
    expect(mockSubAgent.completeCalls[0]?.system).toContain('conversation summarizer');
    const archiveDoc = mockStore.docUpsertCalls[0]?.content;
    expect(archiveDoc).toContain('## Summary');
    expect(archiveDoc).toContain('Test summary');
  });

  test('AC3.3: does NOT call SubAgentLLM for sessions with ≤5 messages', async () => {
    const now = new Date('2026-01-15T12:00:00Z');
    const mockStore = createMockStore({
      sessions: [
        {
          id: 'session-short',
          title: 'Short Session',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      messagesPerSession: {
        'session-short': [
          { role: 'user', content: 'Msg1', createdAt: new Date(now.getTime()).toISOString() },
          { role: 'assistant', content: 'Msg2', createdAt: new Date(now.getTime() + 1000).toISOString() },
          { role: 'user', content: 'Msg3', createdAt: new Date(now.getTime() + 2000).toISOString() },
        ],
      },
    });

    const mockSubAgent = createMockSubAgent('Test summary');

    await archiveSession('session-short', mockStore, mockSubAgent);

    expect(mockSubAgent.completeCalls.length).toBe(0);
    const archiveDoc = mockStore.docUpsertCalls[0]?.content;
    expect(archiveDoc).not.toContain('## Summary');
  });

  test('AC3.4: succeeds without SubAgentLLM', async () => {
    const now = new Date('2026-01-15T12:00:00Z');
    const mockStore = createMockStore({
      sessions: [
        {
          id: 'session-123',
          title: 'Test',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      messagesPerSession: {
        'session-123': [
          { role: 'user', content: 'Msg1', createdAt: now.toISOString() },
        ],
      },
    });

    const result = await archiveSession('session-123', mockStore, undefined);

    expect(result.messageCount).toBe(1);
    expect(mockStore.docUpsertCalls.length).toBe(1);
  });

  test('AC3.4: continues when SubAgentLLM throws', async () => {
    const now = new Date('2026-01-15T12:00:00Z');
    const mockStore = createMockStore({
      sessions: [
        {
          id: 'session-long',
          title: 'Test',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      messagesPerSession: {
        'session-long': [
          { role: 'user', content: 'Msg1', createdAt: new Date(now.getTime()).toISOString() },
          { role: 'assistant', content: 'Msg2', createdAt: new Date(now.getTime() + 1000).toISOString() },
          { role: 'user', content: 'Msg3', createdAt: new Date(now.getTime() + 2000).toISOString() },
          { role: 'assistant', content: 'Msg4', createdAt: new Date(now.getTime() + 3000).toISOString() },
          { role: 'user', content: 'Msg5', createdAt: new Date(now.getTime() + 4000).toISOString() },
          { role: 'assistant', content: 'Msg6', createdAt: new Date(now.getTime() + 5000).toISOString() },
          { role: 'user', content: 'Msg7', createdAt: new Date(now.getTime() + 6000).toISOString() },
        ],
      },
    });

    const mockSubAgent = createMockSubAgentError();

    const result = await archiveSession('session-long', mockStore, mockSubAgent);

    expect(result.messageCount).toBe(7);
    expect(mockStore.docUpsertCalls.length).toBe(1);
    const archiveDoc = mockStore.docUpsertCalls[0]?.content;
    expect(archiveDoc).not.toContain('## Summary');
  });

  test('AC3.6: embeds summary for >5 msg sessions', async () => {
    const now = new Date('2026-01-15T12:00:00Z');
    const mockStore = createMockStore({
      sessions: [
        {
          id: 'session-long',
          title: 'Test',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      messagesPerSession: {
        'session-long': [
          { role: 'user', content: 'Msg1', createdAt: new Date(now.getTime()).toISOString() },
          { role: 'assistant', content: 'Msg2', createdAt: new Date(now.getTime() + 1000).toISOString() },
          { role: 'user', content: 'Msg3', createdAt: new Date(now.getTime() + 2000).toISOString() },
          { role: 'assistant', content: 'Msg4', createdAt: new Date(now.getTime() + 3000).toISOString() },
          { role: 'user', content: 'Msg5', createdAt: new Date(now.getTime() + 4000).toISOString() },
          { role: 'assistant', content: 'Msg6', createdAt: new Date(now.getTime() + 5000).toISOString() },
          { role: 'user', content: 'Msg7', createdAt: new Date(now.getTime() + 6000).toISOString() },
        ],
      },
    });

    const mockSubAgent = createMockSubAgent('Summary text');
    const mockEmbedding = createMockEmbedding();

    await archiveSession('session-long', mockStore, mockSubAgent, mockEmbedding, 'test-model');

    expect(mockEmbedding.embedCalls.length).toBe(1);
    expect(mockEmbedding.embedCalls[0]).toBe('Summary text');
    expect(mockStore.saveEmbeddingCalls.length).toBe(1);
    expect(mockStore.saveEmbeddingCalls[0]?.model).toBe('test-model');
  });

  test('AC3.6: embeds full document for ≤5 msg sessions', async () => {
    const now = new Date('2026-01-15T12:00:00Z');
    const mockStore = createMockStore({
      sessions: [
        {
          id: 'session-short',
          title: 'Test',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      messagesPerSession: {
        'session-short': [
          { role: 'user', content: 'Msg1', createdAt: new Date(now.getTime()).toISOString() },
          { role: 'assistant', content: 'Msg2', createdAt: new Date(now.getTime() + 1000).toISOString() },
          { role: 'user', content: 'Msg3', createdAt: new Date(now.getTime() + 2000).toISOString() },
        ],
      },
    });

    const mockEmbedding = createMockEmbedding();

    await archiveSession('session-short', mockStore, undefined, mockEmbedding);

    expect(mockEmbedding.embedCalls.length).toBe(1);
    const embeddedText = mockEmbedding.embedCalls[0];
    expect(embeddedText ?? '').toContain('---');
    expect(embeddedText ?? '').toContain('## Transcript');
  });

  test('AC3.7: succeeds without EmbeddingProvider', async () => {
    const now = new Date('2026-01-15T12:00:00Z');
    const mockStore = createMockStore({
      sessions: [
        {
          id: 'session-123',
          title: 'Test',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      messagesPerSession: {
        'session-123': [
          { role: 'user', content: 'Msg1', createdAt: now.toISOString() },
        ],
      },
    });

    const result = await archiveSession('session-123', mockStore, undefined, undefined);

    expect(result.messageCount).toBe(1);
    expect(mockStore.docUpsertCalls.length).toBe(1);
    expect(mockStore.saveEmbeddingCalls.length).toBe(0);
  });

  test('AC3.7: continues when EmbeddingProvider throws', async () => {
    const now = new Date('2026-01-15T12:00:00Z');
    const mockStore = createMockStore({
      sessions: [
        {
          id: 'session-123',
          title: 'Test',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      messagesPerSession: {
        'session-123': [
          { role: 'user', content: 'Msg1', createdAt: now.toISOString() },
        ],
      },
    });

    const mockEmbedding = createMockEmbeddingError();

    const result = await archiveSession('session-123', mockStore, undefined, mockEmbedding);

    expect(result.messageCount).toBe(1);
    expect(mockStore.docUpsertCalls.length).toBe(1);
  });
});

describe('pruneSessions', () => {
  test('AC3.5: deletes empty stale sessions, archives non-empty stale sessions, skips active', async () => {
    const now = new Date('2026-01-15T12:00:00Z');
    const twoAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago

    const mockStore = createMockStore({
      sessions: [
        {
          id: 'empty-session',
          title: 'Empty',
          createdAt: twoAgo.toISOString(),
          updatedAt: twoAgo.toISOString(),
        },
        {
          id: 'stale-session',
          title: 'Stale',
          createdAt: fiveDaysAgo.toISOString(),
          updatedAt: fiveDaysAgo.toISOString(),
        },
        {
          id: 'active-session',
          title: 'Active',
          createdAt: oneHourAgo.toISOString(),
          updatedAt: oneHourAgo.toISOString(),
        },
      ],
      messagesPerSession: {
        'empty-session': [],
        'stale-session': [
          { role: 'user', content: 'Msg1', createdAt: fiveDaysAgo.toISOString() },
          { role: 'assistant', content: 'Msg2', createdAt: new Date(fiveDaysAgo.getTime() + 1000).toISOString() },
          { role: 'user', content: 'Msg3', createdAt: new Date(fiveDaysAgo.getTime() + 2000).toISOString() },
          { role: 'assistant', content: 'Msg4', createdAt: new Date(fiveDaysAgo.getTime() + 3000).toISOString() },
          { role: 'user', content: 'Msg5', createdAt: new Date(fiveDaysAgo.getTime() + 4000).toISOString() },
          { role: 'assistant', content: 'Msg6', createdAt: new Date(fiveDaysAgo.getTime() + 5000).toISOString() },
          { role: 'user', content: 'Msg7', createdAt: new Date(fiveDaysAgo.getTime() + 6000).toISOString() },
          { role: 'assistant', content: 'Msg8', createdAt: new Date(fiveDaysAgo.getTime() + 7000).toISOString() },
        ],
        'active-session': [
          { role: 'user', content: 'Msg1', createdAt: oneHourAgo.toISOString() },
          { role: 'assistant', content: 'Msg2', createdAt: new Date(oneHourAgo.getTime() + 1000).toISOString() },
        ],
      },
    });

    const result = await pruneSessions(mockStore, undefined, undefined, undefined, now);

    expect(result.deleted).toBe(1);
    expect(result.archived).toBe(1);
    expect(result.details.length).toBe(2);

    const deletedDetail = result.details.find((d) => d.id === 'empty-session');
    expect(deletedDetail?.action).toBe('deleted');

    const archivedDetail = result.details.find((d) => d.id === 'stale-session');
    expect(archivedDetail?.action).toBe('archived');
    expect(archivedDetail?.rkey).toBeDefined();

    expect(mockStore.deleteSessionCalls).toEqual(expect.arrayContaining(['empty-session', 'stale-session']));
    expect(mockStore.deleteSessionCalls).not.toContain('active-session');
  });
});
