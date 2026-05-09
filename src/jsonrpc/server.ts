// pattern: Imperative Shell

import * as readline from 'readline';
import type { JsonRpcRequest, MethodHandler } from './types.ts';
import { sendReady } from './notifications.ts';

type JsonRpcResponse = {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
};

function sendResponse(response: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

function sendErrorResponse(id: number | string | null, code: number, message: string): void {
  sendResponse({ jsonrpc: '2.0', id, error: { code, message } });
}

function isValidRequest(msg: unknown): msg is JsonRpcRequest {
  if (typeof msg !== 'object' || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  return (
    obj.jsonrpc === '2.0' &&
    typeof obj.method === 'string' &&
    (typeof obj.id === 'number' || typeof obj.id === 'string')
  );
}

// Note: JSON-RPC notifications (requests without an 'id' field) are intentionally
// unhandled in this phase. Only requests with an id are processed and responded to.
// Incoming notifications are silently discarded.

export function startJsonRpcServer(handlers: Record<string, MethodHandler>): void {
  const rl = readline.createInterface({ input: process.stdin });

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      sendErrorResponse(null, -32700, 'Parse error');
      return;
    }

    if (!isValidRequest(parsed)) {
      sendErrorResponse(null, -32600, 'Invalid Request');
      return;
    }

    const handler = handlers[parsed.method];
    if (!handler) {
      sendErrorResponse(parsed.id, -32601, `Method not found: ${parsed.method}`);
      return;
    }

    try {
      const result = await handler(parsed.params as Record<string, unknown> | undefined);
      sendResponse({ jsonrpc: '2.0', id: parsed.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      sendErrorResponse(parsed.id, -32603, message);
    }
  });

  sendReady();
}
