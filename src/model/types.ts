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

export type ImageBlock = {
  type: 'image_url';
  image_url: { url: string };
};

export type ImageSourceBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
};

export type ToolResultContentBlock = TextBlock | ImageBlock | ImageSourceBlock;

export type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<ToolResultContentBlock>;
  is_error?: boolean;
};

export type ContentBlock = TextBlock | ImageBlock | ImageSourceBlock | ToolUseBlock | ToolResultBlock;

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

// ── Typed Errors ──────────────────────────────────────────────────────

export type ModelErrorKind =
  | 'rate_limit'     // 429
  | 'server_error'   // 500, 502, 503, 504
  | 'timeout'        // request timed out or AbortError
  | 'network'        // ECONNREFUSED, ECONNRESET, ETIMEDOUT, ENOTFOUND, fetch failed
  | 'auth'           // 401, 403
  | 'bad_request'    // 400
  | 'model_loading'  // model_not_loaded, loading model
  | 'parse'          // invalid JSON response
  | 'unknown';

export class ModelError extends Error {
  readonly kind: ModelErrorKind;
  readonly statusCode: number | null;
  readonly retryable: boolean;

  constructor(kind: ModelErrorKind, message: string, statusCode: number | null = null) {
    super(message);
    this.name = 'ModelError';
    this.kind = kind;
    this.statusCode = statusCode;
    this.retryable = kind === 'rate_limit'
      || kind === 'server_error'
      || kind === 'timeout'
      || kind === 'network'
      || kind === 'model_loading';
  }
}

export function classifyHttpError(status: number, body: string): ModelError {
  if (status === 429) return new ModelError('rate_limit', `Rate limited (429): ${body}`, status);
  if (status === 401 || status === 403) return new ModelError('auth', `Auth error (${status}): ${body}`, status);
  if (status === 400) return new ModelError('bad_request', `Bad request (400): ${body}`, status);
  if (status >= 500) return new ModelError('server_error', `Server error (${status}): ${body}`, status);
  return new ModelError('unknown', `HTTP ${status}: ${body}`, status);
}

export function classifyFetchError(err: unknown): ModelError {
  if (err instanceof ModelError) return err;
  if (!(err instanceof Error)) return new ModelError('unknown', String(err));

  const msg = err.message.toLowerCase();
  if (err.name === 'AbortError' || msg.includes('abort')) return new ModelError('timeout', err.message);
  if (msg.includes('model_not_loaded') || msg.includes('model not loaded') || msg.includes('loading model')) {
    return new ModelError('model_loading', err.message);
  }
  if (msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('etimedout')
    || msg.includes('enotfound') || msg.includes('fetch failed')) {
    return new ModelError('network', err.message);
  }
  return new ModelError('unknown', err.message);
}

/**
 * Serialize ToolResultBlock content to a plain string.
 * If content is already a string, return as-is.
 * If content is an array of content blocks, extract text parts and join them.
 * Image blocks are represented as '[image]' placeholders.
 */
export function toolResultContentToString(
  content: string | Array<ToolResultContentBlock>,
): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'image_url') return '[image]';
      if (block.type === 'image') return '[image]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}
