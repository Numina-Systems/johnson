// pattern: Integration tests (Bun)

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createToolRegistry } from '../runtime/tool-registry.ts';
import { createAgentTools } from '../agent/tools.ts';
import type { AgentDependencies } from '../agent/types.ts';
import type { Store } from '../store/store.ts';
import { RecallClient } from './client.ts';

function makeStore(overrides: Partial<Store> = {}): Store {
  return {
    docUpsert: mock(),
    docGet: mock(),
    docList: mock(),
    docSearch: mock(),
    saveEmbedding: mock(),
    getGrant: mock(),
    saveGrant: mock(),
    ...overrides,
  } as any;
}

function makeDeps(overrides: Partial<AgentDependencies> = {}): Readonly<AgentDependencies> {
  return {
    model: undefined as any,
    runtime: undefined as any,
    config: undefined as any,
    personaPath: '',
    store: makeStore(),
    recallClient: undefined,
    ...overrides,
  };
}

describe('Recall integration', () => {
  let fetchMock: typeof global.fetch;

  beforeEach(() => {
    fetchMock = mock();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    fetchMock.mockClear();
  });

  describe('Tool registration', () => {
    test('recall_query is registered when recallClient is provided', () => {
      const recallClient = new RecallClient('http://localhost:8420', 5000);
      const deps = makeDeps({ recallClient });
      const registry = createAgentTools(deps, {});

      const toolNames = registry.list().map(t => t.name);
      expect(toolNames).toContain('recall_query');
    });

    test('recall_query is not registered when recallClient is undefined', () => {
      const deps = makeDeps({ recallClient: undefined });
      const registry = createAgentTools(deps, {});

      const toolNames = registry.list().map(t => t.name);
      expect(toolNames).not.toContain('recall_query');
    });
  });

  describe('recall_query tool behavior', () => {
    test('returns plain text answer from RecallClient', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ answer: 'The sky is blue', num_slots_searched: 5 }),
          { status: 200 }
        )
      );

      const recallClient = new RecallClient('http://localhost:8420', 5000);
      const deps = makeDeps({ recallClient });
      const registry = createAgentTools(deps, {});

      const result = await registry.execute('recall_query', { query: 'what color is the sky?' });

      expect(result).toBe('The sky is blue');
    });

    test('returns "Recall server unavailable" when client returns null', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network error'));

      const recallClient = new RecallClient('http://localhost:8420', 5000);
      const deps = makeDeps({ recallClient });
      const registry = createAgentTools(deps, {});

      const result = await registry.execute('recall_query', { query: 'what color is the sky?' });

      expect(result).toBe('Recall server unavailable');
    });

    test('passes max_results parameter when provided', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ answer: 'test answer', num_slots_searched: 10 }),
          { status: 200 }
        )
      );

      const recallClient = new RecallClient('http://localhost:8420', 5000);
      const deps = makeDeps({ recallClient });
      const registry = createAgentTools(deps, {});

      await registry.execute('recall_query', {
        query: 'what is x?',
        max_results: 500,
      });

      const callArgs = fetchMock.mock.calls[0];
      const requestBody = callArgs?.[1]?.body
        ? JSON.parse(callArgs[1].body as string)
        : undefined;
      expect(requestBody?.max_tokens).toBe(500);
    });
  });

  describe('doc_upsert encoding hook', () => {
    test('calls recallClient.encode() after saving document', async () => {
      const encodeMock = mock();
      encodeMock.mockResolvedValue(5);

      const recallClient = {
        encode: encodeMock,
      } as any;

      const storeMock = makeStore();
      const deps = makeDeps({
        recallClient,
        store: storeMock,
      });
      const registry = createAgentTools(deps, {});

      await registry.execute('doc_upsert', {
        rkey: 'test-doc',
        content: 'some test content',
      });

      // Verify store.docUpsert was called
      expect(storeMock.docUpsert).toHaveBeenCalled();

      // Verify encode was called with correct rkey and content (may be async, give it a tick)
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(encodeMock).toHaveBeenCalledWith('test-doc', 'some test content');
    });

    test('doc_upsert succeeds even when recallClient.encode() returns null', async () => {
      fetchMock.mockRejectedValueOnce(new Error('server offline'));

      const recallClient = new RecallClient('http://localhost:8420', 5000);
      const deps = makeDeps({ recallClient });
      const registry = createAgentTools(deps, {});

      const result = await registry.execute('doc_upsert', {
        rkey: 'test-doc',
        content: 'some test content',
      });

      expect(result).toContain('Document saved');
    });

    test('doc_upsert succeeds even when recallClient throws error during encode', async () => {
      const encodeMock = mock();
      encodeMock.mockRejectedValueOnce(new Error('encoding failed'));

      const recallClient = {
        encode: encodeMock,
      } as any;

      const deps = makeDeps({ recallClient });
      const registry = createAgentTools(deps, {});

      const result = await registry.execute('doc_upsert', {
        rkey: 'test-doc',
        content: 'some test content',
      });

      // Should still succeed despite encode error
      expect(result).toContain('Document saved');
    });

    test('does not call encode when recallClient is undefined', async () => {
      const deps = makeDeps({ recallClient: undefined });
      const registry = createAgentTools(deps, {});

      const result = await registry.execute('doc_upsert', {
        rkey: 'test-doc',
        content: 'some test content',
      });

      expect(result).toContain('Document saved');
      // No fetch calls should be made if recallClient is undefined
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
