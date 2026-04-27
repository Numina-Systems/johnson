// pattern: Imperative Shell (test) — sub-agent providers, fallback wrapper

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createSubAgent, wrapMainModel } from './sub-agent.ts';
import type { SubModelConfig } from '../config/types.ts';
import type { ModelProvider, ModelRequest, ModelResponse } from './types.ts';

type FetchCall = {
  url: string;
  init?: RequestInit;
};

let originalFetch: typeof globalThis.fetch;
let calls: FetchCall[];

function installFetchMock(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  calls = [];
  globalThis.fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    let url: string;
    if (typeof input === 'string') url = input;
    else if (input instanceof URL) url = input.toString();
    else url = (input as Request).url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof globalThis.fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function readBody(init: RequestInit | undefined): Record<string, unknown> {
  if (!init?.body) return {};
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('createSubAgent — anthropic', () => {
  test('returns text from messages API response', async () => {
    installFetchMock(() =>
      jsonResponse({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5-20251001',
        content: [{ type: 'text', text: 'summary text' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );

    const config: SubModelConfig = {
      provider: 'anthropic',
      name: 'claude-haiku-4-5-20251001',
      maxTokens: 8000,
      apiKey: 'test-key',
    };
    const subAgent = createSubAgent(config);
    const result = await subAgent.complete('test prompt', 'test system');

    expect(result).toBe('summary text');
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toContain('/v1/messages');
  });

  test('joins multiple text blocks', async () => {
    installFetchMock(() =>
      jsonResponse({
        id: 'msg_2',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5-20251001',
        content: [
          { type: 'text', text: 'hello ' },
          { type: 'text', text: 'world' },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    );

    const subAgent = createSubAgent({
      provider: 'anthropic',
      name: 'claude-haiku-4-5-20251001',
      maxTokens: 8000,
      apiKey: 'test-key',
    });

    const result = await subAgent.complete('hi');
    expect(result).toBe('hello world');
  });
});

describe('createSubAgent — openai-compat', () => {
  test('extracts choices[0].message.content from response', async () => {
    installFetchMock(() =>
      jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'compat response' } }],
      }),
    );

    const subAgent = createSubAgent({
      provider: 'openai-compat',
      name: 'gpt-4o-mini',
      maxTokens: 4000,
      baseUrl: 'http://localhost:8080/v1',
      apiKey: 'test-key',
    });

    const result = await subAgent.complete('hello');

    expect(result).toBe('compat response');
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe('http://localhost:8080/v1/chat/completions');
    expect((calls[0]!.init as RequestInit).method).toBe('POST');

    const body = readBody(calls[0]!.init);
    expect(body['model']).toBe('gpt-4o-mini');
    expect(body['max_tokens']).toBe(4000);
    expect(body['messages']).toEqual([{ role: 'user', content: 'hello' }]);

    const headers = (calls[0]!.init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key');
  });

  test('includes system message when system param is provided', async () => {
    installFetchMock(() =>
      jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
    );

    const subAgent = createSubAgent({
      provider: 'openai-compat',
      name: 'gpt-4o-mini',
      maxTokens: 4000,
      baseUrl: 'http://localhost:8080/v1',
      apiKey: 'k',
    });

    await subAgent.complete('user msg', 'system instruction');

    const body = readBody(calls[0]!.init);
    expect(body['messages']).toEqual([
      { role: 'system', content: 'system instruction' },
      { role: 'user', content: 'user msg' },
    ]);
  });

  test('omits system message when system param is undefined', async () => {
    installFetchMock(() =>
      jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
    );

    const subAgent = createSubAgent({
      provider: 'openai-compat',
      name: 'gpt-4o-mini',
      maxTokens: 4000,
      baseUrl: 'http://localhost:8080/v1',
      apiKey: 'k',
    });

    await subAgent.complete('only user');

    const body = readBody(calls[0]!.init);
    expect((body['messages'] as Array<unknown>).length).toBe(1);
    expect(body['messages']).toEqual([{ role: 'user', content: 'only user' }]);
  });

  test('throws descriptive error on non-2xx response', async () => {
    installFetchMock(() =>
      new Response('upstream error body', { status: 500 }),
    );

    const subAgent = createSubAgent({
      provider: 'openai-compat',
      name: 'gpt-4o-mini',
      maxTokens: 4000,
      baseUrl: 'http://localhost:8080/v1',
      apiKey: 'k',
    });

    await expect(subAgent.complete('hi')).rejects.toThrow(/openai-compat/);
  });
});

describe('createSubAgent — openrouter', () => {
  test('uses OpenRouter base URL and extracts response', async () => {
    installFetchMock(() =>
      jsonResponse({
        choices: [{ message: { content: 'router response' } }],
      }),
    );

    const subAgent = createSubAgent({
      provider: 'openrouter',
      name: 'meta-llama/llama-3-8b',
      maxTokens: 4000,
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'or-key',
    });

    const result = await subAgent.complete('hi');

    expect(result).toBe('router response');
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
});

describe('createSubAgent — ollama', () => {
  test('extracts message.content from /api/chat response', async () => {
    installFetchMock(() =>
      jsonResponse({
        message: { role: 'assistant', content: 'ollama response' },
        done: true,
      }),
    );

    const subAgent = createSubAgent({
      provider: 'ollama',
      name: 'llama3',
      maxTokens: 4000,
      baseUrl: 'http://localhost:11434',
    });

    const result = await subAgent.complete('test');

    expect(result).toBe('ollama response');
    expect(calls[0]!.url).toBe('http://localhost:11434/api/chat');

    const body = readBody(calls[0]!.init);
    expect(body['model']).toBe('llama3');
    expect(body['stream']).toBe(false);
    const opts = body['options'] as Record<string, unknown>;
    expect(opts['num_predict']).toBe(4000);
  });

  test('falls back to default localhost URL when baseUrl is not provided', async () => {
    installFetchMock(() =>
      jsonResponse({ message: { content: 'default url ok' } }),
    );

    const subAgent = createSubAgent({
      provider: 'ollama',
      name: 'llama3',
      maxTokens: 4000,
    });

    await subAgent.complete('hi');
    expect(calls[0]!.url).toBe('http://localhost:11434/api/chat');
  });
});

describe('createSubAgent — lemonade', () => {
  test('uses OpenAI-compat endpoint pattern', async () => {
    installFetchMock(() =>
      jsonResponse({ choices: [{ message: { content: 'lemonade' } }] }),
    );

    const subAgent = createSubAgent({
      provider: 'lemonade',
      name: 'local-model',
      maxTokens: 4000,
      baseUrl: 'http://localhost:13305/api/v1',
      apiKey: 'lemonade',
    });

    const result = await subAgent.complete('test');

    expect(result).toBe('lemonade');
    expect(calls[0]!.url).toBe('http://localhost:13305/api/v1/chat/completions');
  });
});

describe('wrapMainModel', () => {
  function makeMockModel(response: ModelResponse): { model: ModelProvider; received: ModelRequest[] } {
    const received: ModelRequest[] = [];
    const model: ModelProvider = {
      async complete(req: Readonly<ModelRequest>) {
        received.push(req as ModelRequest);
        return response;
      },
    };
    return { model, received };
  }

  test('extracts text from content blocks and joins them', async () => {
    const { model } = makeMockModel({
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: ' world' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const subAgent = wrapMainModel(model, 'test-model', 16000);
    const result = await subAgent.complete('prompt');

    expect(result).toBe('hello world');
  });

  test('passes tools: [] to the underlying model', async () => {
    const { model, received } = makeMockModel({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const subAgent = wrapMainModel(model, 'test-model', 16000);
    await subAgent.complete('prompt');

    expect(received[0]!.tools).toEqual([]);
  });

  test('caps max_tokens at 8000 even when called with a larger maxTokens', async () => {
    const { model, received } = makeMockModel({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const subAgent = wrapMainModel(model, 'test-model', 16384);
    await subAgent.complete('prompt');

    expect(received[0]!.max_tokens).toBe(8000);
  });

  test('respects smaller maxTokens caller value', async () => {
    const { model, received } = makeMockModel({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const subAgent = wrapMainModel(model, 'test-model', 4096);
    await subAgent.complete('prompt');

    expect(received[0]!.max_tokens).toBe(4096);
  });

  test('forwards the system prompt to the underlying model', async () => {
    const { model, received } = makeMockModel({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const subAgent = wrapMainModel(model, 'test-model', 4096);
    await subAgent.complete('prompt', 'be helpful');

    expect(received[0]!.system).toBe('be helpful');
  });
});
