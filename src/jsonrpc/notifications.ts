// pattern: Imperative Shell

import type { JsonRpcNotification } from './types.ts';

function sendNotification(method: string, params: Record<string, unknown>): void {
  const message: JsonRpcNotification = {
    jsonrpc: '2.0',
    method,
    params,
  };
  process.stdout.write(JSON.stringify(message) + '\n');
}

export function sendReady(): void {
  sendNotification('ready', {
    protocolVersion: '1',
    capabilities: ['sessions', 'chat', 'secrets', 'skills', 'customTools', 'schedules', 'prompt'],
  });
}
