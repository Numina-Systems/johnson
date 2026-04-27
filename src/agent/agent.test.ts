// pattern: Imperative Shell (test) — exercises agent loop with mocks

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgent } from './agent.ts';
import type {
  ModelResponse,
  Message,
  ModelRequest,
  ModelProvider,
} from '../model/types.ts';
import type { AgentConfig, AgentDependencies } from './types.ts';
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

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    model: 'mock-model',
    maxTokens: 1024,
    maxToolRounds: 2,
    contextBudget: 0.9,
    contextLimit: 100_000,
    modelTimeout: 30_000,
    timezone: 'UTC',
    ...overrides,
  };
}

function makeDeps(
  model: ModelProvider,
  config: AgentConfig,
  personaPath: string,
): AgentDependencies {
  return {
    model,
    runtime: noopRuntime,
    config,
    personaPath,
    store: createNoopStore(),
  };
}

type ModelCall = {
  request: ModelRequest;
  toolsCount: number;
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
    const mockModel: ModelProvider = {
      async complete(request: Readonly<ModelRequest>): Promise<ModelResponse> {
        receivedMessages.push(request.messages);
        const response = responses[callIndex];
        callIndex++;
        if (!response) throw new Error('Unexpected extra model call');
        return response;
      },
    };

    const agent = createAgent(makeDeps(mockModel, makeConfig({ maxToolRounds: 3 }), personaPath));

    const first = await agent.chat('first user message');
    expect(first.text).toBe('I have responded.');

    await agent.chat('second user message');

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
    const mockModel: ModelProvider = {
      async complete(request: Readonly<ModelRequest>): Promise<ModelResponse> {
        receivedMessages.push(request.messages);
        const response = responses[callIndex];
        callIndex++;
        if (!response) throw new Error('Unexpected extra model call');
        return response;
      },
    };

    const agent = createAgent(makeDeps(mockModel, makeConfig({ maxToolRounds: 3 }), personaPath));
    await agent.chat('first');
    await agent.chat('second');

    const secondCallMessages = receivedMessages[1];
    const assistantMessage = secondCallMessages!.find((m) => m.role === 'assistant');
    expect(assistantMessage).toBeDefined();
    expect(assistantMessage!.reasoning_content).toBeUndefined();
  });
});

describe('graceful max-iteration exhaustion', () => {
  let tmpDir: string;
  let personaPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gh01-agent-test-'));
    personaPath = join(tmpDir, 'persona.md');
    writeFileSync(personaPath, '# Test Persona\nYou are a test agent.');
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('GH01.AC1.1: system nudge appears in history when maxToolRounds exhausted', async () => {
    const calls: ModelCall[] = [];
    const model: ModelProvider = {
      complete: async (req) => {
        calls.push({ request: req, toolsCount: req.tools?.length ?? 0 });
        if ((req.tools?.length ?? 0) === 0) {
          return {
            content: [{ type: 'text', text: 'Forced wrap-up response' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 3 },
          };
        }
        return {
          content: [{ type: 'tool_use', id: `t${calls.length}`, name: 'execute_code', input: { code: 'output(1)' } }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 4 },
        };
      },
    };

    const agent = createAgent(makeDeps(model, makeConfig({ maxToolRounds: 2 }), personaPath));
    const result = await agent.chat('hello');

    expect(calls.length).toBe(3);
    expect(calls[2]?.toolsCount).toBe(0);

    expect(result.text).toBe('Forced wrap-up response');
  });

  test('GH01.AC2.1: final call uses tools: [] and produces text', async () => {
    const calls: ModelCall[] = [];
    const model: ModelProvider = {
      complete: async (req) => {
        calls.push({ request: req, toolsCount: req.tools?.length ?? 0 });
        if ((req.tools?.length ?? 0) === 0) {
          return {
            content: [{ type: 'text', text: 'Final text' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        }
        return {
          content: [{ type: 'tool_use', id: `t${calls.length}`, name: 'execute_code', input: { code: 'output(1)' } }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    };

    const agent = createAgent(makeDeps(model, makeConfig({ maxToolRounds: 2 }), personaPath));
    const result = await agent.chat('hello');

    expect(result.text).toBe('Final text');
    const finalCall = calls[calls.length - 1];
    expect(finalCall?.request.tools).toEqual([]);
  });

  test('GH01.AC2.2: usage stats include the forced final call', async () => {
    const model: ModelProvider = {
      complete: async (req) => {
        if ((req.tools?.length ?? 0) === 0) {
          return {
            content: [{ type: 'text', text: 'final' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 7, output_tokens: 11 },
          };
        }
        return {
          content: [{ type: 'tool_use', id: 'x', name: 'execute_code', input: { code: 'output(1)' } }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 13, output_tokens: 17 },
        };
      },
    };

    const agent = createAgent(makeDeps(model, makeConfig({ maxToolRounds: 2 }), personaPath));
    const result = await agent.chat('hello');

    expect(result.stats.inputTokens).toBe(13 + 13 + 7);
    expect(result.stats.outputTokens).toBe(17 + 17 + 11);
  });

  test('GH01.AC2.3: rounds count includes the final call (maxToolRounds + 1)', async () => {
    const model: ModelProvider = {
      complete: async (req) => {
        if ((req.tools?.length ?? 0) === 0) {
          return {
            content: [{ type: 'text', text: 'done' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        }
        return {
          content: [{ type: 'tool_use', id: 'y', name: 'execute_code', input: { code: 'output(1)' } }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    };

    const agent = createAgent(makeDeps(model, makeConfig({ maxToolRounds: 3 }), personaPath));
    const result = await agent.chat('hello');

    expect(result.stats.rounds).toBe(4);
  });

  test('GH01.AC3.1: normal end_turn exit injects no nudge and makes one call', async () => {
    let callCount = 0;
    const model: ModelProvider = {
      complete: async (_req) => {
        callCount++;
        return {
          content: [{ type: 'text', text: 'hi' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 4, output_tokens: 2 },
        };
      },
    };

    const agent = createAgent(makeDeps(model, makeConfig({ maxToolRounds: 5 }), personaPath));
    const result = await agent.chat('hello');

    expect(callCount).toBe(1);
    expect(result.text).toBe('hi');
    expect(result.stats.rounds).toBe(1);
    expect(result.stats.inputTokens).toBe(4);
    expect(result.stats.outputTokens).toBe(2);
  });

  test('GH01.AC4.1: end-to-end always-tool_use model produces forced text response', async () => {
    const calls: ModelCall[] = [];
    const model: ModelProvider = {
      complete: async (req) => {
        calls.push({ request: req, toolsCount: req.tools?.length ?? 0 });
        if ((req.tools?.length ?? 0) === 0) {
          return {
            content: [{ type: 'text', text: 'Forced wrap-up response' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 9, output_tokens: 6 },
          };
        }
        return {
          content: [{ type: 'tool_use', id: `t${calls.length}`, name: 'execute_code', input: { code: 'output(1)' } }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    };

    const agent = createAgent(makeDeps(model, makeConfig({ maxToolRounds: 3 }), personaPath));
    const result = await agent.chat('please do work');

    expect(result.text).toBe('Forced wrap-up response');
    expect(result.stats.rounds).toBe(4);
    expect(result.stats.inputTokens).toBe(10 * 3 + 9);
    expect(result.stats.outputTokens).toBe(5 * 3 + 6);

    expect(calls.length).toBe(4);
    expect(calls[0]?.toolsCount).toBe(1);
    expect(calls[1]?.toolsCount).toBe(1);
    expect(calls[2]?.toolsCount).toBe(1);
    expect(calls[3]?.toolsCount).toBe(0);

    const finalReq = calls[3]?.request;
    const nudgeMessage = finalReq?.messages.find(
      (m) => m.role === 'user' && m.content === '[System: Max tool calls reached. Provide final response now.]',
    );
    expect(nudgeMessage).toBeDefined();
  });
});
