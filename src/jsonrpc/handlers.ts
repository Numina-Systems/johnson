// pattern: Imperative Shell

import type {
  MethodHandler,
  SessionListParams,
  SessionCreateParams,
  SessionDeleteParams,
  SessionMessagesParams,
  AgentChatParams,
  AgentResetResult,
  SkillListResult,
  SkillGrantParams,
  SkillUpdateSecretsParams,
  SkillDeleteParams,
  CustomToolListResult,
  CustomToolApproveParams,
  CustomToolRevokeParams,
  CustomToolUpdateSecretsParams,
  GrantListResult,
  BuiltinListResult,
  OkResult,
  SecretListResult,
  SecretSetParams,
  SecretRemoveParams,
  ScheduleListResult,
  ScheduleSetEnabledParams,
  PromptGetResult,
} from './types.ts';
import type { Store } from '../store/store.ts';
import type { Agent } from '../agent/types.ts';
import type { CustomToolManager } from '../tools/custom-tool-manager.ts';
import type { SecretManager } from '../secrets/manager.ts';
import type { TaskStore } from '../scheduler/types.ts';
import { sendAgentEvent, sendAgentResponse } from './notifications.ts';

export type JsonRpcDependencies = {
  readonly store: Store;
  readonly agent?: Agent;
  readonly customTools?: CustomToolManager;
  readonly builtinTools?: ReadonlyArray<{ readonly name: string; readonly description: string }>;
  readonly secrets?: SecretManager;
  readonly scheduler?: TaskStore;
  readonly buildPrompt?: () => string;
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

  // Skills handlers
  if (deps.store) {
    handlers['skill/list'] = async (): Promise<SkillListResult> => {
      const result = deps.store.docList(500);
      const skills = [];

      for (const doc of result.documents) {
        if (!doc.rkey.startsWith('skill:')) continue;

        const grant = deps.store.getGrant(doc.rkey);
        const description = extractDescription(doc.content);

        skills.push({
          rkey: doc.rkey,
          description,
          grantStatus: grant?.status ?? null,
          secrets: grant?.secrets ?? [],
        });
      }

      return { skills };
    };

    handlers['skill/grant'] = async (params: Record<string, unknown> | undefined): Promise<OkResult> => {
      const p = params as SkillGrantParams | undefined;
      if (!p?.rkey || !p?.status) {
        throw new Error('skill/grant requires rkey and status');
      }
      if (p.status !== 'granted' && p.status !== 'revoked') {
        throw new Error('skill/grant status must be "granted" or "revoked"');
      }
      const status = p.status as 'granted' | 'revoked';
      deps.store.updateGrantStatus(p.rkey, status);
      return { ok: true };
    };

    handlers['skill/updateSecrets'] = async (params: Record<string, unknown> | undefined): Promise<OkResult> => {
      const p = params as SkillUpdateSecretsParams | undefined;
      if (!p?.rkey) {
        throw new Error('skill/updateSecrets requires rkey');
      }
      deps.store.updateGrantSecrets(p.rkey, p.secrets ?? []);
      return { ok: true };
    };

    handlers['skill/delete'] = async (params: Record<string, unknown> | undefined): Promise<OkResult> => {
      const p = params as SkillDeleteParams | undefined;
      if (!p?.rkey) {
        throw new Error('skill/delete requires rkey');
      }
      deps.store.docDelete(p.rkey);
      deps.store.deleteGrant(p.rkey);
      return { ok: true };
    };

    handlers['grant/list'] = async (): Promise<GrantListResult> => {
      const grants = deps.store.listGrants();
      return { grants };
    };
  }

  // Custom tools handlers
  if (deps.customTools) {
    handlers['customTool/list'] = async (): Promise<CustomToolListResult> => {
      const tools = deps.customTools!.listTools();
      return {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          approved: t.approved,
          codeHash: t.codeHash,
          secrets: t.secrets,
        })),
      };
    };

    handlers['customTool/approve'] = async (params: Record<string, unknown> | undefined): Promise<OkResult> => {
      const p = params as CustomToolApproveParams | undefined;
      if (!p?.name) {
        throw new Error('customTool/approve requires name');
      }
      const result = deps.customTools!.approveTool(p.name);
      return { ok: result };
    };

    handlers['customTool/revoke'] = async (params: Record<string, unknown> | undefined): Promise<OkResult> => {
      const p = params as CustomToolRevokeParams | undefined;
      if (!p?.name) {
        throw new Error('customTool/revoke requires name');
      }
      const result = deps.customTools!.revokeTool(p.name);
      return { ok: result };
    };

    handlers['customTool/updateSecrets'] = async (params: Record<string, unknown> | undefined): Promise<OkResult> => {
      const p = params as CustomToolUpdateSecretsParams | undefined;
      if (!p?.name) {
        throw new Error('customTool/updateSecrets requires name');
      }
      const result = deps.customTools!.updateSecrets(p.name, p.secrets ?? []);
      return { ok: result };
    };
  }

  // Builtin tools handler
  if (deps.builtinTools) {
    handlers['builtin/list'] = async (): Promise<BuiltinListResult> => {
      return { tools: deps.builtinTools! };
    };
  }

  // Secrets handlers
  if (deps.secrets) {
    handlers['secret/list'] = async (): Promise<SecretListResult> => {
      const keys = deps.secrets!.listKeys();
      return { keys };
    };

    handlers['secret/set'] = async (params: Record<string, unknown> | undefined): Promise<OkResult> => {
      const p = params as SecretSetParams | undefined;
      if (typeof p?.key !== 'string' || typeof p?.value !== 'string') {
        throw new Error('secret/set requires key and value');
      }
      await deps.secrets!.set(p.key, p.value);
      return { ok: true };
    };

    handlers['secret/remove'] = async (params: Record<string, unknown> | undefined): Promise<OkResult> => {
      const p = params as SecretRemoveParams | undefined;
      if (typeof p?.key !== 'string') {
        throw new Error('secret/remove requires key');
      }
      await deps.secrets!.remove(p.key);
      return { ok: true };
    };
  }

  // Schedule handlers
  if (deps.scheduler) {
    handlers['schedule/list'] = async (): Promise<ScheduleListResult> => {
      const tasks = deps.scheduler!.list();
      return { tasks };
    };

    handlers['schedule/setEnabled'] = async (params: Record<string, unknown> | undefined): Promise<OkResult> => {
      const p = params as ScheduleSetEnabledParams | undefined;
      if (typeof p?.id !== 'string' || typeof p?.enabled !== 'boolean') {
        throw new Error('schedule/setEnabled requires id and enabled');
      }
      const ok = deps.scheduler!.setEnabled(p.id, p.enabled);
      return { ok };
    };
  }

  // Prompt handler
  if (deps.buildPrompt) {
    handlers['prompt/get'] = async (): Promise<PromptGetResult> => {
      const prompt = deps.buildPrompt!();
      return { prompt };
    };
  }

  return handlers;
}

// pattern: Functional Core — helper to extract description from skill content
function extractDescription(content: string): string | null {
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.startsWith('// Description:')) {
      return line.replace(/^\/\/\s*Description:\s*/, '').trim();
    }
  }
  return null;
}
