// pattern: Imperative Shell (test) — exercises session title logic with mocks

import { describe, expect, test } from 'bun:test';
import { maybeGenerateSessionTitle, postProcessTitle } from './session-title.ts';
import type { Store, DocumentRow, GrantRow } from '../store/store.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';
import type { Message } from '../model/types.ts';

type StoreOverrides = {
  getSession?: Store['getSession'];
  updateSessionTitle?: Store['updateSessionTitle'];
};

function makeStore(overrides: StoreOverrides = {}): Store {
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
    getSession: overrides.getSession ?? (() => null),
    listSessions: () => [],
    updateSessionTitle: overrides.updateSessionTitle ?? (() => {}),
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
    close: () => {},
  };
}

type SubAgentCall = { prompt: string; system?: string };

function makeSubAgent(
  result: string | (() => Promise<string>),
  calls: SubAgentCall[] = [],
): SubAgentLLM {
  return {
    async complete(prompt: string, system?: string): Promise<string> {
      calls.push({ prompt, system });
      if (typeof result === 'function') return result();
      return result;
    },
  };
}

function userMsg(text: string): Message {
  return { role: 'user', content: text };
}

function assistantMsg(text: string): Message {
  return { role: 'assistant', content: text };
}

describe('postProcessTitle', () => {
  test('strips leading and trailing double quotes', () => {
    expect(postProcessTitle('"Hello World"')).toBe('Hello World');
  });

  test('strips leading and trailing single quotes', () => {
    expect(postProcessTitle("'Hello World'")).toBe('Hello World');
  });

  test('strips trailing period', () => {
    expect(postProcessTitle('Hello World.')).toBe('Hello World');
  });

  test('strips trailing exclamation', () => {
    expect(postProcessTitle('Hello World!')).toBe('Hello World');
  });

  test('strips trailing question mark', () => {
    expect(postProcessTitle('Hello World?')).toBe('Hello World');
  });

  test('takes first line of multi-line input', () => {
    expect(postProcessTitle('First Line\nSecond Line')).toBe('First Line');
  });

  test('truncates to 80 characters', () => {
    const long = 'a'.repeat(100);
    expect(postProcessTitle(long)).toHaveLength(80);
  });

  test('handles combined quotes and trailing punctuation', () => {
    expect(postProcessTitle('"Hello World!"')).toBe('Hello World');
  });

  test('trims surrounding whitespace', () => {
    expect(postProcessTitle('  Hello World  ')).toBe('Hello World');
  });
});

describe('maybeGenerateSessionTitle', () => {
  test('GH05.AC7.1 happy path: generates and persists title', async () => {
    const calls: SubAgentCall[] = [];
    const updates: Array<{ id: string; title: string }> = [];
    const store = makeStore({
      getSession: () => ({
        id: 'sess-1',
        title: null,
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
      }),
      updateSessionTitle: (id: string, title: string) => {
        updates.push({ id, title });
      },
    });
    const subAgent = makeSubAgent('Discussing AI Agents', calls);
    const messages: Message[] = [
      userMsg('Tell me about AI agents'),
      assistantMsg('Sure, here are some thoughts...'),
      userMsg('What about tool use?'),
    ];

    await maybeGenerateSessionTitle(store, 'sess-1', subAgent, messages);

    expect(calls.length).toBe(1);
    expect(updates).toEqual([{ id: 'sess-1', title: 'Discussing AI Agents' }]);
  });

  test('GH05.AC8.1 skips when session already has title', async () => {
    const calls: SubAgentCall[] = [];
    let updateCalled = false;
    const store = makeStore({
      getSession: () => ({
        id: 'sess-1',
        title: 'Existing Title',
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
      }),
      updateSessionTitle: () => { updateCalled = true; },
    });
    const subAgent = makeSubAgent('Some Title', calls);
    const messages: Message[] = [
      userMsg('hi'),
      assistantMsg('hello'),
      userMsg('how are you'),
    ];

    await maybeGenerateSessionTitle(store, 'sess-1', subAgent, messages);

    expect(calls.length).toBe(0);
    expect(updateCalled).toBe(false);
  });

  test('GH05.AC9.1 skips when fewer than 2 user messages', async () => {
    const calls: SubAgentCall[] = [];
    let updateCalled = false;
    const store = makeStore({
      getSession: () => ({
        id: 'sess-1',
        title: null,
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
      }),
      updateSessionTitle: () => { updateCalled = true; },
    });
    const subAgent = makeSubAgent('Some Title', calls);
    const messages: Message[] = [
      userMsg('hello there'),
      assistantMsg('hi'),
    ];

    await maybeGenerateSessionTitle(store, 'sess-1', subAgent, messages);

    expect(calls.length).toBe(0);
    expect(updateCalled).toBe(false);
  });

  test('GH05.AC1.1 skips when sub-agent is undefined', async () => {
    let updateCalled = false;
    const store = makeStore({
      updateSessionTitle: () => { updateCalled = true; },
    });
    const messages: Message[] = [
      userMsg('one'),
      assistantMsg('reply'),
      userMsg('two'),
    ];

    await maybeGenerateSessionTitle(store, 'sess-1', undefined, messages);

    expect(updateCalled).toBe(false);
  });

  test('GH05.AC1.1 skips when sessionId is undefined', async () => {
    const calls: SubAgentCall[] = [];
    let updateCalled = false;
    const store = makeStore({
      updateSessionTitle: () => { updateCalled = true; },
    });
    const subAgent = makeSubAgent('Some Title', calls);
    const messages: Message[] = [
      userMsg('one'),
      assistantMsg('reply'),
      userMsg('two'),
    ];

    await maybeGenerateSessionTitle(store, undefined, subAgent, messages);

    expect(calls.length).toBe(0);
    expect(updateCalled).toBe(false);
  });

  test('GH05.AC5.1 propagates error from sub-agent (caller swallows)', async () => {
    const store = makeStore({
      getSession: () => ({
        id: 'sess-1',
        title: null,
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
      }),
    });
    const subAgent: SubAgentLLM = {
      async complete(): Promise<string> {
        throw new Error('sub-agent boom');
      },
    };
    const messages: Message[] = [
      userMsg('one'),
      assistantMsg('reply'),
      userMsg('two'),
    ];

    await expect(
      maybeGenerateSessionTitle(store, 'sess-1', subAgent, messages),
    ).rejects.toThrow('sub-agent boom');
  });

  test('GH05.AC2.1 formats messages as role: content, truncates to 200 chars, max 10 messages', async () => {
    const calls: SubAgentCall[] = [];
    const store = makeStore({
      getSession: () => ({
        id: 'sess-1',
        title: null,
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
      }),
    });
    const subAgent = makeSubAgent('Title Result', calls);
    const longContent = 'x'.repeat(250);
    const messages: Message[] = [];
    for (let i = 0; i < 12; i++) {
      messages.push(i % 2 === 0 ? userMsg(`u${i}`) : assistantMsg(`a${i}`));
    }
    messages[0] = userMsg(longContent);

    await maybeGenerateSessionTitle(store, 'sess-1', subAgent, messages);

    expect(calls.length).toBe(1);
    const prompt = calls[0]!.prompt;
    const lines = prompt.split('\n');
    expect(lines.length).toBe(10);
    expect(lines[0]).toBe(`user: ${'x'.repeat(200)}...`);
    expect(lines[1]).toBe('assistant: a1');
    expect(calls[0]!.system).toBeDefined();
    expect(calls[0]!.system).toContain('concise title');
  });

  test('does not call updateSessionTitle when post-processed title is empty', async () => {
    const calls: SubAgentCall[] = [];
    let updateCalled = false;
    const store = makeStore({
      getSession: () => ({
        id: 'sess-1',
        title: null,
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
      }),
      updateSessionTitle: () => { updateCalled = true; },
    });
    const subAgent = makeSubAgent('   ', calls);
    const messages: Message[] = [
      userMsg('one'),
      assistantMsg('reply'),
      userMsg('two'),
    ];

    await maybeGenerateSessionTitle(store, 'sess-1', subAgent, messages);

    expect(calls.length).toBe(1);
    expect(updateCalled).toBe(false);
  });
});
