// pattern: Imperative Shell

import type { MethodHandler } from './types.ts';

export type JsonRpcDependencies = {
  // Will be populated in later phases as handlers are added
};

export function createHandlers(_deps: JsonRpcDependencies): Record<string, MethodHandler> {
  return {};
}
