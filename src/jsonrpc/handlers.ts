// pattern: Imperative Shell

import type { MethodHandler, SessionListParams, SessionCreateParams, SessionDeleteParams, SessionMessagesParams } from './types.ts';
import type { Store } from '../store/store.ts';

export type JsonRpcDependencies = {
  readonly store: Store;
};

export function createHandlers(deps: JsonRpcDependencies): Record<string, MethodHandler> {
  return {
    'session/list': async (params: Record<string, unknown> | undefined) => {
      const p = params as SessionListParams | undefined;
      return deps.store.listSessionsPaginated(p?.limit, p?.cursor);
    },

    'session/create': async (params: Record<string, unknown> | undefined) => {
      const p = params as SessionCreateParams | undefined;
      const id = crypto.randomUUID();
      deps.store.createSession(id, p?.title);
      return { id };
    },

    'session/delete': async (params: Record<string, unknown> | undefined) => {
      const p = params as SessionDeleteParams | undefined;
      if (!p?.id) {
        return { ok: false };
      }
      const ok = deps.store.deleteSession(p.id);
      return { ok };
    },

    'session/messages': async (params: Record<string, unknown> | undefined) => {
      const p = params as SessionMessagesParams | undefined;
      if (!p?.sessionId) {
        return { messages: [], cursor: undefined };
      }
      return deps.store.getMessagesPaginated(p.sessionId, p?.limit, p?.cursor);
    },
  };
}
