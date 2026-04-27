// pattern: Imperative Shell — agent loop tests with mocked dependencies

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent } from './agent.ts';
import type { AgentConfig, AgentDependencies } from './types.ts';
import type { Message, ModelProvider, ModelRequest, ModelResponse } from '../model/types.ts';
import type { CodeRuntime } from '../runtime/types.ts';
import type { Store, DocumentRow } from '../store/store.ts';

type ModelCall = {
  request: ModelRequest;
  toolsCount: number;
};

function makeStore(): Store {
  return {
    docUpsert: () => {},
    docGet: (_rkey: string) => null as DocumentRow | null,
    docList: (_limit?: number, _cursor?: string) => ({ documents: [], cursor: undefined }),
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
    listMessages: () => [],
    deleteSession: () => false,
    saveTask: () => {},
    getTask: () => null,
    listTasks: () => [],
    deleteTask: () => false,
    updateTaskRun: () => {},
    grantUpsert: () => {},
    grantGet: () => null,
    grantList: () => [],
    grantDelete: () => false,
    close: () => {},
  } as unknown as Store;
}

function makeRuntime(): CodeRuntime {
  return {
    execute: async () => ({
      success: true,
      output: 'ok',
      error: null,
      duration_ms: 0,
    }),
  };
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    model: 'test-model',
    maxTokens: 1024,
    maxToolRounds: 2,
    contextBudget: 0.9,
    contextLimit: 100_000,
    modelTimeout: 30_000,
    temperature: 0,
    timezone: 'UTC',
    ...overrides,
  };
}

function makeDeps(model: ModelProvider, config: AgentConfig, personaPath: string): AgentDependencies {
  return {
    model,
    runtime: makeRuntime(),
    config,
    personaPath,
    store: makeStore(),
  };
}

let personaPath: string;
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'agent-test-'));
  personaPath = join(tempDir, 'persona.md');
  await Bun.write(personaPath, '# Test Persona\nYou are a test agent.');
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('graceful max-iteration exhaustion', () => {
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

    const config = makeConfig({ maxToolRounds: 2 });
    const agent = createAgent(makeDeps(model, config, personaPath));
    const result = await agent.chat('hello');

    const overrideHistory = (result as unknown as { history?: Message[] }).history;
    expect(overrideHistory).toBeUndefined();

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

    const config = makeConfig({ maxToolRounds: 2 });
    const agent = createAgent(makeDeps(model, config, personaPath));
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

    const config = makeConfig({ maxToolRounds: 2 });
    const agent = createAgent(makeDeps(model, config, personaPath));
    const result = await agent.chat('hello');

    // 2 loop rounds (13+17 each) + 1 forced (7+11)
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

    const config = makeConfig({ maxToolRounds: 3 });
    const agent = createAgent(makeDeps(model, config, personaPath));
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

    const config = makeConfig({ maxToolRounds: 5 });
    const agent = createAgent(makeDeps(model, config, personaPath));
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

    const config = makeConfig({ maxToolRounds: 3 });
    const agent = createAgent(makeDeps(model, config, personaPath));
    const result = await agent.chat('please do work');

    expect(result.text).toBe('Forced wrap-up response');
    expect(result.stats.rounds).toBe(4);
    expect(result.stats.inputTokens).toBe(10 * 3 + 9);
    expect(result.stats.outputTokens).toBe(5 * 3 + 6);

    // Verify calls 1..3 had tools, final had tools: []
    expect(calls.length).toBe(4);
    expect(calls[0]?.toolsCount).toBe(1);
    expect(calls[1]?.toolsCount).toBe(1);
    expect(calls[2]?.toolsCount).toBe(1);
    expect(calls[3]?.toolsCount).toBe(0);

    // Verify nudge user message exists in the request sent on the final call.
    const finalReq = calls[3]?.request;
    const nudgeMessage = finalReq?.messages.find(
      (m) => m.role === 'user' && m.content === '[System: Max tool calls reached. Provide final response now.]',
    );
    expect(nudgeMessage).toBeDefined();
  });
});
