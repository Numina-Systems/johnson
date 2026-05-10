// pattern: Imperative Shell (test)

import { describe, test, expect, beforeEach } from 'bun:test';
import { createToolRegistry } from '../runtime/tool-registry.ts';
import { registerSessionTools } from './sessions.ts';
import type { AgentDependencies } from '../agent/types.ts';
import type { EmbeddingProvider } from '../embedding/types.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';
import type { Store } from '../store/store.ts';
import type { SessionWithCounts } from '../sessions/types.ts';

// Helper: Create a noop store base
function createNoopStore(): Store {
  return {
    docUpsert: () => {},
    docGet: () => null,
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
    getGrant: () => null,
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

interface MockStoreTest extends Store {
  docUpsertCalls: Array<{ rkey: string; content: string }>;
  deleteSessionCalls: string[];
}

function createMockStore(options: {
  sessions: SessionWithCounts[];
} = { sessions: [] }): MockStoreTest {
  const { sessions } = options;
  const docUpsertCalls: Array<{ rkey: string; content: string }> = [];
  const deleteSessionCalls: string[] = [];

  const base = createNoopStore();

  return {
    ...base,
    docUpsertCalls,
    deleteSessionCalls,
    listSessionsWithCounts: () => sessions,
    getSession: (id: string) => {
      const session = sessions.find((s) => s.id === id);
      if (!session) return null;
      return {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
    },
    getMessages: () => [], // Return empty messages for archive operation
    docUpsert: (rkey: string, content: string) => {
      docUpsertCalls.push({ rkey, content });
    },
    deleteSession: (id: string) => {
      const exists = sessions.some((s) => s.id === id);
      if (exists) {
        deleteSessionCalls.push(id);
        // Remove from sessions array
        const idx = sessions.findIndex((s) => s.id === id);
        if (idx >= 0) sessions.splice(idx, 1);
      }
      return exists;
    },
  };
}

function createMockDeps(overrides: {
  store?: Store;
  subAgent?: SubAgentLLM;
  embedding?: EmbeddingProvider;
} = {}): Readonly<AgentDependencies> {
  return {
    store: overrides.store || (undefined as any),
    subAgent: overrides.subAgent,
    embedding: overrides.embedding,
    model: undefined as any,
    runtime: undefined as any,
    config: undefined as any,
  };
}

describe('Session management tools', () => {
  let registry: ReturnType<typeof createToolRegistry>;

  describe('list_sessions', () => {
    test('AC4.1: returns all sessions with metadata and classification', async () => {
      const now = new Date();
      const nowStr = now.toISOString();
      const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();
      const twoAndHalfDaysAgo = new Date(now.getTime() - 2.5 * 24 * 60 * 60 * 1000).toISOString();

      const sessions: SessionWithCounts[] = [
        {
          id: 'active-1',
          title: 'Active Session',
          createdAt: nowStr,
          updatedAt: nowStr,
          messageCount: 1,
          lastMessageAt: nowStr,
        },
        {
          id: 'archive-1',
          title: 'Archive Candidate',
          createdAt: fourDaysAgo,
          updatedAt: fourDaysAgo,
          messageCount: 1,
          lastMessageAt: fourDaysAgo,
        },
        {
          id: 'delete-1',
          title: 'Delete Candidate',
          createdAt: twoAndHalfDaysAgo,
          updatedAt: twoAndHalfDaysAgo,
          messageCount: 0,
          lastMessageAt: null,
        },
      ];

      const store = createMockStore({ sessions });
      registry = createToolRegistry();
      const deps = createMockDeps({ store });
      registerSessionTools(registry, deps);

      const result = (await registry.execute('list_sessions', {})) as Array<any>;

      expect(result).toHaveLength(3);

      const activeResult = result.find((s) => s.title === 'Active Session');
      const archiveResult = result.find((s) => s.title === 'Archive Candidate');
      const deleteResult = result.find((s) => s.title === 'Delete Candidate');

      expect(activeResult).toBeDefined();
      expect(archiveResult).toBeDefined();
      expect(deleteResult).toBeDefined();

      expect(activeResult.classification).toBe('active');
      expect(archiveResult.classification).toBe('archive');
      expect(deleteResult.classification).toBe('delete');

      expect(activeResult.id).toBeDefined();
      expect(activeResult.messageCount).toBeGreaterThan(0);
      expect(activeResult.createdAt).toBeDefined();
      expect(activeResult.updatedAt).toBeDefined();
    });

    test('AC4.2: filter "stale" returns only delete and archive sessions', async () => {
      const now = new Date();
      const nowStr = now.toISOString();
      const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();
      const twoAndHalfDaysAgo = new Date(now.getTime() - 2.5 * 24 * 60 * 60 * 1000).toISOString();

      const sessions: SessionWithCounts[] = [
        {
          id: 'active-1',
          title: 'Active',
          createdAt: nowStr,
          updatedAt: nowStr,
          messageCount: 1,
          lastMessageAt: nowStr,
        },
        {
          id: 'archive-1',
          title: 'Archive',
          createdAt: fourDaysAgo,
          updatedAt: fourDaysAgo,
          messageCount: 1,
          lastMessageAt: fourDaysAgo,
        },
        {
          id: 'delete-1',
          title: 'Delete',
          createdAt: twoAndHalfDaysAgo,
          updatedAt: twoAndHalfDaysAgo,
          messageCount: 0,
          lastMessageAt: null,
        },
      ];

      const store = createMockStore({ sessions });
      registry = createToolRegistry();
      const deps = createMockDeps({ store });
      registerSessionTools(registry, deps);

      const result = (await registry.execute('list_sessions', {
        filter: 'stale',
      })) as Array<any>;

      expect(result).toHaveLength(2);
      const titles = result.map((s) => s.title).sort();
      expect(titles).toEqual(['Archive', 'Delete']);
    });

    test('filter "active" returns only active sessions', async () => {
      const now = new Date();
      const nowStr = now.toISOString();
      const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();

      const sessions: SessionWithCounts[] = [
        {
          id: 'active-1',
          title: 'Active 1',
          createdAt: nowStr,
          updatedAt: nowStr,
          messageCount: 1,
          lastMessageAt: nowStr,
        },
        {
          id: 'archive-1',
          title: 'Archive',
          createdAt: fourDaysAgo,
          updatedAt: fourDaysAgo,
          messageCount: 1,
          lastMessageAt: fourDaysAgo,
        },
      ];

      const store = createMockStore({ sessions });
      registry = createToolRegistry();
      const deps = createMockDeps({ store });
      registerSessionTools(registry, deps);

      const result = (await registry.execute('list_sessions', {
        filter: 'active',
      })) as Array<any>;

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Active 1');
      expect(result[0].classification).toBe('active');
    });

    test('filter "delete" returns only delete-classified sessions', async () => {
      const now = new Date();
      const nowStr = now.toISOString();
      const twoAndHalfDaysAgo = new Date(now.getTime() - 2.5 * 24 * 60 * 60 * 1000).toISOString();

      const sessions: SessionWithCounts[] = [
        {
          id: 'active-1',
          title: 'Active',
          createdAt: nowStr,
          updatedAt: nowStr,
          messageCount: 1,
          lastMessageAt: nowStr,
        },
        {
          id: 'delete-1',
          title: 'Delete',
          createdAt: twoAndHalfDaysAgo,
          updatedAt: twoAndHalfDaysAgo,
          messageCount: 0,
          lastMessageAt: null,
        },
      ];

      const store = createMockStore({ sessions });
      registry = createToolRegistry();
      const deps = createMockDeps({ store });
      registerSessionTools(registry, deps);

      const result = (await registry.execute('list_sessions', {
        filter: 'delete',
      })) as Array<any>;

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Delete');
      expect(result[0].classification).toBe('delete');
    });

    test('filter "archive" returns only archive-classified sessions', async () => {
      const now = new Date();
      const nowStr = now.toISOString();
      const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();

      const sessions: SessionWithCounts[] = [
        {
          id: 'active-1',
          title: 'Active',
          createdAt: nowStr,
          updatedAt: nowStr,
          messageCount: 1,
          lastMessageAt: nowStr,
        },
        {
          id: 'archive-1',
          title: 'Archive',
          createdAt: fourDaysAgo,
          updatedAt: fourDaysAgo,
          messageCount: 1,
          lastMessageAt: fourDaysAgo,
        },
      ];

      const store = createMockStore({ sessions });
      registry = createToolRegistry();
      const deps = createMockDeps({ store });
      registerSessionTools(registry, deps);

      const result = (await registry.execute('list_sessions', {
        filter: 'archive',
      })) as Array<any>;

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Archive');
      expect(result[0].classification).toBe('archive');
    });
  });

  describe('archive_session', () => {
    test('AC4.3: archives session and returns archive rkey', async () => {
      const now = new Date().toISOString();
      const sessions: SessionWithCounts[] = [
        {
          id: 'test-session-id',
          title: 'Test Session',
          createdAt: now,
          updatedAt: now,
          messageCount: 1,
          lastMessageAt: now,
        },
      ];

      const store = createMockStore({ sessions });
      registry = createToolRegistry();
      const deps = createMockDeps({ store });
      registerSessionTools(registry, deps);

      const result = (await registry.execute('archive_session', {
        session_id: 'test-session-id',
      })) as string;

      expect(result).toContain('Archived session as');
      expect(result).toContain('archive:session:');
    });

    test('throws error if session not found', async () => {
      const store = createMockStore({ sessions: [] });
      registry = createToolRegistry();
      const deps = createMockDeps({ store });
      registerSessionTools(registry, deps);

      try {
        await registry.execute('archive_session', {
          session_id: 'nonexistent-id',
        });
        expect.unreachable('Should have thrown');
      } catch (e: any) {
        expect(e.message).toContain('Session not found');
        expect(e.message).toContain('nonexistent-id');
      }
    });
  });

  describe('delete_session', () => {
    test('AC4.4: deletes session and returns confirmation', async () => {
      const now = new Date().toISOString();
      const sessions: SessionWithCounts[] = [
        {
          id: 'to-delete-id',
          title: 'To Delete',
          createdAt: now,
          updatedAt: now,
          messageCount: 1,
          lastMessageAt: now,
        },
      ];

      const store = createMockStore({ sessions });
      registry = createToolRegistry();
      const deps = createMockDeps({ store });
      registerSessionTools(registry, deps);

      const result = (await registry.execute('delete_session', {
        session_id: 'to-delete-id',
      })) as string;

      expect(result).toBe('Deleted session to-delete-id');
      expect(store.listSessionsWithCounts()).toHaveLength(0);
    });

    test('throws error if session not found', async () => {
      const store = createMockStore({ sessions: [] });
      registry = createToolRegistry();
      const deps = createMockDeps({ store });
      registerSessionTools(registry, deps);

      try {
        await registry.execute('delete_session', {
          session_id: 'nonexistent-id',
        });
        expect.unreachable('Should have thrown');
      } catch (e: any) {
        expect(e.message).toContain('Session not found');
        expect(e.message).toContain('nonexistent-id');
      }
    });
  });
});
