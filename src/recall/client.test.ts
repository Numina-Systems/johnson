// pattern: Unit tests (Bun)

import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
import { RecallClient } from './client.ts';

describe('RecallClient', () => {
  let fetchMock: typeof global.fetch;

  beforeEach(() => {
    fetchMock = mock();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    fetchMock.mockClear();
  });

  describe('query()', () => {
    test('returns answer on successful query', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ answer: 'test answer', num_slots_searched: 10 }),
          { status: 200 }
        )
      );

      const client = new RecallClient('http://localhost:8420', 5000);
      const result = await client.query('what is x?');

      expect(result).toBe('test answer');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('returns null on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network error'));

      const client = new RecallClient('http://localhost:8420', 5000);
      const result = await client.query('what is x?');

      expect(result).toBeNull();
    });

    test('returns null on timeout', async () => {
      fetchMock.mockImplementationOnce(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new DOMException('timeout', 'AbortError')), 100)
          )
      );

      const client = new RecallClient('http://localhost:8420', 50);
      const result = await client.query('what is x?');

      expect(result).toBeNull();
    });

    test('returns null on non-2xx response', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'server error' }), { status: 500 })
      );

      const client = new RecallClient('http://localhost:8420', 5000);
      const result = await client.query('what is x?');

      expect(result).toBeNull();
    });

    test('passes maxTokens parameter when provided', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ answer: 'test answer', num_slots_searched: 10 }),
          { status: 200 }
        )
      );

      const client = new RecallClient('http://localhost:8420', 5000);
      await client.query('what is x?', 1000);

      const callArgs = fetchMock.mock.calls[0];
      const requestBody = callArgs?.[1]?.body
        ? JSON.parse(callArgs[1].body as string)
        : undefined;
      expect(requestBody?.max_tokens).toBe(1000);
    });
  });

  describe('encode()', () => {
    test('returns slot count on successful encode', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ rkey: 'doc1', num_slots: 5 }), { status: 200 })
      );

      const client = new RecallClient('http://localhost:8420', 5000);
      const result = await client.encode('doc1', 'some text');

      expect(result).toBe(5);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('returns null on encode error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network error'));

      const client = new RecallClient('http://localhost:8420', 5000);
      const result = await client.encode('doc1', 'some text');

      expect(result).toBeNull();
    });

    test('returns null on non-2xx response', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'server error' }), { status: 500 })
      );

      const client = new RecallClient('http://localhost:8420', 5000);
      const result = await client.encode('doc1', 'some text');

      expect(result).toBeNull();
    });
  });

  describe('deleteSlots()', () => {
    test('returns deleted count on successful delete', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ rkey: 'doc1', deleted_count: 3 }), { status: 200 })
      );

      const client = new RecallClient('http://localhost:8420', 5000);
      const result = await client.deleteSlots('doc1');

      expect(result).toBe(3);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('returns null on delete error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network error'));

      const client = new RecallClient('http://localhost:8420', 5000);
      const result = await client.deleteSlots('doc1');

      expect(result).toBeNull();
    });

    test('returns null on non-2xx response', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'server error' }), { status: 500 })
      );

      const client = new RecallClient('http://localhost:8420', 5000);
      const result = await client.deleteSlots('doc1');

      expect(result).toBeNull();
    });
  });

  describe('health()', () => {
    test('returns true on successful health check', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));

      const client = new RecallClient('http://localhost:8420', 5000);
      const result = await client.health();

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('returns false on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network error'));

      const client = new RecallClient('http://localhost:8420', 5000);
      const result = await client.health();

      expect(result).toBe(false);
    });

    test('returns false on non-2xx response', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'server error' }), { status: 500 })
      );

      const client = new RecallClient('http://localhost:8420', 5000);
      const result = await client.health();

      expect(result).toBe(false);
    });
  });

  describe('graceful degradation', () => {
    test('errors never propagate — methods return null on any failure', async () => {
      const errorScenarios = [
        () => fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')),
        () => fetchMock.mockResolvedValueOnce(new Response('invalid json', { status: 200 })),
        () =>
          fetchMock.mockImplementationOnce(
            () => new Promise((_, reject) => reject(new Error('abort')))
          ),
      ];

      for (const scenario of errorScenarios) {
        scenario();

        const client = new RecallClient('http://localhost:8420', 5000);
        const result = await client.query('test');

        expect(result).toBeNull();
      }
    });
  });
});
