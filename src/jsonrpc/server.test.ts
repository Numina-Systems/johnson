// pattern: Imperative Shell (test)

import { describe, expect, it, mock } from 'bun:test';
import { startJsonRpcServer } from './server.ts';
import type { MethodHandler } from './types.ts';

describe('startJsonRpcServer', () => {
  it('I2.AC1.1: emits ready notification on startup', () => {
    const outputs: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = mock((data: string) => {
      outputs.push(data);
      return true as any;
    });

    const handlers: Record<string, MethodHandler> = {};
    startJsonRpcServer(handlers);

    expect(outputs.length).toBeGreaterThan(0);
    const readyLine = outputs[0];
    expect(readyLine).toBeTruthy();

    const readyMsg = JSON.parse(readyLine);
    expect(readyMsg.jsonrpc).toBe('2.0');
    expect(readyMsg.method).toBe('ready');
    expect(readyMsg.params).toEqual({
      protocolVersion: '1',
      capabilities: ['sessions', 'chat', 'secrets', 'skills', 'customTools', 'schedules', 'prompt'],
    });

    process.stdout.write = originalWrite;
  });

  it('I2.AC1.2: malformed JSON produces -32700 parse error', async () => {
    const outputs: string[] = [];
    const originalWrite = process.stdout.write;
    const originalStdin = process.stdin;

    process.stdout.write = mock((data: string) => {
      outputs.push(data);
      return true as any;
    });

    // Create a mock input stream that emits a malformed JSON line
    const { Readable } = await import('stream');
    const mockInput = new Readable({
      read() {
        this.push('{invalid json}\n');
        this.push(null);
      },
    });
    process.stdin = mockInput as any;

    const handlers: Record<string, MethodHandler> = {};
    startJsonRpcServer(handlers);

    // Wait for the handler to process the input
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Find the error response (skip the ready notification)
    const errorResponse = outputs.find((line) => {
      try {
        const msg = JSON.parse(line);
        return msg.error?.code === -32700;
      } catch {
        return false;
      }
    });

    expect(errorResponse).toBeTruthy();
    const response = JSON.parse(errorResponse!);
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBeNull();
    expect(response.error).toEqual({
      code: -32700,
      message: 'Parse error',
    });

    process.stdout.write = originalWrite;
    process.stdin = originalStdin;
  });

  it('I2.AC1.3: invalid request (missing id) produces -32600 error', async () => {
    const outputs: string[] = [];
    const originalWrite = process.stdout.write;
    const originalStdin = process.stdin;

    process.stdout.write = mock((data: string) => {
      outputs.push(data);
      return true as any;
    });

    // Create a mock input stream
    const { Readable } = await import('stream');
    const mockInput = new Readable({
      read() {
        this.push(JSON.stringify({ jsonrpc: '2.0', method: 'test_method' }) + '\n');
        this.push(null);
      },
    });
    process.stdin = mockInput as any;

    const handlers: Record<string, MethodHandler> = {};
    startJsonRpcServer(handlers);

    // Wait for the handler to process the input
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Find the error response
    const errorResponse = outputs.find((line) => {
      try {
        const msg = JSON.parse(line);
        return msg.error?.code === -32600;
      } catch {
        return false;
      }
    });

    expect(errorResponse).toBeTruthy();
    const response = JSON.parse(errorResponse!);
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBeNull();
    expect(response.error).toEqual({
      code: -32600,
      message: 'Invalid Request',
    });

    process.stdout.write = originalWrite;
    process.stdin = originalStdin;
  });

  it('I2.AC1.4: unknown method produces -32601 error', async () => {
    const outputs: string[] = [];
    const originalWrite = process.stdout.write;
    const originalStdin = process.stdin;

    process.stdout.write = mock((data: string) => {
      outputs.push(data);
      return true as any;
    });

    // Create a mock input stream
    const { Readable } = await import('stream');
    const mockInput = new Readable({
      read() {
        this.push(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'test-123',
            method: 'unknown_method',
          }) + '\n',
        );
        this.push(null);
      },
    });
    process.stdin = mockInput as any;

    const handlers: Record<string, MethodHandler> = {};
    startJsonRpcServer(handlers);

    // Wait for the handler to process the input
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Find the error response
    const errorResponse = outputs.find((line) => {
      try {
        const msg = JSON.parse(line);
        return msg.error?.code === -32601;
      } catch {
        return false;
      }
    });

    expect(errorResponse).toBeTruthy();
    const response = JSON.parse(errorResponse!);
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe('test-123');
    expect(response.error).toEqual({
      code: -32601,
      message: 'Method not found: unknown_method',
    });

    process.stdout.write = originalWrite;
    process.stdin = originalStdin;
  });

  it('I2.AC1.5: valid request dispatches to handler and returns result', async () => {
    const outputs: string[] = [];
    const originalWrite = process.stdout.write;
    const originalStdin = process.stdin;

    process.stdout.write = mock((data: string) => {
      outputs.push(data);
      return true as any;
    });

    // Create a mock input stream
    const { Readable } = await import('stream');
    const mockInput = new Readable({
      read() {
        this.push(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'test-456',
            method: 'test_method',
            params: { foo: 'bar' },
          }) + '\n',
        );
        this.push(null);
      },
    });
    process.stdin = mockInput as any;

    const handlers: Record<string, MethodHandler> = {
      test_method: async (params) => {
        return { success: true, input: params };
      },
    };
    startJsonRpcServer(handlers);

    // Wait for the handler to process the input
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Find the result response
    const resultResponse = outputs.find((line) => {
      try {
        const msg = JSON.parse(line);
        return msg.result && msg.id === 'test-456';
      } catch {
        return false;
      }
    });

    expect(resultResponse).toBeTruthy();
    const response = JSON.parse(resultResponse!);
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe('test-456');
    expect(response.result).toEqual({
      success: true,
      input: { foo: 'bar' },
    });

    process.stdout.write = originalWrite;
    process.stdin = originalStdin;
  });
});
