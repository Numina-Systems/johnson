// pattern: Functional Core

export type ExecutionResult = {
  success: boolean;
  output: string;
  error: string | null;
  duration_ms: number;
};

export type ToolCallHandler = (
  name: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export type CodeRuntime = {
  execute(
    code: string,
    env?: Record<string, string>,
    onToolCall?: ToolCallHandler,
  ): Promise<ExecutionResult>;
};
