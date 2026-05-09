// pattern: Imperative Shell

import type { MethodHandler, SessionListParams, SessionCreateParams, SessionDeleteParams, SessionMessagesParams, AgentChatParams, AgentResetResult } from './types.ts';
import type { Store } from '../store/store.ts';
import type { Agent } from '../agent/types.ts';
import { sendAgentEvent, sendAgentResponse } from './notifications.ts';

export type JsonRpcDependencies = {
  readonly store: Store;
  readonly agent?: Agent;
  readonly emitter?: {
    onAgentEvent?: (requestId: string, kind: string, data: Record<string, unknown>) => void;
    onAgentResponse?: (requestId: string, text: string, stats: Record<string, unknown>) => void;
  };
};

export function createHandlers(deps: JsonRpcDependencies): Record<string, MethodHandler> {
  const handlers: Record<string, MethodHandler> = {
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

  // Add agent handlers if agent is provided
  if (deps.agent) {
    handlers['agent/chat'] = async (params: Record<string, unknown> | undefined) => {
      const p = params as AgentChatParams | undefined;
      if (!p?.message || !p?.sessionId) {
        throw new Error('agent/chat requires message and sessionId');
      }

      const requestId = crypto.randomUUID();
      const emitEvent = deps.emitter?.onAgentEvent ?? ((rid, kind, data) => sendAgentEvent(rid, kind, data));
      const emitResponse = deps.emitter?.onAgentResponse ?? ((rid, text, stats) => sendAgentResponse(rid, text, stats));

      // Fire-and-forget: return requestId immediately, run chat in background
      (async () => {
        try {
          const result = await deps.agent!.chat(p.message, {
            sessionId: p.sessionId,
            onEvent: async (event) => {
              emitEvent(requestId, event.kind, event.data);
            },
          });

          emitResponse(requestId, result.text, result.stats);
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          emitResponse(requestId, errorText, {
            inputTokens: 0,
            outputTokens: 0,
            contextEstimate: 0,
            contextLimit: 0,
            rounds: 0,
            durationMs: 0,
          });
        }
      })();

      return { requestId };
    };

    handlers['agent/reset'] = async () => {
      deps.agent!.reset();
      return { ok: true };
    };
  }

  return handlers;
}
