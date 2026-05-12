import { describe, expect, test, mock, beforeEach } from 'bun:test';
import blessed from 'neo-blessed';
import type { Widgets } from 'blessed';
import { EventEmitter } from 'events';
import { createChatView, findMatches } from './chat.ts';
import type { Agent, ChatOptions } from '../../agent/types.ts';
import type { Store, GrantRow } from '../../store/store.ts';

function createControlledPromise<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const createMockAgent = (): Agent => ({
  chat: mock(async (msg: string) => ({
    text: `response to: ${msg}`,
    stats: {
      inputTokens: 10,
      outputTokens: 20,
      contextEstimate: 100,
      contextLimit: 2000,
      rounds: 1,
      durationMs: 500,
    } as const,
  })),
  reset: mock(() => {}),
});

const createMockStore = (): Store => ({
  docUpsert: mock(() => {}),
  docGet: mock(() => null),
  docList: mock(() => ({ documents: [] })),
  docDelete: mock(() => false),
  docSearch: mock(() => []),
  saveEmbedding: mock(() => {}),
  getEmbedding: mock(() => null),
  getAllEmbeddings: mock(() => []),
  getStaleEmbeddings: mock(() => []),
  createSession: mock(() => {}),
  ensureSession: mock(() => {}),
  getSession: mock(() => null),
  listSessions: mock(() => []),
  listSessionsWithCounts: mock(() => []),
  updateSessionTitle: mock(() => {}),
  appendMessage: mock(() => {}),
  getMessages: mock(() => []),
  clearMessages: mock(() => {}),
  deleteSession: mock(() => false),
  getSessionMessageCount: mock(() => 0),
  saveTask: mock(() => {}),
  listTasks: mock(() => []),
  getTask: mock(() => null),
  updateTaskRun: mock(() => {}),
  deleteTask: mock(() => false),
  saveGrant: mock(() => {}),
  getGrant: mock((): GrantRow | null => null),
  listGrants: mock(() => []),
  updateGrantStatus: mock(() => {}),
  updateGrantSecrets: mock(() => {}),
  deleteGrant: mock((): boolean => false),
  addManagedThread: mock(() => {}),
  removeManagedThread: mock((): boolean => false),
  getManagedThreadIds: mock((): Set<string> => new Set()),
  close: mock(() => {}),
});

function findTextarea(container: Widgets.BoxElement): Widgets.TextareaElement | null {
  for (const child of container.children) {
    if ('getValue' in child && 'setValue' in child && 'clearValue' in child) {
      return child as Widgets.TextareaElement;
    }
  }
  return null;
}

function triggerSubmit(textarea: Widgets.TextareaElement, text: string): void {
  textarea.setValue(text);
  textarea.emit('key enter', '\r', { name: 'enter', full: 'enter' });
}

describe('createChatView', () => {
  let screen: Widgets.Screen;
  let agent: Agent;
  let store: Store;
  let bus: EventEmitter;

  beforeEach(() => {
    screen = blessed.screen({ smartCSR: true });
    agent = createMockAgent();
    store = createMockStore();
    bus = new EventEmitter();
  });

  test('creates a view with Chat name', () => {
    const view = createChatView({ screen, agent, store, bus });

    expect(view.name).toBe('Chat');
    expect(view.container).toBeDefined();
  });

  test('returns ScreenView with required methods', () => {
    const view = createChatView({ screen, agent, store, bus });

    expect(typeof view.show).toBe('function');
    expect(typeof view.hide).toBe('function');
    expect(typeof view.focus).toBe('function');
    expect(typeof view.destroy).toBe('function');
  });

  test('isCapturingInput is always true', () => {
    const view = createChatView({ screen, agent, store, bus });

    expect(view.isCapturingInput).toBe(true);
  });

  test('loads messages on session:selected event', async () => {
    const mockStore = store as any;
    mockStore.getMessages = mock(() => [
      { role: 'user', content: 'hello', createdAt: '2026-05-11T10:00:00Z' },
      { role: 'assistant', content: 'world', createdAt: '2026-05-11T10:00:01Z' },
    ]);

    createChatView({ screen, agent, store, bus });
    bus.emit('session:selected', { sessionId: 'test-session-123' });

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockStore.getMessages.mock.calls.length).toBeGreaterThan(0);
  });

  test('submitting empty text does not send message', async () => {
    const mockAgent = agent as any;
    const view = createChatView({ screen, agent, store, bus });

    bus.emit('session:selected', { sessionId: 'test-123' });
    await new Promise(resolve => setTimeout(resolve, 50));

    const textarea = findTextarea(view.container);
    expect(textarea).not.toBeNull();

    // Submit empty text
    triggerSubmit(textarea!, '');

    expect(mockAgent.chat.mock.calls.length).toBe(0);
  });

  test('view can be shown and hidden', () => {
    const view = createChatView({ screen, agent, store, bus });

    expect(() => view.show()).not.toThrow();
    expect(() => view.hide()).not.toThrow();
  });

  test('container is initially hidden', () => {
    const view = createChatView({ screen, agent, store, bus });

    expect(view.container.hidden).toBe(true);
  });

  test('focus() focuses the input textarea', () => {
    const view = createChatView({ screen, agent, store, bus });

    expect(() => view.focus()).not.toThrow();
  });

  test('can be destroyed', () => {
    const view = createChatView({ screen, agent, store, bus });

    expect(() => view.destroy()).not.toThrow();
  });

  test('input textarea does not have tags enabled [AC6.1]', () => {
    const view = createChatView({ screen, agent, store, bus });
    const textarea = findTextarea(view.container);

    expect(textarea).not.toBeNull();
    expect((textarea as any).parseTags).not.toBe(true);
  });

  test('findMatches returns correct indices for case-insensitive matching [AC9.2]', () => {
    const messages = [
      { text: 'Hello world' },
      { text: 'HELLO EARTH' },
      { text: 'goodbye' },
      { text: 'HeLLo SuN' },
    ];

    const result = findMatches(messages, 'hello');
    expect(result).toEqual([0, 1, 3]);
  });

  test('findMatches returns empty for empty query', () => {
    const messages = [
      { text: 'Hello world' },
      { text: 'HELLO EARTH' },
    ];

    const result = findMatches(messages, '');
    expect(result).toEqual([]);
  });

  test('findMatches returns empty when no messages match', () => {
    const messages = [
      { text: 'Hello world' },
      { text: 'HELLO EARTH' },
    ];

    const result = findMatches(messages, 'xyz');
    expect(result).toEqual([]);
  });

  test('findMatches returns all indices when all match', () => {
    const messages = [
      { text: 'the quick brown fox' },
      { text: 'the lazy dog' },
      { text: 'the big cat' },
    ];

    const result = findMatches(messages, 'the');
    expect(result).toEqual([0, 1, 2]);
  });

  test('findMatches handles single message array', () => {
    const messages = [{ text: 'hello' }];

    const result = findMatches(messages, 'hello');
    expect(result).toEqual([0]);
  });

  test('findMatches handles empty message array', () => {
    const messages: Array<{ text: string }> = [];

    const result = findMatches(messages, 'hello');
    expect(result).toEqual([]);
  });

  test('submitting message calls agent.chat and persists response [AC1.2]', async () => {
    const controlled = createControlledPromise<{ text: string; stats: any }>();
    const mockAgent = agent as any;
    mockAgent.chat = mock(() => controlled.promise);

    const view = createChatView({ screen, agent, store, bus });
    bus.emit('session:selected', { sessionId: 'test-session' });
    await new Promise(resolve => setTimeout(resolve, 50));

    const textarea = findTextarea(view.container);
    expect(textarea).not.toBeNull();
    triggerSubmit(textarea!, 'hello world');

    // Agent should have been called
    expect(mockAgent.chat.mock.calls.length).toBe(1);
    expect(mockAgent.chat.mock.calls[0][0]).toBe('hello world');

    // User message should be persisted
    expect((store.appendMessage as any).mock.calls.length).toBe(1);

    // Resolve the agent response
    controlled.resolve({
      text: 'agent reply',
      stats: { inputTokens: 10, outputTokens: 20, contextEstimate: 100, contextLimit: 2000, rounds: 1, durationMs: 100 },
    });
    await controlled.promise;
    await new Promise(resolve => setTimeout(resolve, 10));

    // Agent response should be persisted
    expect((store.appendMessage as any).mock.calls.length).toBe(2);
    expect((store.appendMessage as any).mock.calls[1][2]).toBe('agent reply');
  });

  test('hide() does not interrupt in-progress agent.chat() [AC4.3]', async () => {
    const controlled = createControlledPromise<{ text: string; stats: any }>();
    const mockAgent = agent as any;
    mockAgent.chat = mock(() => controlled.promise);

    const view = createChatView({ screen, agent, store, bus });
    bus.emit('session:selected', { sessionId: 'test-session' });
    await new Promise(resolve => setTimeout(resolve, 50));

    const textarea = findTextarea(view.container);
    expect(textarea).not.toBeNull();

    // Submit a message — starts agent.chat() promise
    view.show();
    triggerSubmit(textarea!, 'test message');
    expect(mockAgent.chat.mock.calls.length).toBe(1);

    // Hide the view while agent is still processing
    view.hide();
    expect(view.container.hidden).toBe(true);

    // Resolve the agent response after hide
    controlled.resolve({
      text: 'delayed response',
      stats: { inputTokens: 10, outputTokens: 20, contextEstimate: 100, contextLimit: 2000, rounds: 1, durationMs: 100 },
    });
    await controlled.promise;
    await new Promise(resolve => setTimeout(resolve, 10));

    // Agent response should STILL be persisted despite view being hidden
    const appendCalls = (store.appendMessage as any).mock.calls;
    const agentResponsePersisted = appendCalls.some(
      (call: Array<unknown>) => call[1] === 'assistant' && call[2] === 'delayed response'
    );
    expect(agentResponsePersisted).toBe(true);
  });

  test('/reset command clears history and calls agent.reset()', async () => {
    const view = createChatView({ screen, agent, store, bus });
    bus.emit('session:selected', { sessionId: 'test-session' });
    await new Promise(resolve => setTimeout(resolve, 50));

    const textarea = findTextarea(view.container);
    expect(textarea).not.toBeNull();

    // Submit /reset command
    triggerSubmit(textarea!, '/reset');

    // agent.reset() should have been called
    expect((agent.reset as any).mock.calls.length).toBe(1);

    // store.clearMessages should have been called with the session ID
    expect((store.clearMessages as any).mock.calls.length).toBe(1);
    expect((store.clearMessages as any).mock.calls[0][0]).toBe('test-session');

    // agent.chat should NOT have been called (commands don't go to agent)
    expect((agent.chat as any).mock.calls.length).toBe(0);
  });
});
