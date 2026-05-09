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
