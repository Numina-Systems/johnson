// Integration tests for createAgentTools — verifies web tools are registered, stubbed, documented, and dispatchable.

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createAgentTools } from './tools.ts';
import type { AgentDependencies, ChatContext } from './types.ts';
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
    model: { complete: async () => { throw new Error('model not used'); } },
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

const ctx: ChatContext = {};
const originalFetch = globalThis.fetch;
const originalEnvKey = process.env['EXA_API_KEY'];

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

describe('createAgentTools — web tool integration', () => {
  test('GH07.AC5.1: registers web_search, fetch_page, and http_get', () => {
    const registry = createAgentTools(makeDeps(makeSecrets()), ctx);
    const names = registry.list().map((t) => t.name);
    expect(names).toContain('web_search');
    expect(names).toContain('fetch_page');
    expect(names).toContain('http_get');
  });

  test('GH07.AC5.1: total tool count is 11 (8 existing + 3 web)', () => {
    const registry = createAgentTools(makeDeps(makeSecrets()), ctx);
    const names = registry.list().map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'cancel_task',
        'doc_get',
        'doc_list',
        'doc_search',
        'doc_upsert',
        'fetch_page',
        'http_get',
        'list_tasks',
        'run_skill',
        'schedule_task',
        'web_search',
      ],
    );
  });

  test('GH07.AC6.1: TypeScript stubs include web tool exports', () => {
    const registry = createAgentTools(makeDeps(makeSecrets()), ctx);
    const stubs = registry.generateTypeScriptStubs();
    expect(stubs).toContain('export async function web_search(');
    expect(stubs).toContain('export async function fetch_page(');
    expect(stubs).toContain('export async function http_get(');
  });

  test('GH07.AC7.1: tool documentation includes web tool sections', () => {
    const registry = createAgentTools(makeDeps(makeSecrets()), ctx);
    const docs = registry.generateToolDocumentation();
    expect(docs).toContain('### `tools.web_search`');
    expect(docs).toContain('### `tools.fetch_page`');
    expect(docs).toContain('### `tools.http_get`');
  });

  test('GH07.AC9.1: missing Exa key produces error for web_search but http_get still works', async () => {
    const fetchMock = mock(async () =>
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const registry = createAgentTools(makeDeps(makeSecrets()), ctx);

    const searchResult = await registry.execute('web_search', { query: 'test' });
    expect(searchResult).toBe(
      'Exa API key not configured. Set EXA_API_KEY as a secret or environment variable.',
    );

    const fetchPageResult = await registry.execute('fetch_page', { url: 'https://x' });
    expect(fetchPageResult).toBe(
      'Exa API key not configured. Set EXA_API_KEY as a secret or environment variable.',
    );

    const httpResult = (await registry.execute('http_get', {
      url: 'https://api.example.com',
    })) as { status: number; body: string };
    expect(httpResult.status).toBe(200);
    expect(httpResult.body).toBe('{"ok":true}');
  });
});
