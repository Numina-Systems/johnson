// pattern: Imperative Shell (test) — exercises agent loop with mocks

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent, formatNativeToolResult } from './agent.ts';
import type { AgentConfig, AgentDependencies } from './types.ts';
import type {
  Message,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ToolResultContentBlock,
} from '../model/types.ts';
import type { CodeRuntime, ExecutionResult } from '../runtime/types.ts';
import type { Store, DocumentRow, GrantRow } from '../store/store.ts';

type ModelCall = {
  request: ModelRequest;
  toolsCount: number;
};

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
    maxTokens: 100,
    maxToolRounds: 3,
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
  let tmpDir2: string;
  let personaPath: string;

  beforeAll(() => {
    tmpDir2 = mkdtempSync(join(tmpdir(), 'gh01-agent-test-'));
    personaPath = join(tmpDir2, 'persona.md');
    writeFileSync(personaPath, '# Test Persona\nYou are a test agent.');
  });

  afterAll(() => {
    rmSync(tmpDir2, { recursive: true, force: true });
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

    expect(calls.length).toBe(4);
    const initialToolsCount = calls[0]?.toolsCount ?? 0;
    expect(initialToolsCount).toBeGreaterThan(0);
    expect(calls[1]?.toolsCount).toBe(initialToolsCount);
    expect(calls[2]?.toolsCount).toBe(initialToolsCount);
    expect(calls[3]?.toolsCount).toBe(0);

    const finalReq = calls[3]?.request;
    const nudgeMessage = finalReq?.messages.find(
      (m) => m.role === 'user' && m.content === '[System: Max tool calls reached. Provide final response now.]',
    );
    expect(nudgeMessage).toBeDefined();
  });
});

describe('agent loop tool dispatch routing', () => {
  let tmpDir3: string;
  let personaPath: string;

  beforeAll(() => {
    tmpDir3 = mkdtempSync(join(tmpdir(), 'gh03-agent-test-'));
    personaPath = join(tmpDir3, 'persona.md');
    writeFileSync(personaPath, '# Test Persona\nYou are a test agent.');
  });

  afterAll(() => {
    rmSync(tmpDir3, { recursive: true, force: true });
  });

  test('GH03.AC6.1 / GH03.AC11.1: execute_code tool_use dispatches through Deno sandbox runtime', async () => {
    const runtimeCalls: Array<{ code: string }> = [];
    const recordingRuntime: CodeRuntime = {
      async execute(code: string): Promise<ExecutionResult> {
        runtimeCalls.push({ code });
        return { success: true, output: 'hello', error: null, duration_ms: 1 };
      },
    };

    let callIndex = 0;
    const responses: ModelResponse[] = [
      {
        content: [{ type: 'tool_use', id: 'tu1', name: 'execute_code', input: { code: 'output("hello")' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        content: [{ type: 'text', text: 'Done — got hello.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 12, output_tokens: 4 },
      },
    ];

    const mockModel: ModelProvider = {
      async complete(_req: Readonly<ModelRequest>): Promise<ModelResponse> {
        const r = responses[callIndex++];
        if (!r) throw new Error('Unexpected extra model call');
        return r;
      },
    };

    const deps: AgentDependencies = {
      model: mockModel,
      runtime: recordingRuntime,
      config: makeConfig({ maxToolRounds: 5 }),
      personaPath,
      store: createNoopStore(),
    };

    const agent = createAgent(deps);
    const result = await agent.chat('please run hello');

    expect(runtimeCalls.length).toBe(1);
    expect(runtimeCalls[0]?.code).toBe('output("hello")');
    expect(result.text).toBe('Done — got hello.');
  });

  test('GH03.AC5.1 / GH03.AC10.1: non-execute_code tool_use bypasses sandbox and goes through registry', async () => {
    const runtimeCalls: Array<{ code: string }> = [];
    const recordingRuntime: CodeRuntime = {
      async execute(code: string): Promise<ExecutionResult> {
        runtimeCalls.push({ code });
        return { success: true, output: 'should not happen', error: null, duration_ms: 1 };
      },
    };

    const modelCalls: ReadonlyArray<Message>[] = [];
    let callIndex = 0;
    const responses: ModelResponse[] = [
      {
        content: [{ type: 'tool_use', id: 'tu1', name: 'some_native_tool', input: { x: 1 } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        content: [{ type: 'text', text: 'Acknowledged the error.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 12, output_tokens: 4 },
      },
    ];

    const mockModel: ModelProvider = {
      async complete(req: Readonly<ModelRequest>): Promise<ModelResponse> {
        modelCalls.push(req.messages);
        const r = responses[callIndex++];
        if (!r) throw new Error('Unexpected extra model call');
        return r;
      },
    };

    const deps: AgentDependencies = {
      model: mockModel,
      runtime: recordingRuntime,
      config: makeConfig({ maxToolRounds: 5 }),
      personaPath,
      store: createNoopStore(),
    };

    const agent = createAgent(deps);
    const result = await agent.chat('call the native tool');

    expect(runtimeCalls.length).toBe(0);

    const secondCallMessages = modelCalls[1];
    expect(secondCallMessages).toBeDefined();

    const toolResultMsg = secondCallMessages!.find(
      (m) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === 'tool_result' && b.tool_use_id === 'tu1'),
    );
    expect(toolResultMsg).toBeDefined();

    const blocks = toolResultMsg!.content as ReadonlyArray<{
      type: string;
      tool_use_id: string;
      content: unknown;
      is_error?: boolean;
    }>;
    const resultBlock = blocks.find((b) => b.type === 'tool_result' && b.tool_use_id === 'tu1');
    expect(resultBlock).toBeDefined();
    expect(resultBlock!.is_error).toBe(true);
    expect(resultBlock!.content).toContain('Tool error');
    expect(resultBlock!.content).toContain('Unknown tool: some_native_tool');

    expect(result.text).toBe('Acknowledged the error.');
  });
});

describe('formatNativeToolResult', () => {
  test('string result is used directly as content', () => {
    const block = formatNativeToolResult('id1', 'hello');
    expect(block.type).toBe('tool_result');
    expect(block.tool_use_id).toBe('id1');
    expect(block.content).toBe('hello');
    expect(block.is_error).toBeUndefined();
  });

  test('object result is JSON.stringified', () => {
    const block = formatNativeToolResult('id1', { key: 'value', n: 7 });
    expect(block.content).toBe(JSON.stringify({ key: 'value', n: 7 }));
  });

  test('undefined result is rendered as (no output)', () => {
    const block = formatNativeToolResult('id1', undefined);
    expect(block.content).toBe('(no output)');
  });

  test('image_result with text and image returns array content with text + data URI image block', () => {
    const block = formatNativeToolResult('id1', {
      type: 'image_result',
      text: 'An image',
      image: { data: 'base64data', media_type: 'image/png' },
    });
    expect(Array.isArray(block.content)).toBe(true);
    const blocks = block.content as ToolResultContentBlock[];
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toEqual({ type: 'text', text: 'An image' });
    expect(blocks[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,base64data' },
    });
  });

  test('image_result with missing image returns array content with just the text block', () => {
    const block = formatNativeToolResult('id1', {
      type: 'image_result',
      text: 'An image',
    });
    expect(Array.isArray(block.content)).toBe(true);
    const blocks = block.content as ToolResultContentBlock[];
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toEqual({ type: 'text', text: 'An image' });
  });
});
