// pattern: Imperative Shell (test) — exercises viewImage with mocked fetch

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { registerImageTools, viewImage } from './image.ts';
import { createToolRegistry, type ToolMode } from '../runtime/tool-registry.ts';
import type { ToolDefinition } from '../model/types.ts';
import type { ToolHandler } from '../runtime/tool-registry.ts';

const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
  0x00, 0x01, 0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

type FetchInput = Parameters<typeof fetch>[0];
type FetchArgs = { input: FetchInput; init?: RequestInit };

const originalFetch = globalThis.fetch;
let fetchCalls: FetchArgs[] = [];

function installFetchMock(impl: (input: FetchInput, init?: RequestInit) => Promise<Response>): void {
  fetchCalls = [];
  globalThis.fetch = ((input: FetchInput, init?: RequestInit) => {
    fetchCalls.push({ input, init });
    return impl(input, init);
  }) as typeof fetch;
}

beforeEach(() => {
  fetchCalls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('viewImage', () => {
  it('GH09.AC1.1 / AC3.1: returns ImageResult with base64 data and correct media_type for a PNG', async () => {
    installFetchMock(async () => {
      return new Response(TINY_PNG, {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(TINY_PNG.byteLength),
        },
      });
    });

    const result = await viewImage('https://example.com/tiny.png');

    expect(result.type).toBe('image_result');
    expect(result.image.type).toBe('base64');
    expect(result.image.media_type).toBe('image/png');
    expect(result.image.data).toBe(Buffer.from(TINY_PNG).toString('base64'));
    expect(result.text).toContain('https://example.com/tiny.png');
  });

  it('GH09.AC1.2: throws when content-type is not an image', async () => {
    installFetchMock(async () => {
      return new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });

    await expect(viewImage('https://example.com/page')).rejects.toThrow(/Not an image/);
  });

  it('GH09.AC1.2 (HTTP error): throws with status code on non-2xx response', async () => {
    installFetchMock(async () => {
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });

    await expect(viewImage('https://example.com/missing.png')).rejects.toThrow(/HTTP 404/);
  });

  it('GH09.AC2.1: rejects when content-length header exceeds 10MB without reading body', async () => {
    let arrayBufferCalled = false;
    installFetchMock(async () => {
      const inner = new Response(new Uint8Array(0), {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(20 * 1024 * 1024),
        },
      });
      const wrapper = {
        ok: inner.ok,
        status: inner.status,
        statusText: inner.statusText,
        headers: inner.headers,
        arrayBuffer: async (): Promise<ArrayBuffer> => {
          arrayBufferCalled = true;
          return inner.arrayBuffer();
        },
      } as unknown as Response;
      return wrapper;
    });

    await expect(viewImage('https://example.com/huge.png')).rejects.toThrow(/too large/);
    expect(arrayBufferCalled).toBe(false);
  });

  it('GH09.AC2.2: rejects when body bytes exceed 10MB even with no content-length', async () => {
    const bigPayload = new Uint8Array(11 * 1024 * 1024);
    installFetchMock(async () => {
      const headers = new Headers({ 'content-type': 'image/png' });
      return new Response(bigPayload, { status: 200, headers });
    });

    await expect(viewImage('https://example.com/big.png')).rejects.toThrow(/too large/);
  });

  it('GH09.AC6.1: passes an AbortSignal to fetch (30s timeout)', async () => {
    installFetchMock(async () => {
      return new Response(TINY_PNG, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    });

    await viewImage('https://example.com/tiny.png');

    expect(fetchCalls).toHaveLength(1);
    const init = fetchCalls[0]!.init;
    expect(init).toBeDefined();
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('strips charset and parameters from content-type for media_type', async () => {
    installFetchMock(async () => {
      return new Response(TINY_PNG, {
        status: 200,
        headers: { 'content-type': 'image/png; charset=binary' },
      });
    });

    const result = await viewImage('https://example.com/tiny.png');
    expect(result.image.media_type).toBe('image/png');
  });
});

describe('registerImageTools', () => {
  it('GH09.AC7.1: registers view_image with mode native', () => {
    type RegisterCall = {
      name: string;
      definition: ToolDefinition;
      handler: ToolHandler;
      mode: ToolMode | undefined;
    };
    const calls: RegisterCall[] = [];
    const fakeRegistry = {
      register: (name: string, definition: ToolDefinition, handler: ToolHandler, mode?: ToolMode) => {
        calls.push({ name, definition, handler, mode });
      },
    } as unknown as Parameters<typeof registerImageTools>[0];

    registerImageTools(fakeRegistry);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('view_image');
    expect(calls[0]!.mode).toBe('native');
    expect(calls[0]!.definition.input_schema).toEqual({
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Image URL to fetch and view' },
      },
      required: ['url'],
    });
  });

  it('also confirms native mode via createToolRegistry: tool appears in generateToolDefinitions but not in stubs', () => {
    const registry = createToolRegistry();
    registerImageTools(registry);

    const defs = registry.generateToolDefinitions();
    expect(defs.some((d) => d.name === 'view_image')).toBe(true);

    const stubs = registry.generateTypeScriptStubs();
    expect(stubs).not.toContain('view_image');
  });

  it('handler rejects when url param is missing', async () => {
    const registry = createToolRegistry();
    registerImageTools(registry);
    const entry = registry.get('view_image');
    expect(entry).toBeDefined();
    await expect(entry!.handler({})).rejects.toThrow(/missing required param: url/);
  });
});
