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
