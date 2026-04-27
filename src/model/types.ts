// pattern: Functional Core

export type TextBlock = {
  type: 'text';
  text: string;
};

export type ToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type ImageBlock = {
  type: 'image_url';
  image_url: { url: string };
};

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock;

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type Message = {
  role: 'user' | 'assistant';
  content: string | Array<ContentBlock>;
  reasoning_content?: string;
};

export type ModelRequest = {
  messages: ReadonlyArray<Message>;
  system?: string;
  tools?: ReadonlyArray<ToolDefinition>;
  model: string;
  max_tokens: number;
  temperature?: number;
  timeout?: number;
};

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';

export type UsageStats = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export type ModelResponse = {
  content: Array<ContentBlock>;
  stop_reason: StopReason;
  usage: UsageStats;
  reasoning_content?: string;
};

export type ModelProvider = {
  complete(request: Readonly<ModelRequest>): Promise<ModelResponse>;
};
