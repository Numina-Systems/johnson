import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createToolRegistry } from '../runtime/tool-registry.ts';
import { registerNotifyTools } from './notify.ts';
import type { AgentDependencies } from '../agent/types.ts';
import type { SecretManager } from '../secrets/manager.ts';

function makeSecretManager(secrets: Record<string, string> = {}): SecretManager {
  const store = { ...secrets };
  return {
    listKeys: () => Object.keys(store).sort(),
    get: (key: string) => store[key],
    async set(key: string, value: string) {
      store[key] = value;
    },
    async remove(key: string) {
      delete store[key];
    },
    resolve: (keys: ReadonlyArray<string>) => {
      const env: Record<string, string> = {};
      for (const key of keys) {
        const val = store[key];
        if (val !== undefined) env[key] = val;
      }
      return env;
    },
  };
}

function makeDeps(overrides: { secrets?: SecretManager } = {}): Readonly<AgentDependencies> {
  return {
    secrets: overrides.secrets,
    model: undefined as any,
    runtime: undefined as any,
    config: undefined as any,
    personaPath: '',
    store: undefined as any,
  };
}

describe('notify_discord', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: Array<{ url: string; init: RequestInit }>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(status: number, body = '') {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetchCalls.push({ url, init: init ?? {} });
      return new Response(body, {
        status,
        headers: { 'Content-Type': 'text/plain' },
      });
    }) as typeof globalThis.fetch;
  }

  function setup(secrets: Record<string, string> = {}) {
    const registry = createToolRegistry();
    const deps = makeDeps({
      secrets: Object.keys(secrets).length > 0 ? makeSecretManager(secrets) : undefined,
    });
    registerNotifyTools(registry, deps);
    return registry;
  }

  test('returns error when DISCORD_WEBHOOK_URL secret is missing (no manager)', async () => {
    const registry = setup();
    const result = await registry.execute('notify_discord', { content: 'hello' });
    expect(result).toContain('DISCORD_WEBHOOK_URL');
    expect(result).toContain('not configured');
    expect(fetchCalls).toHaveLength(0);
  });

  test('returns error when secrets manager exists but key is missing', async () => {
    const registry = setup({ OTHER_KEY: 'value' });
    const result = await registry.execute('notify_discord', { content: 'hello' });
    expect(result).toContain('DISCORD_WEBHOOK_URL');
    expect(result).toContain('not configured');
    expect(fetchCalls).toHaveLength(0);
  });

  test('sends plain message payload without title', async () => {
    const webhookUrl = 'https://discord.test/webhook';
    const registry = setup({ DISCORD_WEBHOOK_URL: webhookUrl });
    mockFetch(204);

    const result = await registry.execute('notify_discord', {
      content: 'hello world',
    });

    expect(result).toBe('Notification sent.');
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe(webhookUrl);
    expect(fetchCalls[0]!.init.method).toBe('POST');

    const body = JSON.parse(fetchCalls[0]!.init.body as string);
    expect(body).toEqual({ content: 'hello world' });
    expect(body.embeds).toBeUndefined();

    const headers = fetchCalls[0]!.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('sends embed payload when title is provided', async () => {
    const webhookUrl = 'https://discord.test/webhook';
    const registry = setup({ DISCORD_WEBHOOK_URL: webhookUrl });
    mockFetch(204);

    const result = await registry.execute('notify_discord', {
      content: 'details here',
      title: 'Alert',
    });

    expect(result).toBe('Notification sent.');
    const body = JSON.parse(fetchCalls[0]!.init.body as string);
    expect(body).toEqual({
      embeds: [{ title: 'Alert', description: 'details here' }],
    });
    expect(body.content).toBeUndefined();
  });

  test('truncates content to 2000 chars in plain message', async () => {
    const registry = setup({ DISCORD_WEBHOOK_URL: 'https://discord.test/webhook' });
    mockFetch(204);

    await registry.execute('notify_discord', {
      content: 'a'.repeat(3000),
    });

    const body = JSON.parse(fetchCalls[0]!.init.body as string);
    expect(body.content).toHaveLength(2000);
  });

  test('truncates content to 2000 chars in embed description', async () => {
    const registry = setup({ DISCORD_WEBHOOK_URL: 'https://discord.test/webhook' });
    mockFetch(204);

    await registry.execute('notify_discord', {
      content: 'b'.repeat(3000),
      title: 'Long Content',
    });

    const body = JSON.parse(fetchCalls[0]!.init.body as string);
    expect(body.embeds[0].description).toHaveLength(2000);
  });

  test('returns error string on webhook failure', async () => {
    const registry = setup({ DISCORD_WEBHOOK_URL: 'https://discord.test/webhook' });
    mockFetch(500, 'Internal Server Error');

    const result = await registry.execute('notify_discord', {
      content: 'test',
    });

    expect(result).toContain('500');
    expect(result).toContain('Internal Server Error');
  });
});
