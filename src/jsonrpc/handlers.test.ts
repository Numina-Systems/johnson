import { describe, test, expect, beforeEach } from 'bun:test';
import { createHandlers } from './handlers.ts';
import type { Store } from '../store/store.ts';

// Mock Store implementation
function createMockStore(): Store {
  return {
    // Documents
    docUpsert: () => {},
    docGet: () => null,
    docList: () => ({ documents: [] }),
    docDelete: () => false,
    docSearch: () => [],

    // Embeddings
    saveEmbedding: () => {},
    getEmbedding: () => null,
    getAllEmbeddings: () => [],
    getStaleEmbeddings: () => [],

    // Sessions
    createSession: () => {},
    ensureSession: () => {},
    getSession: () => null,
    listSessions: () => [],
    listSessionsPaginated: (limit?: number, cursor?: string) => ({
      sessions: [],
      cursor: undefined,
    }),
    updateSessionTitle: () => {},
    appendMessage: () => {},
    getMessages: () => [],
    getMessagesPaginated: (sessionId: string, limit?: number, cursor?: string) => ({
      messages: [],
      cursor: undefined,
    }),
    clearMessages: () => {},
    deleteSession: () => false,
    getSessionMessageCount: () => 0,

    // Tasks
    saveTask: () => {},
    listTasks: () => [],
    getTask: () => null,
    updateTaskRun: () => {},
    deleteTask: () => false,

    // Grants
    saveGrant: () => {},
    getGrant: () => null,
    listGrants: () => [],
    updateGrantStatus: () => {},
    updateGrantSecrets: () => {},
    deleteGrant: () => false,

    // Discord threads
    addManagedThread: () => {},
    removeManagedThread: () => false,
    getManagedThreadIds: () => new Set(),

    // Close
    close: () => {},
  } as unknown as Store;
}

describe('session handlers', () => {
  let store: Store;

  beforeEach(() => {
    store = createMockStore();
  });

  test('session/list handler returns sessions with cursor pagination', async () => {
    const mockSessions = [
      { id: 'session-1', title: 'Session 1', updatedAt: '2026-05-09T10:00:00Z', messageCount: 5 },
      { id: 'session-2', title: 'Session 2', updatedAt: '2026-05-09T10:05:00Z', messageCount: 3 },
    ];

    store.listSessionsPaginated = (limit?: number, cursor?: string) => ({
      sessions: mockSessions,
      cursor: 'next-cursor-123',
    });

    const handlers = createHandlers({ store });
    const handler = handlers['session/list'];

    expect(handler).toBeDefined();
    const result = await handler({ limit: 10, cursor: undefined });

    expect(result).toEqual({
      sessions: mockSessions,
      cursor: 'next-cursor-123',
    });
  });

  test('session/list handler with no cursor returns empty sessions at end', async () => {
    store.listSessionsPaginated = (limit?: number, cursor?: string) => ({
      sessions: [],
      cursor: undefined,
    });

    const handlers = createHandlers({ store });
    const handler = handlers['session/list'];

    const result = await handler({ limit: 10 });

    expect(result).toEqual({
      sessions: [],
      cursor: undefined,
    });
  });

  test('session/create handler generates UUID and returns id', async () => {
    let capturedId: string | undefined;
    let capturedTitle: string | undefined;

    store.createSession = (id: string, title?: string) => {
      capturedId = id;
      capturedTitle = title;
    };

    const handlers = createHandlers({ store });
    const handler = handlers['session/create'];

    expect(handler).toBeDefined();
    const result = await handler({ title: 'New Session' });

    expect(result).toEqual({ id: capturedId });
    expect(capturedId).toBeTruthy();
    expect(capturedTitle).toBe('New Session');
    // Verify it's a valid UUID format
    expect(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(capturedId!)).toBe(true);
  });

  test('session/create handler works without title', async () => {
    let capturedId: string | undefined;
    let capturedTitle: string | undefined;

    store.createSession = (id: string, title?: string) => {
      capturedId = id;
      capturedTitle = title;
    };

    const handlers = createHandlers({ store });
    const handler = handlers['session/create'];

    const result = await handler({});

    expect(result).toEqual({ id: capturedId });
    expect(capturedId).toBeTruthy();
    expect(capturedTitle).toBeUndefined();
  });

  test('session/delete handler returns ok: true on success', async () => {
    let deletedId: string | undefined;

    store.deleteSession = (id: string) => {
      deletedId = id;
      return true;
    };

    const handlers = createHandlers({ store });
    const handler = handlers['session/delete'];

    expect(handler).toBeDefined();
    const result = await handler({ id: 'session-123' });

    expect(result).toEqual({ ok: true });
    expect(deletedId).toBe('session-123');
  });

  test('session/delete handler returns ok: false on failure', async () => {
    store.deleteSession = () => false;

    const handlers = createHandlers({ store });
    const handler = handlers['session/delete'];

    const result = await handler({ id: 'nonexistent' });

    expect(result).toEqual({ ok: false });
  });

  test('session/messages handler returns paginated messages with cursor', async () => {
    const mockMessages = [
      { id: 1, role: 'user', content: 'Hello', createdAt: '2026-05-09T10:00:00Z' },
      { id: 2, role: 'assistant', content: 'Hi there', createdAt: '2026-05-09T10:01:00Z' },
    ];

    store.getMessagesPaginated = (sessionId: string, limit?: number, cursor?: string) => ({
      messages: mockMessages,
      cursor: 'next-msg-cursor',
    });

    const handlers = createHandlers({ store });
    const handler = handlers['session/messages'];

    expect(handler).toBeDefined();
    const result = await handler({
      sessionId: 'session-123',
      limit: 20,
      cursor: undefined,
    });

    expect(result).toEqual({
      messages: mockMessages,
      cursor: 'next-msg-cursor',
    });
  });

  test('session/messages handler with no cursor returns empty at end', async () => {
    store.getMessagesPaginated = (sessionId: string, limit?: number, cursor?: string) => ({
      messages: [],
      cursor: undefined,
    });

    const handlers = createHandlers({ store });
    const handler = handlers['session/messages'];

    const result = await handler({ sessionId: 'session-123' });

    expect(result).toEqual({
      messages: [],
      cursor: undefined,
    });
  });
});
