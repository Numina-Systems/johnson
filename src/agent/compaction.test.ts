// pattern: Functional Core (test)

import { describe, test, expect } from 'bun:test';
import { compactContext, formatConversation } from './compaction.ts';
import type { Message } from '../model/types.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';
import type { Store } from '../store/store.ts';

describe('formatConversation', () => {
  test('includes reasoning_content when present on assistant message', () => {
    const messages: Message[] = [
      { role: 'user', content: 'What is 2+2?' },
      {
        role: 'assistant',
        content: 'The answer is 4.',
        reasoning_content: 'Simple arithmetic: 2+2=4.',
      },
    ];

    const result = formatConversation(messages);

    expect(result).toContain('### assistant (reasoning)');
    expect(result).toContain('Simple arithmetic: 2+2=4.');
    expect(result).toContain('### assistant\nThe answer is 4.');
  });

  test('omits reasoning section when reasoning_content is absent', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];

    const result = formatConversation(messages);

    expect(result).not.toContain('(reasoning)');
    expect(result).toContain('### assistant\nHi there');
  });
});

type SubAgentCall = { prompt: string; system?: string };

function makeMockStore(documents: Array<{ rkey: string; content: string }>): {
  store: Store;
  upserts: Array<{ rkey: string; content: string }>;
} {
  const upserts: Array<{ rkey: string; content: string }> = [];
  const docs = [...documents];
  const store = {
    docUpsert: (rkey: string, content: string) => {
      upserts.push({ rkey, content });
      docs.push({ rkey, content });
    },
    docGet: () => null,
    docList: () => ({ documents: docs.slice(), cursor: undefined }),
    docListByPrefix: (prefix: string) => docs.filter((d) => d.rkey.startsWith(prefix)),
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
  } as unknown as Store;
  return { store, upserts };
}

function makeMockSubAgent(response: string): { subAgent: SubAgentLLM; calls: SubAgentCall[] } {
  const calls: SubAgentCall[] = [];
  const subAgent: SubAgentLLM = {
    async complete(prompt: string, system?: string) {
      calls.push({ prompt, system });
      return response;
    },
  };
  return { subAgent, calls };
}

describe('compactContext', () => {
  test('uses sub-agent for summarization when older context docs exist', async () => {
    const documents = [
      { rkey: 'context:session-1:2025-01-01T00-00-00', content: 'conversation 1' },
      { rkey: 'context:session-1:2025-01-02T00-00-00', content: 'conversation 2' },
      { rkey: 'context:session-1:2025-01-03T00-00-00', content: 'conversation 3' },
      { rkey: 'context:session-1:2025-01-04T00-00-00', content: 'conversation 4' },
      { rkey: 'context:session-1:2025-01-05T00-00-00', content: 'conversation 5' },
    ];
    const { store } = makeMockStore(documents);
    const { subAgent, calls } = makeMockSubAgent('Earlier topics: weather, coding');

    const messages: Message[] = [{ role: 'user', content: 'hello' }];
    const result = await compactContext(messages, { store, subAgent, sessionId: 'session-1' });

    expect(calls.length).toBe(1);
    expect(calls[0]!.system).toContain('context summarizer');

    const compactionContent = result[0]!.content as string;
    expect(compactionContent).toContain('Earlier topics: weather, coding');
  });

  test('skips sub-agent call when there are no older context docs to summarize', async () => {
    const documents = [
      { rkey: 'context:session-1:2025-01-01T00-00-00', content: 'conversation 1' },
      { rkey: 'context:session-1:2025-01-02T00-00-00', content: 'conversation 2' },
    ];
    const { store } = makeMockStore(documents);
    const { subAgent, calls } = makeMockSubAgent('unused summary');

    const messages: Message[] = [{ role: 'user', content: 'hi' }];
    await compactContext(messages, { store, subAgent, sessionId: 'session-1' });

    expect(calls.length).toBe(0);
  });

  test('writes context document with session-scoped rkey', async () => {
    const { store, upserts } = makeMockStore([]);
    const { subAgent } = makeMockSubAgent('summary');
    const messages: Message[] = [{ role: 'user', content: 'hello' }];

    await compactContext(messages, { store, subAgent, sessionId: 'test-session' });

    expect(upserts.length).toBeGreaterThanOrEqual(1);
    expect(upserts[0]!.rkey).toMatch(/^context:test-session:\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}-\d{3}$/);
  });

  test('sessions do not see each other\'s context documents', async () => {
    const sessionADocs = [
      { rkey: 'context:session-a:2025-01-01T00-00-00', content: 'session A conversation' },
      { rkey: 'context:session-a:2025-01-02T00-00-00', content: 'session A conversation 2' },
      { rkey: 'context:session-a:2025-01-03T00-00-00', content: 'session A conversation 3' },
      { rkey: 'context:session-a:2025-01-04T00-00-00', content: 'session A conversation 4' },
    ];
    const sessionBDocs = [
      { rkey: 'context:session-b:2025-01-01T00-00-00', content: 'session B conversation' },
      { rkey: 'context:session-b:2025-01-02T00-00-00', content: 'session B conversation 2' },
      { rkey: 'context:session-b:2025-01-03T00-00-00', content: 'session B conversation 3' },
      { rkey: 'context:session-b:2025-01-04T00-00-00', content: 'session B conversation 4' },
    ];

    // Test session-a isolation
    const { store: storeA, upserts: upsertsA } = makeMockStore([...sessionADocs, ...sessionBDocs]);
    const { subAgent: subAgentA } = makeMockSubAgent('summary A');

    const messagesA: Message[] = [{ role: 'user', content: 'hello from A' }];
    const resultA = await compactContext(messagesA, { store: storeA, subAgent: subAgentA, sessionId: 'session-a' });

    const compactionContentA = resultA[0]!.content as string;
    expect(compactionContentA).not.toContain('session B conversation');
    expect(upsertsA[0]!.rkey).toStartWith('context:session-a:');

    // Test session-b isolation (bidirectional verification)
    const { store: storeB, upserts: upsertsB } = makeMockStore([...sessionADocs, ...sessionBDocs]);
    const { subAgent: subAgentB } = makeMockSubAgent('summary B');

    const messagesB: Message[] = [{ role: 'user', content: 'hello from B' }];
    const resultB = await compactContext(messagesB, { store: storeB, subAgent: subAgentB, sessionId: 'session-b' });

    const compactionContentB = resultB[0]!.content as string;
    expect(compactionContentB).not.toContain('session A conversation');
    expect(upsertsB[0]!.rkey).toStartWith('context:session-b:');
  });

  test('uses "default" session when sessionId is not provided', async () => {
    const { store, upserts } = makeMockStore([]);
    const { subAgent } = makeMockSubAgent('summary');
    const messages: Message[] = [{ role: 'user', content: 'hello' }];

    await compactContext(messages, { store, subAgent });

    expect(upserts.length).toBeGreaterThanOrEqual(1);
    expect(upserts[0]!.rkey).toStartWith('context:default:');
  });
});
