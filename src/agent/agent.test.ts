// pattern: Imperative Shell (test) — exercises agent loop with mocks

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgent } from './agent.ts';
import type { ModelResponse, Message, ModelRequest } from '../model/types.ts';
import type { AgentDependencies } from './types.ts';
import type { Store, DocumentRow, GrantRow } from '../store/store.ts';
import type { CodeRuntime, ExecutionResult } from '../runtime/types.ts';

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
    updateSessionTitle: () => {},
    appendMessage: () => {},
    getMessages: () => [],
    clearMessages: () => {},
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

const noopRuntime: CodeRuntime = {
  async execute(): Promise<ExecutionResult> {
    return { success: true, output: '', error: null, duration_ms: 0 };
  },
};

describe('agent reasoning_content propagation', () => {
  let tmpDir: string;
  let personaPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gh11-agent-test-'));
    personaPath = join(tmpDir, 'persona.md');
    writeFileSync(personaPath, '# Test Persona\nYou are a test agent.');
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('reasoning_content from model response appears on history message sent to next call', async () => {
    const receivedMessages: ReadonlyArray<Message>[] = [];

    const responses: ModelResponse[] = [
      {
        content: [{ type: 'text', text: 'I have responded.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
        reasoning_content: 'Let me think step by step about this problem.',
      },
      {
        content: [{ type: 'text', text: 'Second response.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 12, output_tokens: 4 },
      },
    ];

    let callIndex = 0;
    const mockModel = {
      async complete(request: Readonly<ModelRequest>): Promise<ModelResponse> {
        receivedMessages.push(request.messages);
        const response = responses[callIndex];
        callIndex++;
        if (!response) throw new Error('Unexpected extra model call');
        return response;
      },
    };

    const deps: AgentDependencies = {
      model: mockModel,
      runtime: noopRuntime,
      config: {
        model: 'mock-model',
        maxTokens: 100,
        maxToolRounds: 3,
        contextBudget: 0.9,
        contextLimit: 100_000,
        modelTimeout: 30_000,
        timezone: 'UTC',
      },
      personaPath,
      store: createNoopStore(),
    };

    const agent = createAgent(deps);

    const first = await agent.chat('first user message');
    expect(first.text).toBe('I have responded.');

    await agent.chat('second user message');

    // The second call's messages should include the assistant message from the first call.
    // That assistant message must carry reasoning_content.
    const secondCallMessages = receivedMessages[1];
    expect(secondCallMessages).toBeDefined();

    const assistantMessage = secondCallMessages!.find(
      (m) => m.role === 'assistant',
    );
    expect(assistantMessage).toBeDefined();
    expect(assistantMessage!.reasoning_content).toBe(
      'Let me think step by step about this problem.',
    );
  });

  test('absent reasoning_content does not pollute the assistant history message', async () => {
    const receivedMessages: ReadonlyArray<Message>[] = [];

    const responses: ModelResponse[] = [
      {
        content: [{ type: 'text', text: 'No reasoning here.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        content: [{ type: 'text', text: 'Done.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 12, output_tokens: 4 },
      },
    ];

    let callIndex = 0;
    const mockModel = {
      async complete(request: Readonly<ModelRequest>): Promise<ModelResponse> {
        receivedMessages.push(request.messages);
        const response = responses[callIndex];
        callIndex++;
        if (!response) throw new Error('Unexpected extra model call');
        return response;
      },
    };

    const deps: AgentDependencies = {
      model: mockModel,
      runtime: noopRuntime,
      config: {
        model: 'mock-model',
        maxTokens: 100,
        maxToolRounds: 3,
        contextBudget: 0.9,
        contextLimit: 100_000,
        modelTimeout: 30_000,
        timezone: 'UTC',
      },
      personaPath,
      store: createNoopStore(),
    };

    const agent = createAgent(deps);
    await agent.chat('first');
    await agent.chat('second');

    const secondCallMessages = receivedMessages[1];
    const assistantMessage = secondCallMessages!.find((m) => m.role === 'assistant');
    expect(assistantMessage).toBeDefined();
    expect(assistantMessage!.reasoning_content).toBeUndefined();
  });
});
