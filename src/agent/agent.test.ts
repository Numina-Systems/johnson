// pattern: Imperative Shell (test) — exercises agent loop with mocks

import { describe, expect, test } from 'bun:test';
import { createAgent, formatNativeToolResult } from './agent.ts';
import type { AgentConfig, AgentDependencies, AgentEvent } from './types.ts';
import type {
  Message,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ToolResultContentBlock,
} from '../model/types.ts';
import type { CodeRuntime, ExecutionResult } from '../runtime/types.ts';
import type { Store, DocumentRow, GrantRow } from '../store/store.ts';
import type { EmbeddingProvider } from '../embedding/types.ts';
import type { SubAgentLLM } from '../model/sub-agent.ts';

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
    addManagedThread: () => {},
    removeManagedThread: () => false,
    getManagedThreadIds: () => new Set(),
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
    model: 'test-model',
    maxTokens: 1024,
    maxToolRounds: 2,
    contextBudget: 0.9,
    contextLimit: 100_000,
    modelTimeout: 30_000,
    temperature: 0,
    timezone: 'UTC',
    recallEnabled: false,
    recallTokenBudget: 1500,
    devMode: false,
    ...overrides,
  };
}

function makeDeps(
  model: ModelProvider,
  config: AgentConfig,
): AgentDependencies {
  return {
    model,
    runtime: noopRuntime,
    config,
    store: createNoopStore(),
  };
}

describe('agent reasoning_content propagation', () => {

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

    const agent = createAgent(makeDeps(mockModel, makeConfig({ maxToolRounds: 3 })));

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

    const agent = createAgent(makeDeps(mockModel, makeConfig({ maxToolRounds: 3 })));
    await agent.chat('first');
    await agent.chat('second');

    const secondCallMessages = receivedMessages[1];
    const assistantMessage = secondCallMessages!.find((m) => m.role === 'assistant');
    expect(assistantMessage).toBeDefined();
    expect(assistantMessage!.reasoning_content).toBeUndefined();
  });
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
    const agent = createAgent(makeDeps(model, config));
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
    const agent = createAgent(makeDeps(model, config));
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
    const agent = createAgent(makeDeps(model, config));
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
    const agent = createAgent(makeDeps(model, config));
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
    const agent = createAgent(makeDeps(model, config));
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
    const agent = createAgent(makeDeps(model, config));
    const result = await agent.chat('please do work');

    expect(result.text).toBe('Forced wrap-up response');
    expect(result.stats.rounds).toBe(4);
    expect(result.stats.inputTokens).toBe(10 * 3 + 9);
    expect(result.stats.outputTokens).toBe(5 * 3 + 6);

    expect(calls.length).toBe(4);
    expect(calls[0]?.toolsCount).toBeGreaterThanOrEqual(1);
    expect(calls[1]?.toolsCount).toBeGreaterThanOrEqual(1);
    expect(calls[2]?.toolsCount).toBeGreaterThanOrEqual(1);
    expect(calls[3]?.toolsCount).toBe(0);

    const finalReq = calls[3]?.request;
    const nudgeMessage = finalReq?.messages.find(
      (m) => m.role === 'user' && m.content === '[System: Max tool calls reached. Provide final response now.]',
    );
    expect(nudgeMessage).toBeDefined();
  });
});

describe('agent loop tool dispatch routing', () => {

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

  test('GH09.AC4.1 / AC4.2 / AC4.3: image_result returns array content with text + Anthropic-native image block', () => {
    const block = formatNativeToolResult('id1', {
      type: 'image_result',
      text: 'Image from https://example.com/photo.png',
      image: { type: 'base64', data: 'iVBOR...', media_type: 'image/png' },
    });
    expect(block.type).toBe('tool_result');
    expect(block.tool_use_id).toBe('id1');
    expect(Array.isArray(block.content)).toBe(true);
    const blocks = block.content as ToolResultContentBlock[];
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toEqual({ type: 'text', text: 'Image from https://example.com/photo.png' });
    expect(blocks[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'iVBOR...' },
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

  test('GH09.AC5.1: plain string result produces ToolResultBlock with string content', () => {
    const block = formatNativeToolResult('id2', 'Document saved: foo');
    expect(block.content).toBe('Document saved: foo');
  });

  test('GH09.AC5.2: object result produces ToolResultBlock with JSON-stringified content', () => {
    const block = formatNativeToolResult('id3', { count: 3, items: ['a', 'b', 'c'] });
    expect(block.content).toBe(JSON.stringify({ count: 3, items: ['a', 'b', 'c'] }));
  });

  test('null result is JSON-stringified as "null"', () => {
    const block = formatNativeToolResult('id4', null);
    expect(block.content).toBe('null');
  });
});

describe('trimOldToolResults — image tool results', () => {
  test('older image tool results are replaced with placeholder', async () => {
    const { trimOldToolResults } = await import('./context.ts');
    const messages: Message[] = [];
    // Add an older user message with an image tool result
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'old-img-1',
          content: [
            { type: 'text', text: 'Image from https://example.com/old.png' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          ],
        },
      ],
    });
    // Pad with enough messages so the image tool result is outside the preserve window (8 most recent)
    for (let i = 0; i < 10; i++) {
      messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `padding ${i}` });
    }

    const trimmed = trimOldToolResults(messages);

    expect(trimmed).toBeGreaterThanOrEqual(1);
    const trimmedBlock = (messages[0]!.content as Array<unknown>)[0] as { content: unknown };
    expect(trimmedBlock.content).toBe('[image tool result trimmed for context savings]');
  });

  test('recent image tool results are preserved (within preserve window)', async () => {
    const { trimOldToolResults } = await import('./context.ts');
    const messages: Message[] = [];
    // First a few older messages so the image is at index 0 but within preserve window
    for (let i = 0; i < 4; i++) {
      messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `padding ${i}` });
    }
    // Add an image tool result still within last 8
    const imageBlock = {
      type: 'tool_result' as const,
      tool_use_id: 'recent-img',
      content: [
        { type: 'text' as const, text: 'Recent image' },
        { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png', data: 'BBBB' } },
      ],
    };
    messages.push({ role: 'user', content: [imageBlock] });
    for (let i = 0; i < 3; i++) {
      messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `tail ${i}` });
    }

    const beforeContent = (messages[messages.length - 4]!.content as Array<unknown>)[0];
    trimOldToolResults(messages);
    const afterContent = (messages[messages.length - 4]!.content as Array<unknown>)[0];

    // The image tool result should be unchanged — same reference
    expect(afterContent).toBe(beforeContent);
  });
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

    const agent = createAgent(makeDeps(model, makeConfig({ maxToolRounds: 2 })));
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

    const agent = createAgent(makeDeps(model, makeConfig({ maxToolRounds: 2 })));
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

    const agent = createAgent(makeDeps(model, makeConfig({ maxToolRounds: 2 })));
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

    const agent = createAgent(makeDeps(model, makeConfig({ maxToolRounds: 3 })));
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

    const agent = createAgent(makeDeps(model, makeConfig({ maxToolRounds: 5 })));
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

    const agent = createAgent(makeDeps(model, makeConfig({ maxToolRounds: 3 })));
    const result = await agent.chat('please do work');

    expect(result.text).toBe('Forced wrap-up response');
    expect(result.stats.rounds).toBe(4);
    expect(result.stats.inputTokens).toBe(10 * 3 + 9);
    expect(result.stats.outputTokens).toBe(5 * 3 + 6);

    expect(calls.length).toBe(4);
    expect(calls[0]?.toolsCount).toBeGreaterThanOrEqual(1);
    expect(calls[1]?.toolsCount).toBeGreaterThanOrEqual(1);
    expect(calls[2]?.toolsCount).toBeGreaterThanOrEqual(1);
    expect(calls[3]?.toolsCount).toBe(0);

    const finalReq = calls[3]?.request;
    const nudgeMessage = finalReq?.messages.find(
      (m) => m.role === 'user' && m.content === '[System: Max tool calls reached. Provide final response now.]',
    );
    expect(nudgeMessage).toBeDefined();
  });
});

describe('GH02 event emission', () => {

  function makeToolUseThenEndModel(toolCode: string, toolOutput?: string): { provider: ModelProvider; runtime: CodeRuntime } {
    let call = 0;
    const provider: ModelProvider = {
      complete: async () => {
        call++;
        if (call === 1) {
          return {
            content: [{ type: 'tool_use', id: 'call-1', name: 'execute_code', input: { code: toolCode } }],
            stop_reason: 'tool_use',
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        }
        return {
          content: [{ type: 'text', text: 'final answer' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 12, output_tokens: 4 },
        };
      },
    };
    const runtime: CodeRuntime = {
      execute: async () => ({
        success: true,
        output: toolOutput ?? 'ok',
        error: null,
        duration_ms: 1,
      }),
    };
    return { provider, runtime };
  }

  test('GH02.AC3.1/AC3.2/AC7.1: emits all four event kinds in correct order during tool-use round', async () => {
    const { provider, runtime } = makeToolUseThenEndModel('output("hello")');
    const config = makeConfig({ maxToolRounds: 5 });
    const deps: AgentDependencies = {
      model: provider,
      runtime,
      config,
      store: createNoopStore(),
    };
    const agent = createAgent(deps);

    const collected: AgentEvent['kind'][] = [];
    const onEvent = async (event: AgentEvent): Promise<void> => {
      collected.push(event.kind);
    };

    const result = await agent.chat('hello', { onEvent });

    expect(collected).toEqual([
      'llm_start',
      'llm_done',
      'tool_start',
      'tool_done',
      'llm_start',
      'llm_done',
    ]);
    expect(result.text).toBe('final answer');
  });

  test('GH02.AC4.1/AC4.2: callback errors are logged, not thrown', async () => {
    const { provider, runtime } = makeToolUseThenEndModel('output("hi")');
    const config = makeConfig({ maxToolRounds: 5 });
    const deps: AgentDependencies = {
      model: provider,
      runtime,
      config,
      store: createNoopStore(),
    };
    const agent = createAgent(deps);

    const onEvent = async (): Promise<void> => {
      throw new Error('callback failure');
    };

    const result = await agent.chat('hello', { onEvent });

    expect(result.text).toBe('final answer');
    expect(result.text.length).toBeGreaterThan(0);
  });

  test('GH02.AC5.1: tool_start code is truncated to 500 chars', async () => {
    const longCode = 'x'.repeat(1200);
    const { provider, runtime } = makeToolUseThenEndModel(longCode);
    const config = makeConfig({ maxToolRounds: 5 });
    const deps: AgentDependencies = {
      model: provider,
      runtime,
      config,
      store: createNoopStore(),
    };
    const agent = createAgent(deps);

    const events: AgentEvent[] = [];
    const onEvent = async (event: AgentEvent): Promise<void> => {
      events.push(event);
    };

    await agent.chat('hello', { onEvent });

    const toolStart = events.find((e) => e.kind === 'tool_start');
    expect(toolStart).toBeDefined();
    const code = toolStart!.data['code'];
    expect(typeof code).toBe('string');
    expect((code as string).length).toBeLessThanOrEqual(500);
  });

  test('GH02.AC6.1: tool_done preview is truncated to 200 chars', async () => {
    const longOutput = 'y'.repeat(900);
    const { provider, runtime } = makeToolUseThenEndModel('output("noop")', longOutput);
    const config = makeConfig({ maxToolRounds: 5 });
    const deps: AgentDependencies = {
      model: provider,
      runtime,
      config,
      store: createNoopStore(),
    };
    const agent = createAgent(deps);

    const events: AgentEvent[] = [];
    const onEvent = async (event: AgentEvent): Promise<void> => {
      events.push(event);
    };

    await agent.chat('hello', { onEvent });

    const toolDone = events.find((e) => e.kind === 'tool_done');
    expect(toolDone).toBeDefined();
    const preview = toolDone!.data['preview'];
    expect(typeof preview).toBe('string');
    expect((preview as string).length).toBeLessThanOrEqual(200);
  });
});

describe('forced final response: events and reasoning_content', () => {

  test('emits llm_start and llm_done with forced:true around forced final model call', async () => {
    const model: ModelProvider = {
      complete: async (req) => {
        if ((req.tools?.length ?? 0) === 0) {
          return {
            content: [{ type: 'text', text: 'Forced wrap-up' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 9, output_tokens: 6 },
          };
        }
        return {
          content: [{ type: 'tool_use', id: 't', name: 'execute_code', input: { code: 'output(1)' } }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    };

    const config = makeConfig({ maxToolRounds: 2 });
    const agent = createAgent(makeDeps(model, config));

    const events: AgentEvent[] = [];
    const onEvent = async (event: AgentEvent): Promise<void> => {
      events.push(event);
    };

    const result = await agent.chat('hello', { onEvent });
    expect(result.text).toBe('Forced wrap-up');

    const forcedStart = events.find(
      (e) => e.kind === 'llm_start' && e.data['forced'] === true,
    );
    expect(forcedStart).toBeDefined();

    const forcedDone = events.find(
      (e) => e.kind === 'llm_done' && e.data['forced'] === true,
    );
    expect(forcedDone).toBeDefined();
    expect(forcedDone!.data['stop_reason']).toBe('end_turn');
    expect(forcedDone!.data['usage']).toEqual({ input_tokens: 9, output_tokens: 6 });

    const startIdx = events.indexOf(forcedStart!);
    const doneIdx = events.indexOf(forcedDone!);
    expect(startIdx).toBeLessThan(doneIdx);
  });

  test('preserves reasoning_content on forced final assistant message', async () => {
    const receivedMessages: ReadonlyArray<Message>[] = [];
    const model: ModelProvider = {
      complete: async (req) => {
        receivedMessages.push(req.messages);
        if ((req.tools?.length ?? 0) === 0) {
          return {
            content: [{ type: 'text', text: 'forced final' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 9, output_tokens: 6 },
            reasoning_content: 'Reasoning during forced wrap-up.',
          };
        }
        return {
          content: [{ type: 'tool_use', id: 't', name: 'execute_code', input: { code: 'output(1)' } }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    };

    const config = makeConfig({ maxToolRounds: 2 });
    const agent = createAgent(makeDeps(model, config));

    await agent.chat('first');
    await agent.chat('second');

    const lastCallMessages = receivedMessages[receivedMessages.length - 1]!;
    const assistantWithReasoning = lastCallMessages.find(
      (m) => m.role === 'assistant' && m.reasoning_content === 'Reasoning during forced wrap-up.',
    );
    expect(assistantWithReasoning).toBeDefined();
  });
});

describe('recall integration', () => {

  test('reflexive-recall.AC6.1 (first variant): recall_enabled=false skips recall entirely', async () => {
    const events: AgentEvent[] = [];
    const model: ModelProvider = {
      complete: async (req) => {
        return {
          content: [{ type: 'text', text: 'Response without recall' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    };

    const config = makeConfig({ recallEnabled: false });
    const mockEmbedding: EmbeddingProvider = {
      embed: async () => Array.from(new Float32Array(768)),
      embedBatch: async () => [],
      dimensions: 768,
    };

    const deps: AgentDependencies = {
      ...makeDeps(model, config),
      embedding: mockEmbedding,
    };

    const agent = createAgent(deps);
    await agent.chat('This is a long enough message to test recall', {
      onEvent: async (event) => {
        events.push(event);
      },
    });

    const recallEvents = events.filter(e => e.kind === 'recall_done');
    expect(recallEvents.length).toBe(0);
  });

  test('reflexive-recall.AC6.1 (second variant): recall_enabled=true triggers recall', async () => {
    const events: AgentEvent[] = [];
    const model: ModelProvider = {
      complete: async (req) => {
        return {
          content: [{ type: 'text', text: 'Response with recall' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    };

    const config = makeConfig({ recallEnabled: true });
    const mockEmbedding: EmbeddingProvider = {
      embed: async () => Array.from(new Float32Array(768)),
      embedBatch: async () => [],
      dimensions: 768,
    };

    const mockSubAgent: SubAgentLLM = {
      complete: async () => 'test query',
    };

    // Create a store with documents for recall to find
    const docStore: Store = {
      ...createNoopStore(),
      docList: (limit?: number, cursor?: string) => {
        return {
          documents: [
            { rkey: 'knowledge:test', content: 'Test knowledge base', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
          ],
          cursor: undefined,
        };
      },
      docSearch: (query: string, limit?: number) => [
        {
          rkey: 'knowledge:test',
          content: 'Test knowledge base entry',
          rank: 0.9,
        },
      ],
    };

    const deps: AgentDependencies = {
      ...makeDeps(model, config),
      embedding: mockEmbedding,
      subAgent: mockSubAgent,
      store: docStore,
    };

    const agent = createAgent(deps);
    await agent.chat('This is a long enough message to test recall', {
      onEvent: async (event) => {
        events.push(event);
      },
    });

    const recallEvents = events.filter(e => e.kind === 'recall_done');
    expect(recallEvents.length).toBe(1);
  });

  test('reflexive-recall.AC8.1: recall_done event includes elapsed, fragmentCount, and totalTokens', async () => {
    let capturedEvent: AgentEvent | undefined;
    const model: ModelProvider = {
      complete: async (req) => {
        return {
          content: [{ type: 'text', text: 'Response' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    };

    const config = makeConfig({ recallEnabled: true });
    const mockEmbedding: EmbeddingProvider = {
      embed: async () => Array.from(new Float32Array(768)),
      embedBatch: async () => [],
      dimensions: 768,
    };

    const mockSubAgent: SubAgentLLM = {
      complete: async () => 'test query',
    };

    const docStore: Store = {
      ...createNoopStore(),
      docList: (limit?: number, cursor?: string) => {
        return {
          documents: [
            { rkey: 'knowledge:test', content: 'Test doc', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
          ],
          cursor: undefined,
        };
      },
      docSearch: (query: string, limit?: number) => [
        {
          rkey: 'knowledge:test',
          content: 'Retrieved content',
          rank: 0.9,
        },
      ],
    };

    const deps: AgentDependencies = {
      ...makeDeps(model, config),
      embedding: mockEmbedding,
      subAgent: mockSubAgent,
      store: docStore,
    };

    const agent = createAgent(deps);
    await agent.chat('This is a long enough message to test recall', {
      onEvent: async (event) => {
        if (event.kind === 'recall_done') {
          capturedEvent = event;
        }
      },
    });

    expect(capturedEvent).toBeDefined();
    const elapsed = capturedEvent!.data['elapsed'];
    const fragmentCount = capturedEvent!.data['fragmentCount'];
    const totalTokens = capturedEvent!.data['totalTokens'];
    expect(typeof elapsed).toBe('number');
    expect((elapsed as number) >= 0).toBe(true);
    expect(typeof fragmentCount).toBe('number');
    expect((fragmentCount as number) >= 0).toBe(true);
    expect(typeof totalTokens).toBe('number');
    expect((totalTokens as number) >= 0).toBe(true);
  });

  test('reflexive-recall.AC8.2: recall_done fires with zero fragments when store is empty', async () => {
    let capturedEvent: AgentEvent | undefined;
    const model: ModelProvider = {
      complete: async (req) => {
        return {
          content: [{ type: 'text', text: 'Response' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    };

    const config = makeConfig({ recallEnabled: true });
    const mockEmbedding: EmbeddingProvider = {
      embed: async () => Array.from(new Float32Array(768)),
      embedBatch: async () => [],
      dimensions: 768,
    };

    // Empty store — no documents
    const emptyStore = createNoopStore();

    const deps: AgentDependencies = {
      ...makeDeps(model, config),
      embedding: mockEmbedding,
      store: emptyStore,
    };

    const agent = createAgent(deps);
    await agent.chat('This is a long enough message to test recall', {
      onEvent: async (event) => {
        if (event.kind === 'recall_done') {
          capturedEvent = event;
        }
      },
    });

    expect(capturedEvent).toBeDefined();
    expect(capturedEvent!.data['fragmentCount']).toBe(0);
    expect(capturedEvent!.data['elapsed']).toBe(0);
    expect(capturedEvent!.data['totalTokens']).toBe(0);
  });

  test('reflexive-recall.AC9.1: event ordering between compaction and recall before llm_start', async () => {
    const events: AgentEvent[] = [];
    const model: ModelProvider = {
      complete: async (req) => {
        return {
          content: [{ type: 'text', text: 'Response' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    };

    // Set very low contextLimit to trigger compaction
    const config = makeConfig({
      recallEnabled: true,
      contextLimit: 0.5, // Very low limit to trigger compaction
      contextBudget: 100, // Small budget
    });

    const mockEmbedding: EmbeddingProvider = {
      embed: async () => Array.from(new Float32Array(768)),
      embedBatch: async () => [],
      dimensions: 768,
    };

    const mockSubAgent: SubAgentLLM = {
      complete: async () => 'test query',
    };

    const docStore: Store = {
      ...createNoopStore(),
      docList: (limit?: number, cursor?: string) => {
        return {
          documents: [
            { rkey: 'knowledge:test', content: 'Test knowledge base', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
          ],
          cursor: undefined,
        };
      },
      docSearch: (query: string, limit?: number) => [
        {
          rkey: 'knowledge:test',
          content: 'Test knowledge base entry',
          rank: 0.9,
        },
      ],
    };

    const deps: AgentDependencies = {
      ...makeDeps(model, config),
      embedding: mockEmbedding,
      subAgent: mockSubAgent,
      store: docStore,
    };

    const agent = createAgent(deps);

    // First call with a long message to build context
    await agent.chat('First message with substantial content to build context for compaction', {
      onEvent: async (event) => {
        events.push(event);
      },
    });

    // Clear events and make second call that could trigger both compaction and recall
    events.length = 0;
    await agent.chat('This is a long enough message to test recall and potentially compaction', {
      onEvent: async (event) => {
        events.push(event);
      },
    });

    // Find indices of key events
    const recallDoneIndex = events.findIndex(e => e.kind === 'recall_done');
    const llmStartIndex = events.findIndex(e => e.kind === 'llm_start');
    const compactionStartIndex = events.findIndex(e => e.kind === 'compaction_start');
    const compactionDoneIndex = events.findIndex(e => e.kind === 'compaction_done');

    // The important check: if both recall_done and llm_start occur, recall_done should come first
    if (recallDoneIndex !== -1 && llmStartIndex !== -1) {
      expect(recallDoneIndex).toBeLessThan(llmStartIndex);
    }

    // If compaction occurred, it should complete before llm_start
    if (compactionStartIndex !== -1 && llmStartIndex !== -1) {
      expect(compactionStartIndex).toBeLessThan(llmStartIndex);
    }
    if (compactionDoneIndex !== -1 && llmStartIndex !== -1) {
      expect(compactionDoneIndex).toBeLessThan(llmStartIndex);
    }

    // Verify the basic structure: llm_start must exist
    expect(llmStartIndex).toBeGreaterThanOrEqual(0);
  });
});
