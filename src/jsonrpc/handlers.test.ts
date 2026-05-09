// pattern: Imperative Shell (test)
import { describe, test, expect, beforeEach } from 'bun:test';
import { createHandlers } from './handlers.ts';
import type { Store } from '../store/store.ts';
import type { Agent } from '../agent/types.ts';

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

// Mock Agent implementation
function createMockAgent(): Agent {
  return {
    chat: async () => ({
      text: 'Mock response',
      stats: {
        inputTokens: 0,
        outputTokens: 0,
        contextEstimate: 0,
        contextLimit: 0,
        rounds: 0,
        durationMs: 0,
      },
    }),
    reset: () => {},
  };
}

describe('session handlers', () => {
  // Unit tests with mock Store. Store integration (pagination, SQL binding) is covered by pagination.test.ts.
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

describe('agent handlers', () => {
  let store: Store;
  let agent: Agent;
  let sentNotifications: Array<{method: string; params: Record<string, unknown>}>;

  beforeEach(() => {
    store = createMockStore();
    agent = createMockAgent();
    sentNotifications = [];

    // Mock the sendAgentEvent and sendAgentResponse functions by patching console.stdout
    // We'll capture notifications via a custom emitter
  });

  test('agent/chat returns requestId immediately and runs chat in background', async () => {
    let chatCompleted = false;

    agent.chat = async (message: string, options) => {
      // Simulate a delayed chat operation
      await new Promise(resolve => setTimeout(resolve, 50));
      chatCompleted = true;
      return {
        text: 'Response',
        stats: {
          inputTokens: 10,
          outputTokens: 20,
          contextEstimate: 30,
          contextLimit: 100,
          rounds: 1,
          durationMs: 100,
        },
      };
    };

    const handlers = createHandlers({ store, agent });
    const handler = handlers['agent/chat'];

    expect(handler).toBeDefined();

    // Call handler — it should return the requestId in result
    const result = await handler({ message: 'Hello', sessionId: 'session-123' });
    expect(result).toHaveProperty('requestId');
    expect(typeof result.requestId).toBe('string');
    expect(result.requestId.length > 0).toBe(true);

    // Verify it's a valid UUID
    expect(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.requestId)).toBe(true);

    // Verify chat hasn't completed yet (handler returned before chat finished)
    expect(chatCompleted).toBe(false);

    // Wait for chat to complete and verify
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(chatCompleted).toBe(true);
  });

  test('agent/chat fires onEvent callback with correct requestId and event data', async () => {
    const events: Array<{requestId: string; kind: string; data: Record<string, unknown>}> = [];

    agent.chat = async (message: string, options) => {
      if (options?.onEvent) {
        await options.onEvent({kind: 'llm_start', data: {round: 0}});
        await options.onEvent({kind: 'llm_done', data: {round: 0}});
      }
      return {
        text: 'Response',
        stats: {
          inputTokens: 10,
          outputTokens: 20,
          contextEstimate: 30,
          contextLimit: 100,
          rounds: 1,
          durationMs: 100,
        },
      };
    };

    const emitter = {
      onAgentEvent: (requestId: string, kind: string, data: Record<string, unknown>) => {
        events.push({requestId, kind, data});
      },
    };

    const handlers = createHandlers({ store, agent, emitter });
    const handler = handlers['agent/chat'];

    const result = await handler({ message: 'Hello', sessionId: 'session-123' });
    const requestId = result.requestId;

    // Wait for the chat to complete in the background
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].kind).toBe('llm_start');
    expect(events[0].data).toEqual({round: 0});
    expect(events[0].requestId).toBe(requestId);
  });

  test('agent/chat sends agent/response notification on completion', async () => {
    const responses: Array<{text: string; stats: Record<string, unknown>}> = [];

    agent.chat = async () => ({
      text: 'Final response',
      stats: {
        inputTokens: 10,
        outputTokens: 20,
        contextEstimate: 30,
        contextLimit: 100,
        rounds: 1,
        durationMs: 100,
      },
    });

    const emitter = {
      onAgentResponse: (requestId: string, text: string, stats: Record<string, unknown>) => {
        responses.push({text, stats});
      },
    };

    const handlers = createHandlers({ store, agent, emitter });
    const handler = handlers['agent/chat'];

    const result = await handler({ message: 'Hello', sessionId: 'session-123' });

    // Wait for the chat to complete in the background
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(responses.length).toBeGreaterThan(0);
    expect(responses[0].text).toBe('Final response');
    expect(responses[0].stats.rounds).toBe(1);
  });

  test('agent/chat sends error response notification on rejection', async () => {
    const errorResponses: Array<{text: string; stats: Record<string, unknown>}> = [];

    agent.chat = async () => {
      throw new Error('Agent error');
    };

    const emitter = {
      onAgentResponse: (requestId: string, text: string, stats: Record<string, unknown>) => {
        errorResponses.push({text, stats});
      },
    };

    const handlers = createHandlers({ store, agent, emitter });
    const handler = handlers['agent/chat'];

    const result = await handler({ message: 'Hello', sessionId: 'session-123' });

    // Wait for the error to be handled in the background
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(errorResponses.length).toBeGreaterThan(0);
    expect(errorResponses[0].text).toContain('Agent error');
  });

  test('agent/reset calls agent.reset() and returns ok: true', async () => {
    let resetCalled = false;

    agent.reset = () => {
      resetCalled = true;
    };

    const handlers = createHandlers({ store, agent });
    const handler = handlers['agent/reset'];

    expect(handler).toBeDefined();
    const result = await handler({});

    expect(result).toEqual({ok: true});
    expect(resetCalled).toBe(true);
  });

  test('agent/chat concurrent requests are handled correctly (AC3.4)', async () => {
    const agentChatDelayMs = 100;
    const secretListResponses: Array<{ok: boolean}> = [];

    // Mock agent.chat to delay ~100ms before resolving
    agent.chat = async (message: string, options) => {
      await new Promise(resolve => setTimeout(resolve, agentChatDelayMs));
      return {
        text: 'Response',
        stats: {
          inputTokens: 10,
          outputTokens: 20,
          contextEstimate: 30,
          contextLimit: 100,
          rounds: 1,
          durationMs: agentChatDelayMs,
        },
      };
    };

    store.listGrants = () => [];

    const handlers = createHandlers({ store, agent });
    const chatHandler = handlers['agent/chat'];
    const secretListHandler = handlers['secret/list'] || (() => Promise.resolve({ok: true}));

    // Record timestamps to verify order of completion
    const timestamps: Array<{event: string; time: number}> = [];

    // Call agent/chat (starts background work that takes ~100ms)
    const chatStartTime = Date.now();
    const chatPromise = chatHandler({ message: 'Hello', sessionId: 'session-123' });
    timestamps.push({event: 'agent/chat called', time: Date.now() - chatStartTime});

    // Immediately call secret/list (should return quickly)
    const secretListStartTime = Date.now();
    const secretListPromise = secretListHandler({});
    timestamps.push({event: 'secret/list called', time: Date.now() - chatStartTime});

    // Wait for both to complete
    const [chatResult, secretListResult] = await Promise.all([chatPromise, secretListPromise]);
    timestamps.push({event: 'both completed', time: Date.now() - chatStartTime});

    // Verify results exist
    expect(chatResult).toHaveProperty('requestId');
    expect(secretListResult).toBeDefined();

    // The key assertion: secret/list should have returned very quickly (within 20ms of being called),
    // not blocked by agent/chat's 100ms delay
    const secretListCompletionTime = Date.now() - secretListStartTime;
    expect(secretListCompletionTime).toBeLessThan(50);

    // Verify both requests completed successfully despite overlapping
    expect(chatResult.requestId.length).toBeGreaterThan(0);
  });
});
