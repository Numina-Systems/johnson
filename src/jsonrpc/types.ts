// pattern: Functional Core

export type JsonRpcMessage = {
  readonly jsonrpc: '2.0';
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
};

export type JsonRpcError = {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
};

export type JsonRpcRequest = {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
};

export type JsonRpcNotification = {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: Record<string, unknown>;
};

export type ReadyParams = {
  readonly protocolVersion: string;
  readonly capabilities: ReadonlyArray<string>;
};

export type MethodHandler = (
  params: Record<string, unknown> | undefined,
) => Promise<unknown>;

// Session types for JSON-RPC handlers

export type SessionListParams = {
  readonly limit?: number;
  readonly cursor?: string;
};

export type SessionListResult = {
  readonly sessions: ReadonlyArray<{
    readonly id: string;
    readonly title: string | null;
    readonly updatedAt: string;
    readonly messageCount: number;
  }>;
  readonly cursor?: string;
};

export type SessionCreateParams = {
  readonly title?: string;
};

export type SessionCreateResult = {
  readonly id: string;
};

export type SessionDeleteParams = {
  readonly id: string;
};

export type SessionDeleteResult = {
  readonly ok: boolean;
};

export type SessionMessagesParams = {
  readonly sessionId: string;
  readonly limit?: number;
  readonly cursor?: string;
};

export type SessionMessagesResult = {
  readonly messages: ReadonlyArray<{
    readonly id: number;
    readonly role: string;
    readonly content: string;
    readonly createdAt: string;
  }>;
  readonly cursor?: string;
};

// Chat types for JSON-RPC handlers

export type AgentChatParams = {
  readonly message: string;
  readonly sessionId: string;
};

export type AgentChatResult = {
  readonly requestId: string;
};

export type AgentResetResult = {
  readonly ok: boolean;
};

export type AgentEventNotification = {
  readonly requestId: string;
  readonly kind: 'llm_start' | 'llm_done' | 'tool_start' | 'tool_done' | 'recall_done';
  readonly data: Record<string, unknown>;
};

export type AgentResponseNotification = {
  readonly requestId: string;
  readonly text: string;
  readonly stats: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly contextEstimate: number;
    readonly contextLimit: number;
    readonly rounds: number;
    readonly durationMs: number;
  };
};

// Skills types for JSON-RPC handlers

export type SkillInfo = {
  readonly rkey: string;
  readonly description: string | null;
  readonly grantStatus: 'pending' | 'granted' | 'revoked' | null;
  readonly secrets: ReadonlyArray<string>;
};

export type SkillListResult = {
  readonly skills: ReadonlyArray<SkillInfo>;
};

export type SkillGrantParams = {
  readonly rkey: string;
  readonly status: 'granted' | 'revoked';
};

export type SkillUpdateSecretsParams = {
  readonly rkey: string;
  readonly secrets: ReadonlyArray<string>;
};

export type SkillDeleteParams = {
  readonly rkey: string;
};

// Custom Tools types for JSON-RPC handlers

export type CustomToolInfo = {
  readonly name: string;
  readonly description: string;
  readonly approved: boolean;
  readonly codeHash: string;
  readonly secrets: ReadonlyArray<string>;
};

export type CustomToolListResult = {
  readonly tools: ReadonlyArray<CustomToolInfo>;
};

export type CustomToolApproveParams = {
  readonly name: string;
};

export type CustomToolRevokeParams = {
  readonly name: string;
};

export type CustomToolUpdateSecretsParams = {
  readonly name: string;
  readonly secrets: ReadonlyArray<string>;
};

// Grants types for JSON-RPC handlers

export type GrantInfo = {
  readonly skillName: string;
  readonly codeHash: string;
  readonly status: string;
  readonly secrets: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type GrantListResult = {
  readonly grants: ReadonlyArray<GrantInfo>;
};

// Simple ok response (reusable)

export type OkResult = {
  readonly ok: boolean;
};

// Builtins types for JSON-RPC handlers

export type BuiltinToolInfo = {
  readonly name: string;
  readonly description: string;
};

export type BuiltinListResult = {
  readonly tools: ReadonlyArray<BuiltinToolInfo>;
};
