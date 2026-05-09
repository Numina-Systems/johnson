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

  test('agent/chat throws when message or sessionId is missing', async () => {
    const handlers = createHandlers({ store, agent });
    const handler = handlers['agent/chat'];

    await expect(handler({})).rejects.toThrow('agent/chat requires message and sessionId');
    await expect(handler({ message: 'hi' })).rejects.toThrow('agent/chat requires message and sessionId');
    await expect(handler({ sessionId: 's1' })).rejects.toThrow('agent/chat requires message and sessionId');
  });

  test('agent/chat concurrent requests are handled correctly (AC3.4)', async () => {
    const agentChatDelayMs = 100;

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

    const mockSessions = [
      { id: 'session-1', title: 'Session 1', updatedAt: '2026-05-09T10:00:00Z', messageCount: 5 },
    ];

    store.listSessionsPaginated = (limit?: number, cursor?: string) => ({
      sessions: mockSessions,
      cursor: undefined,
    });

    const handlers = createHandlers({ store, agent });
    const chatHandler = handlers['agent/chat'];
    const sessionListHandler = handlers['session/list'];

    // Record timestamps to verify order of completion
    const timestamps: Array<{event: string; time: number}> = [];

    // Call agent/chat (starts background work that takes ~100ms)
    const chatStartTime = Date.now();
    const chatPromise = chatHandler({ message: 'Hello', sessionId: 'session-123' });
    timestamps.push({event: 'agent/chat called', time: Date.now() - chatStartTime});

    // Immediately call session/list (should return quickly)
    const sessionListStartTime = Date.now();
    const sessionListPromise = sessionListHandler({});
    timestamps.push({event: 'session/list called', time: Date.now() - chatStartTime});

    // Wait for both to complete
    const [chatResult, sessionListResult] = await Promise.all([chatPromise, sessionListPromise]);
    timestamps.push({event: 'both completed', time: Date.now() - chatStartTime});

    // Verify results exist
    expect(chatResult).toHaveProperty('requestId');
    expect(sessionListResult).toBeDefined();
    expect(sessionListResult).toHaveProperty('sessions');

    // The key assertion: session/list should have returned very quickly (within 20ms of being called),
    // not blocked by agent/chat's 100ms delay
    const sessionListCompletionTime = Date.now() - sessionListStartTime;
    expect(sessionListCompletionTime).toBeLessThan(50);

    // Verify both requests completed successfully despite overlapping
    expect(chatResult.requestId.length).toBeGreaterThan(0);
  });
});

describe('skill handlers', () => {
  let store: Store;

  beforeEach(() => {
    store = createMockStore();
  });

  test('skill/list filters documents by skill: prefix and enriches with grant data (AC3.1)', async () => {
    store.docList = () => ({
      documents: [
        {
          rkey: 'skill:search',
          content: '// Description: Search the web\nconst code = "..."',
          createdAt: '2026-05-09T10:00:00Z',
          updatedAt: '2026-05-09T10:00:00Z',
        },
        {
          rkey: 'skill:summarize',
          content: '// Description: Summarize text\nconst code = "..."',
          createdAt: '2026-05-09T10:01:00Z',
          updatedAt: '2026-05-09T10:01:00Z',
        },
        {
          rkey: 'knowledge:something',
          content: 'Not a skill',
          createdAt: '2026-05-09T10:02:00Z',
          updatedAt: '2026-05-09T10:02:00Z',
        },
      ],
      cursor: undefined,
    });

    store.getGrant = (rkey: string) => {
      if (rkey === 'skill:search') {
        return {
          skillName: 'skill:search',
          codeHash: 'abc123',
          status: 'granted',
          secrets: ['EXA_API_KEY'],
          createdAt: '2026-05-09T10:00:00Z',
          updatedAt: '2026-05-09T10:00:00Z',
        };
      }
      if (rkey === 'skill:summarize') {
        return {
          skillName: 'skill:summarize',
          codeHash: 'def456',
          status: 'pending',
          secrets: [],
          createdAt: '2026-05-09T10:01:00Z',
          updatedAt: '2026-05-09T10:01:00Z',
        };
      }
      return null;
    };

    const handlers = createHandlers({ store });
    const handler = handlers['skill/list'];

    expect(handler).toBeDefined();
    const result = await handler({});

    expect(result.skills).toHaveLength(2);
    expect(result.skills[0]).toEqual({
      rkey: 'skill:search',
      description: 'Search the web',
      grantStatus: 'granted',
      secrets: ['EXA_API_KEY'],
    });
    expect(result.skills[1]).toEqual({
      rkey: 'skill:summarize',
      description: 'Summarize text',
      grantStatus: 'pending',
      secrets: [],
    });
  });

  test('skill/list returns null description and status when grant missing', async () => {
    store.docList = () => ({
      documents: [
        {
          rkey: 'skill:test',
          content: 'const code = "..."',
          createdAt: '2026-05-09T10:00:00Z',
          updatedAt: '2026-05-09T10:00:00Z',
        },
      ],
      cursor: undefined,
    });

    store.getGrant = () => null;

    const handlers = createHandlers({ store });
    const handler = handlers['skill/list'];

    const result = await handler({});

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].description).toBeNull();
    expect(result.skills[0].grantStatus).toBeNull();
    expect(result.skills[0].secrets).toEqual([]);
  });

  test('skill/grant calls updateGrantStatus with correct status', async () => {
    let capturedRkey: string | undefined;
    let capturedStatus: string | undefined;

    store.updateGrantStatus = (rkey: string, status: any) => {
      capturedRkey = rkey;
      capturedStatus = status;
    };

    const handlers = createHandlers({ store });
    const handler = handlers['skill/grant'];

    expect(handler).toBeDefined();
    const result = await handler({ rkey: 'skill:test', status: 'granted' });

    expect(result).toEqual({ ok: true });
    expect(capturedRkey).toBe('skill:test');
    expect(capturedStatus).toBe('granted');
  });

  test('skill/grant throws when rkey or status missing', async () => {
    const handlers = createHandlers({ store });
    const handler = handlers['skill/grant'];

    await expect(handler({})).rejects.toThrow('skill/grant requires rkey and status');
    await expect(handler({ rkey: 'skill:test' })).rejects.toThrow('skill/grant requires rkey and status');
    await expect(handler({ status: 'granted' })).rejects.toThrow('skill/grant requires rkey and status');
  });

  test('skill/updateSecrets calls updateGrantSecrets with array', async () => {
    let capturedRkey: string | undefined;
    let capturedSecrets: ReadonlyArray<string> | undefined;

    store.updateGrantSecrets = (rkey: string, secrets: ReadonlyArray<string>) => {
      capturedRkey = rkey;
      capturedSecrets = secrets;
    };

    const handlers = createHandlers({ store });
    const handler = handlers['skill/updateSecrets'];

    expect(handler).toBeDefined();
    const result = await handler({
      rkey: 'skill:test',
      secrets: ['API_KEY', 'SECRET'],
    });

    expect(result).toEqual({ ok: true });
    expect(capturedRkey).toBe('skill:test');
    expect(capturedSecrets).toEqual(['API_KEY', 'SECRET']);
  });

  test('skill/updateSecrets defaults to empty array when secrets omitted', async () => {
    let capturedSecrets: ReadonlyArray<string> | undefined;

    store.updateGrantSecrets = (rkey: string, secrets: ReadonlyArray<string>) => {
      capturedSecrets = secrets;
    };

    const handlers = createHandlers({ store });
    const handler = handlers['skill/updateSecrets'];

    const result = await handler({ rkey: 'skill:test' });

    expect(result).toEqual({ ok: true });
    expect(capturedSecrets).toEqual([]);
  });

  test('skill/delete calls both docDelete and deleteGrant (AC3.1)', async () => {
    let deletedDocRkey: string | undefined;
    let deletedGrantRkey: string | undefined;

    store.docDelete = (rkey: string) => {
      deletedDocRkey = rkey;
      return true;
    };

    store.deleteGrant = (rkey: string) => {
      deletedGrantRkey = rkey;
      return true;
    };

    const handlers = createHandlers({ store });
    const handler = handlers['skill/delete'];

    expect(handler).toBeDefined();
    const result = await handler({ rkey: 'skill:test' });

    expect(result).toEqual({ ok: true });
    expect(deletedDocRkey).toBe('skill:test');
    expect(deletedGrantRkey).toBe('skill:test');
  });

  test('skill/delete throws when rkey missing', async () => {
    const handlers = createHandlers({ store });
    const handler = handlers['skill/delete'];

    await expect(handler({})).rejects.toThrow('skill/delete requires rkey');
  });

  test('grant/list returns all grants from store', async () => {
    store.listGrants = () => [
      {
        skillName: 'skill:search',
        codeHash: 'abc123',
        status: 'granted',
        secrets: ['EXA_API_KEY'],
        createdAt: '2026-05-09T10:00:00Z',
        updatedAt: '2026-05-09T10:00:00Z',
      },
      {
        skillName: 'skill:summarize',
        codeHash: 'def456',
        status: 'pending',
        secrets: [],
        createdAt: '2026-05-09T10:01:00Z',
        updatedAt: '2026-05-09T10:01:00Z',
      },
    ];

    const handlers = createHandlers({ store });
    const handler = handlers['grant/list'];

    expect(handler).toBeDefined();
    const result = await handler({});

    expect(result.grants).toHaveLength(2);
    expect(result.grants[0].skillName).toBe('skill:search');
    expect(result.grants[1].status).toBe('pending');
  });
});

describe('custom tool handlers', () => {
  let store: Store;
  let customTools: any;

  beforeEach(() => {
    store = createMockStore();
    customTools = {
      listTools: () => [],
      getTool: (name: string) => undefined,
      saveTool: (tool: any) => ({ ...tool, approved: false, codeHash: 'hash' }),
      approveTool: (name: string) => false,
      revokeTool: (name: string) => false,
      updateSecrets: (name: string, secrets: ReadonlyArray<string>) => false,
      getApprovedToolSummaries: () => [],
    };
  });

  test('customTool/list returns all tools from manager', async () => {
    customTools.listTools = () => [
      {
        name: 'weather',
        description: 'Get weather',
        parameters: {},
        code: 'const code = "..."',
        approved: true,
        codeHash: 'abc123',
        secrets: ['WEATHER_API_KEY'],
      },
      {
        name: 'translate',
        description: 'Translate text',
        parameters: {},
        code: 'const code = "..."',
        approved: false,
        codeHash: 'def456',
        secrets: [],
      },
    ];

    const handlers = createHandlers({ store, customTools });
    const handler = handlers['customTool/list'];

    expect(handler).toBeDefined();
    const result = await handler({});

    expect(result.tools).toHaveLength(2);
    expect(result.tools[0]).toEqual({
      name: 'weather',
      description: 'Get weather',
      approved: true,
      codeHash: 'abc123',
      secrets: ['WEATHER_API_KEY'],
    });
    expect(result.tools[1].approved).toBe(false);
  });

  test('customTool/approve calls approveTool and returns result', async () => {
    let approvedName: string | undefined;

    customTools.approveTool = (name: string) => {
      approvedName = name;
      return true;
    };

    const handlers = createHandlers({ store, customTools });
    const handler = handlers['customTool/approve'];

    expect(handler).toBeDefined();
    const result = await handler({ name: 'weather' });

    expect(result).toEqual({ ok: true });
    expect(approvedName).toBe('weather');
  });

  test('customTool/approve returns ok: false on failure', async () => {
    customTools.approveTool = (name: string) => false;

    const handlers = createHandlers({ store, customTools });
    const handler = handlers['customTool/approve'];

    const result = await handler({ name: 'nonexistent' });

    expect(result).toEqual({ ok: false });
  });

  test('customTool/approve throws when name missing', async () => {
    const handlers = createHandlers({ store, customTools });
    const handler = handlers['customTool/approve'];

    await expect(handler({})).rejects.toThrow('customTool/approve requires name');
  });

  test('customTool/revoke calls revokeTool and returns result', async () => {
    let revokedName: string | undefined;

    customTools.revokeTool = (name: string) => {
      revokedName = name;
      return true;
    };

    const handlers = createHandlers({ store, customTools });
    const handler = handlers['customTool/revoke'];

    expect(handler).toBeDefined();
    const result = await handler({ name: 'weather' });

    expect(result).toEqual({ ok: true });
    expect(revokedName).toBe('weather');
  });

  test('customTool/updateSecrets calls updateSecrets and returns result', async () => {
    let updatedName: string | undefined;
    let updatedSecrets: ReadonlyArray<string> | undefined;

    customTools.updateSecrets = (name: string, secrets: ReadonlyArray<string>) => {
      updatedName = name;
      updatedSecrets = secrets;
      return true;
    };

    const handlers = createHandlers({ store, customTools });
    const handler = handlers['customTool/updateSecrets'];

    expect(handler).toBeDefined();
    const result = await handler({
      name: 'weather',
      secrets: ['WEATHER_API_KEY', 'CACHE_KEY'],
    });

    expect(result).toEqual({ ok: true });
    expect(updatedName).toBe('weather');
    expect(updatedSecrets).toEqual(['WEATHER_API_KEY', 'CACHE_KEY']);
  });

  test('customTool/updateSecrets throws when name missing', async () => {
    const handlers = createHandlers({ store, customTools });
    const handler = handlers['customTool/updateSecrets'];

    await expect(handler({})).rejects.toThrow('customTool/updateSecrets requires name');
  });
});

describe('builtin handler', () => {
  let store: Store;

  beforeEach(() => {
    store = createMockStore();
  });

  test('builtin/list returns static builtin tools list', async () => {
    const builtinTools = [
      { name: 'doc_upsert', description: 'Create or update a document' },
      { name: 'doc_delete', description: 'Delete a document' },
      { name: 'doc_search', description: 'Search documents' },
    ];

    const handlers = createHandlers({ store, builtinTools });
    const handler = handlers['builtin/list'];

    expect(handler).toBeDefined();
    const result = await handler({});

    expect(result).toEqual({ tools: builtinTools });
  });

  test('builtin/list returns empty array when no builtins provided', async () => {
    const handlers = createHandlers({ store, builtinTools: [] });
    const handler = handlers['builtin/list'];

    const result = await handler({});

    expect(result).toEqual({ tools: [] });
  });
});
