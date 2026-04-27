// Unit tests for web tool handlers — mocks fetch and SecretManager.

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { registerWebTools } from './web.ts';
import { createToolRegistry, type ToolRegistry } from '../runtime/tool-registry.ts';
import type { AgentDependencies } from '../agent/types.ts';
import type { SecretManager } from '../secrets/manager.ts';

type SecretMap = Record<string, string | undefined>;

function makeSecrets(values: SecretMap = {}): SecretManager {
  return {
    listKeys: () => Object.keys(values).filter((k) => values[k] !== undefined).sort(),
    get: (key: string) => values[key],
    set: async () => {},
    remove: async () => {},
    resolve: (keys) => {
      const env: Record<string, string> = {};
      for (const k of keys) {
        const v = values[k];
        if (v !== undefined) env[k] = v;
      }
      return env;
    },
  };
}

function makeDeps(secrets?: SecretManager): AgentDependencies {
  return {
    model: { complete: async () => { throw new Error('model not used in web tests'); } },
    runtime: {
      execute: async () => { throw new Error('runtime not used'); },
    } as unknown as AgentDependencies['runtime'],
    config: {
      model: 'test',
      maxTokens: 4096,
      maxToolRounds: 5,
      contextBudget: 0.7,
      contextLimit: 100_000,
      modelTimeout: 30_000,
      timezone: 'UTC',
    },
    personaPath: '/tmp/persona.md',
    store: {} as unknown as AgentDependencies['store'],
    ...(secrets ? { secrets } : {}),
  };
}

function makeJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

type FetchImpl = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
type FetchCall = [string | URL | Request, RequestInit | undefined];
type FetchMock = FetchImpl & {
  mock: { calls: ReadonlyArray<FetchCall> };
};

function installFetchMock(impl: FetchImpl): FetchMock {
  const m = mock(impl) as unknown as FetchMock;
  globalThis.fetch = m as unknown as typeof fetch;
  return m;
}

const originalFetch = globalThis.fetch;
const originalEnvKey = process.env['EXA_API_KEY'];

let registry: ToolRegistry;

function freshRegistry(deps: AgentDependencies): ToolRegistry {
  const r = createToolRegistry();
  registerWebTools(r, deps);
  return r;
}

beforeEach(() => {
  delete process.env['EXA_API_KEY'];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalEnvKey === undefined) {
    delete process.env['EXA_API_KEY'];
  } else {
    process.env['EXA_API_KEY'] = originalEnvKey;
  }
});

describe('web_search', () => {
  test('GH07.AC1.1: returns structured results from Exa search', async () => {
    const fetchMock = installFetchMock(async () =>
      makeJsonResponse({
        results: [
          { title: 'A', url: 'https://a.example', text: 'snippet a', score: 0.9 },
          { title: 'B', url: 'https://b.example', summary: 'focused', score: 0.7 },
        ],
      }),
    );

    registry = freshRegistry(makeDeps(makeSecrets({ EXA_API_KEY: 'k' })));
    const result = (await registry.execute('web_search', { query: 'hello' })) as Array<
      { title: string; url: string; snippet: string; score?: number }
    >;

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      title: 'A',
      url: 'https://a.example',
      snippet: 'snippet a',
      score: 0.9,
    });
    expect(result[1]).toEqual({
      title: 'B',
      url: 'https://b.example',
      snippet: 'focused',
      score: 0.7,
    });

    const call = fetchMock.mock.calls[0]!;
    expect(String(call[0])).toBe('https://api.exa.ai/search');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('k');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.query).toBe('hello');
    expect(body.numResults).toBe(5);
    expect(body.type).toBe('auto');
    expect(body.contents).toEqual({ text: { maxCharacters: 1000 } });
  });

  test('GH07.AC1.1: clamps num_results into [1, 10] range', async () => {
    const fetchMock = installFetchMock(async () => makeJsonResponse({ results: [] }));

    registry = freshRegistry(makeDeps(makeSecrets({ EXA_API_KEY: 'k' })));
    await registry.execute('web_search', { query: 'q', num_results: 99 });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.numResults).toBe(10);

    await registry.execute('web_search', { query: 'q', num_results: 0 });
    const body2 = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    expect(body2.numResults).toBe(1);
  });

  test('GH07.AC1.1: summary_focus adds summary fields to request', async () => {
    const fetchMock = installFetchMock(async () => makeJsonResponse({ results: [] }));

    registry = freshRegistry(makeDeps(makeSecrets({ EXA_API_KEY: 'k' })));
    await registry.execute('web_search', { query: 'q', summary_focus: 'cats' });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.summary).toBe(true);
    expect(body.summaryQuery).toBe('cats');
  });

  test('GH07.AC4.1: returns clear error string when Exa key missing', async () => {
    const fetchMock = installFetchMock(async () => {
      throw new Error('fetch should not be called');
    });

    registry = freshRegistry(makeDeps(makeSecrets({})));
    const result = await registry.execute('web_search', { query: 'q' });
    expect(result).toBe(
      'Exa API key not configured. Set EXA_API_KEY as a secret or environment variable.',
    );
    expect(fetchMock.mock.calls).toHaveLength(0);
  });

  test('falls back to process.env.EXA_API_KEY when secrets unset', async () => {
    process.env['EXA_API_KEY'] = 'env-key';
    const fetchMock = installFetchMock(async () => makeJsonResponse({ results: [] }));

    registry = freshRegistry(makeDeps());
    await registry.execute('web_search', { query: 'q' });

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('env-key');
  });

  test('throws on non-ok HTTP response', async () => {
    installFetchMock(async () =>
      new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }),
    );

    registry = freshRegistry(makeDeps(makeSecrets({ EXA_API_KEY: 'k' })));
    await expect(registry.execute('web_search', { query: 'q' })).rejects.toThrow(
      /Exa search failed: 429/,
    );
  });
});

describe('fetch_page', () => {
  test('GH07.AC2.1: returns extracted content + metadata', async () => {
    const fetchMock = installFetchMock(async () =>
      makeJsonResponse({
        results: [
          {
            url: 'https://example.com/post',
            title: 'Hello',
            text: 'body text',
            author: 'Alice',
            publishedDate: '2025-01-01',
          },
        ],
      }),
    );

    registry = freshRegistry(makeDeps(makeSecrets({ EXA_API_KEY: 'k' })));
    const result = (await registry.execute('fetch_page', {
      url: 'https://example.com/post',
    })) as { title: string; url: string; text: string; author?: string; publishDate?: string };

    expect(result).toEqual({
      title: 'Hello',
      url: 'https://example.com/post',
      text: 'body text',
      author: 'Alice',
      publishDate: '2025-01-01',
    });

    const call = fetchMock.mock.calls[0]!;
    expect(String(call[0])).toBe('https://api.exa.ai/contents');
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.urls).toEqual(['https://example.com/post']);
    expect(body.text.maxCharacters).toBe(10_000);
  });

  test('omits author/publishDate when absent', async () => {
    installFetchMock(async () =>
      makeJsonResponse({
        results: [{ url: 'https://x', title: 'T', text: 'B' }],
      }),
    );

    registry = freshRegistry(makeDeps(makeSecrets({ EXA_API_KEY: 'k' })));
    const result = (await registry.execute('fetch_page', { url: 'https://x' })) as Record<
      string,
      unknown
    >;
    expect(result).toEqual({ title: 'T', url: 'https://x', text: 'B' });
    expect('author' in result).toBe(false);
    expect('publishDate' in result).toBe(false);
  });

  test('GH07.AC4.1: returns clear error string when Exa key missing', async () => {
    const fetchMock = installFetchMock(async () => {
      throw new Error('fetch should not be called');
    });

    registry = freshRegistry(makeDeps(makeSecrets({})));
    const result = await registry.execute('fetch_page', { url: 'https://x' });
    expect(result).toBe(
      'Exa API key not configured. Set EXA_API_KEY as a secret or environment variable.',
    );
    expect(fetchMock.mock.calls).toHaveLength(0);
  });

  test('throws when Exa returns no results', async () => {
    installFetchMock(async () => makeJsonResponse({ results: [] }));

    registry = freshRegistry(makeDeps(makeSecrets({ EXA_API_KEY: 'k' })));
    await expect(registry.execute('fetch_page', { url: 'https://x' })).rejects.toThrow(
      /no results/,
    );
  });

  test('clamps max_chars to 50000', async () => {
    const fetchMock = installFetchMock(async () =>
      makeJsonResponse({ results: [{ url: 'https://x', title: 'T', text: 'B' }] }),
    );

    registry = freshRegistry(makeDeps(makeSecrets({ EXA_API_KEY: 'k' })));
    await registry.execute('fetch_page', { url: 'https://x', max_chars: 999_999 });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.text.maxCharacters).toBe(50_000);
  });
});

describe('http_get', () => {
  test('GH07.AC3.1: returns status + body + content-type', async () => {
    installFetchMock(async () =>
      new Response('<html>hi</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    registry = freshRegistry(makeDeps(makeSecrets({})));
    const result = (await registry.execute('http_get', {
      url: 'https://example.com',
    })) as { status: number; contentType: string; body: string };

    expect(result.status).toBe(200);
    expect(result.contentType).toBe('text/html');
    expect(result.body).toBe('<html>hi</html>');
  });

  test('GH07.AC3.1: truncates body to max_chars', async () => {
    installFetchMock(async () =>
      new Response('abcdefghijklmnopqrstuvwxyz', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    registry = freshRegistry(makeDeps(makeSecrets({})));
    const result = (await registry.execute('http_get', {
      url: 'https://example.com',
      max_chars: 10,
    })) as { body: string };

    expect(result.body.length).toBeLessThanOrEqual(10);
    expect(result.body).toBe('abcdefghij');
  });

  test('GH07.AC4.2: works without Exa key', async () => {
    installFetchMock(async () =>
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    registry = freshRegistry(makeDeps(makeSecrets({})));
    const result = (await registry.execute('http_get', {
      url: 'https://api.example.com',
    })) as { status: number; body: string };

    expect(result.status).toBe(200);
    expect(result.body).toBe('{"ok":true}');
  });

  test('falls back to "unknown" content type when header absent', async () => {
    installFetchMock(async () => {
      const r = new Response('payload', { status: 200 });
      r.headers.delete('content-type');
      return r;
    });

    registry = freshRegistry(makeDeps(makeSecrets({})));
    const result = (await registry.execute('http_get', {
      url: 'https://example.com',
    })) as { contentType: string };
    expect(result.contentType).toBe('unknown');
  });
});
